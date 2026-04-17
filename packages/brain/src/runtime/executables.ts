import { randomUUID } from "node:crypto";
import { type AnyExecutable } from "@synapsis/pathway";
import { EXECUTABLE_QUEUE_KEY } from "../options";
import { resolveRegistryEntryByKey } from "../registry";
import type {
  BrainExecutableRun,
  BrainExecutableRunEvent,
  ExecutableQueuePayload
} from "../types";
import { executeStep } from "./execution";
import { executableLockKey, executableRunEventKey, executableRunKey } from "./keys";
import { createExecutableSnapshot, isExecutableSnapshotCompatible } from "./snapshots";
import type { RuntimeContext, ScheduleExecutableRunDefinition } from "./shared";
import { emitExecutableRunEvent, persistExecutableRun, startLeaseRenewal } from "./shared";
import { errorMessage } from "./utils";

export function createExecutableRuntime(context: RuntimeContext) {
  const { cortex, registry, runtimeOptions, workerId } = context;

  /** Create and enqueue a run record for a single executable. */
  const scheduleExecutableRun = async (
    definition: ScheduleExecutableRunDefinition
  ): Promise<BrainExecutableRun> => {
    const entry = resolveRegistryEntryByKey(registry, definition.key);

    if (!entry) {
      throw new Error(`Executable "${definition.key}" is not registered in this brain.`);
    }

    const now = new Date().toISOString();
    const runId = randomUUID();
    const run: BrainExecutableRun = {
      runId,
      ...(definition.parentRunId ? { parentRunId: definition.parentRunId } : {}),
      ...(typeof definition.parentStepIndex === "number" ? { parentStepIndex: definition.parentStepIndex } : {}),
      executableKey: definition.key,
      status: "pending",
      input: definition.input,
      output: null,
      retryCount: 0,
      maxRetries: definition.maxRetries ?? runtimeOptions.executableMaxRetries,
      createdAt: now,
      updatedAt: now,
      queuedAt: now,
      snapshot: createExecutableSnapshot(entry)
    };

    await persistExecutableRun(context, run);
    await enqueueExecutablePayload(run);
    await emitExecutableRunEvent(context, run, {
      type: "queued",
      message: `Executable "${run.executableKey}" was queued.`
    });

    return run;
  };

  /** Read a persisted executable run snapshot from Cortex. */
  const getExecutableRun = async (runId: string) => {
    return (await cortex.memory.get<BrainExecutableRun>(executableRunKey(runId))) ?? null;
  };

  /** Read the event timeline emitted for an executable run. */
  const getExecutableRunEvents = async (runId: string): Promise<BrainExecutableRunEvent[]> => {
    return (await cortex.memory.get<BrainExecutableRunEvent[]>(executableRunEventKey(runId))) ?? [];
  };

  /** Claim the next executable payload, validating registry compatibility first. */
  const processExecutableQueue = async (ownerId = workerId): Promise<BrainExecutableRun | null> => {
    const payload = await cortex.queue.dequeue<ExecutableQueuePayload>(EXECUTABLE_QUEUE_KEY);

    if (!payload) {
      return null;
    }

    const run = await getExecutableRun(payload.runId);

    if (!run || run.status === "completed" || run.status === "failed") {
      return run;
    }

    const entry = resolveRegistryEntryByKey(registry, run.executableKey);

    if (!entry) {
      await requeueExecutableRun(
        run,
        payload,
        `Executable "${run.executableKey}" is not registered in worker "${ownerId}".`,
        ownerId
      );
      return null;
    }

    if (!isExecutableSnapshotCompatible(run.snapshot, createExecutableSnapshot(entry))) {
      await requeueExecutableRun(
        run,
        payload,
        `Executable "${run.executableKey}" schema does not match worker "${ownerId}".`,
        ownerId
      );
      return null;
    }

    const lockKey = executableLockKey(run.runId);
    const acquired = await cortex.locks.acquire(lockKey, ownerId, runtimeOptions.executableLockTtlMs);

    if (!acquired) {
      await cortex.queue.enqueue(EXECUTABLE_QUEUE_KEY, payload);
      return null;
    }

    const lease = startLeaseRenewal(context, lockKey, ownerId, runtimeOptions.executableLockTtlMs);

    try {
      return await processQueuedExecutableRun(run, entry.executable, ownerId, lease.leaseLost);
    } finally {
      lease.stop();
      await cortex.locks.release(lockKey, ownerId);
    }
  };

  return {
    getExecutableRun,
    getExecutableRunEvents,
    processExecutableQueue,
    scheduleExecutableRun
  };

  /** Execute one queued executable and convert the result into persisted run state. */
  async function processQueuedExecutableRun(
    run: BrainExecutableRun,
    executable: AnyExecutable,
    ownerId: string,
    leaseLost: () => boolean
  ): Promise<BrainExecutableRun> {
    const startedAt = new Date().toISOString();
    const currentRun = {
      ...run,
      status: "running",
      workerId: ownerId,
      startedAt: run.startedAt ?? startedAt,
      updatedAt: startedAt
    } satisfies BrainExecutableRun;

    await persistExecutableRun(context, currentRun);
    await emitExecutableRunEvent(context, currentRun, {
      type: "started",
      workerId: ownerId,
      message: `Worker "${ownerId}" started executable "${currentRun.executableKey}".`
    });

    const result = await executeStep(registry, executable, currentRun.input);
    const now = new Date().toISOString();

    if (leaseLost()) {
      const pending = {
        ...currentRun,
        status: "pending",
        error: "Executable lease was lost before completion.",
        updatedAt: now
      } satisfies BrainExecutableRun;

      await persistExecutableRun(context, pending);
      await enqueueExecutablePayload(pending);
      await emitExecutableRunEvent(context, pending, {
        type: "requeued",
        workerId: ownerId,
        message: pending.error
      });

      return pending;
    }

    if (result.success) {
      const completed = {
        ...currentRun,
        status: "completed",
        output: result.output,
        details: result.details,
        completedAt: now,
        updatedAt: now
      } satisfies BrainExecutableRun;

      await persistExecutableRun(context, completed);
      await emitExecutableRunEvent(context, completed, {
        type: "completed",
        workerId: ownerId,
        message: `Executable "${completed.executableKey}" completed.`
      });

      return completed;
    }

    if (currentRun.retryCount < currentRun.maxRetries) {
      const pending = {
        ...currentRun,
        status: "pending",
        output: result.output,
        error: errorMessage(result.error),
        details: result.details,
        retryCount: currentRun.retryCount + 1,
        updatedAt: now
      } satisfies BrainExecutableRun;

      await persistExecutableRun(context, pending);
      await enqueueExecutablePayload(pending);
      await emitExecutableRunEvent(context, pending, {
        type: "requeued",
        workerId: ownerId,
        message: errorMessage(result.error)
      });

      return pending;
    }

    const failed = {
      ...currentRun,
      status: "failed",
      output: result.output,
      error: errorMessage(result.error),
      details: result.details,
      failedAt: now,
      updatedAt: now
    } satisfies BrainExecutableRun;

    await persistExecutableRun(context, failed);
    await emitExecutableRunEvent(context, failed, {
      type: "failed",
      workerId: ownerId,
      error: errorMessage(result.error),
      message: `Executable "${failed.executableKey}" failed.`
    });

    return failed;
  }

  /** Push the latest executable run state back onto the executable queue. */
  async function enqueueExecutablePayload(run: BrainExecutableRun): Promise<void> {
    await cortex.queue.enqueue<ExecutableQueuePayload>(EXECUTABLE_QUEUE_KEY, {
      runId: run.runId,
      executableKey: run.executableKey,
      retryCount: run.retryCount,
      queuedAt: new Date().toISOString()
    });
  }

  /** Requeue an executable when a worker cannot safely execute it yet. */
  async function requeueExecutableRun(
    run: BrainExecutableRun,
    payload: ExecutableQueuePayload,
    message: string,
    ownerId: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const pending = {
      ...run,
      status: "pending",
      updatedAt: now
    } satisfies BrainExecutableRun;

    await persistExecutableRun(context, pending);
    await cortex.queue.enqueue<ExecutableQueuePayload>(EXECUTABLE_QUEUE_KEY, {
      ...payload,
      queuedAt: now
    });
    await emitExecutableRunEvent(context, pending, {
      type: "skipped",
      workerId: ownerId,
      message
    });
  }
}
