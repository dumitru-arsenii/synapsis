import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PATHWAY_QUEUE_KEY } from "../options";
import { resolveRegistryEntryByExecutable, resolveRegistryEntryByKey } from "../registry";
import type {
  BrainPathwayRun,
  BrainPathwayRunStep,
  QueuePayload
} from "../types";
import { executeStep } from "./execution";
import { pathwayLockKey, pathwayRunKey, pathwayRunStepKey } from "./keys";
import { createPathwaySnapshot } from "./snapshots";
import type { RuntimeContext } from "./shared";
import { persistPathwayRun } from "./shared";
import { errorMessage, upsertRunStep } from "./utils";

export function createPathwayRuntime(context: RuntimeContext) {
  const { cortex, registry, runtimeOptions, workerId } = context;

  /** Read a persisted pathway run snapshot from Cortex. */
  const getPathwayRun = (runId: string) => cortex.memory.get<BrainPathwayRun>(pathwayRunKey(runId));

  /** Poll Cortex until a pathway run reaches a terminal state or times out. */
  const waitForPathwayRun = async (runId: string): Promise<BrainPathwayRun | undefined> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= runtimeOptions.pathwayWaitTimeoutMs) {
      const run = await getPathwayRun(runId);

      if (run?.status === "completed" || run?.status === "failed") {
        return run;
      }

      await delay(runtimeOptions.pathwayWaitIntervalMs);
    }

    return getPathwayRun(runId);
  };

  /** Create and enqueue a new pathway run record. */
  const schedulePathwayRun = async (pathwayKey: string, input: unknown): Promise<BrainPathwayRun> => {
    const entry = registry.getPathway(pathwayKey);

    if (!entry) {
      throw new Error(`Pathway "${pathwayKey}" is not registered in this brain.`);
    }

    const now = new Date().toISOString();
    const runId = randomUUID();
    const run: BrainPathwayRun = {
      runId,
      pathwayKey: entry.key,
      status: "pending",
      input,
      output: null,
      currentStep: 0,
      retryCount: 0,
      maxRetries: runtimeOptions.pathwayMaxRetries,
      createdAt: now,
      updatedAt: now,
      snapshot: createPathwaySnapshot(entry, registry),
      steps: []
    };

    await persistPathwayRun(context, run);
    await cortex.queue.enqueue<QueuePayload>(PATHWAY_QUEUE_KEY, {
      runId,
      pathwayKey: entry.key,
      input,
      retryCount: 0,
      queuedAt: now
    });

    return run;
  };

  /** Claim the next queued pathway run, guarding it with a worker lease. */
  const processPathwayQueue = async (ownerId = workerId): Promise<BrainPathwayRun | null> => {
    const payload = await cortex.queue.dequeue<QueuePayload>(PATHWAY_QUEUE_KEY);

    if (!payload) {
      return null;
    }

    const lockKey = pathwayLockKey(payload.runId);
    const acquired = await cortex.locks.acquire(lockKey, ownerId, runtimeOptions.pathwayLockTtlMs);

    if (!acquired) {
      await cortex.queue.enqueue(PATHWAY_QUEUE_KEY, payload);
      return null;
    }

    try {
      return await processQueuedPathwayRun(payload, ownerId);
    } finally {
      await cortex.locks.release(lockKey, ownerId);
    }
  };

  return {
    processPathwayQueue,
    schedulePathwayRun,
    waitForPathwayRun
  };

  /** Execute a queued pathway run step-by-step, persisting progress after each step. */
  async function processQueuedPathwayRun(
    payload: QueuePayload,
    ownerId: string
  ): Promise<BrainPathwayRun | null> {
    const run = await getPathwayRun(payload.runId);

    if (!run || run.status === "completed" || run.status === "failed") {
      return run ?? null;
    }

    const pathwayEntry = resolveRegistryEntryByKey(registry, run.pathwayKey);

    if (!pathwayEntry || pathwayEntry.kind !== "pathway") {
      const failed = {
        ...run,
        status: "failed",
        error: `Pathway "${run.pathwayKey}" is not registered in this brain.`,
        failedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } satisfies BrainPathwayRun;

      await persistPathwayRun(context, failed);
      return failed;
    }

    const pathway = pathwayEntry.executable;
    let currentRun: BrainPathwayRun = {
      ...run,
      status: "running",
      startedAt: run.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    let currentInput = currentRun.currentStep === 0 ? currentRun.input : currentRun.output;

    await persistPathwayRun(context, currentRun);

    for (let index = currentRun.currentStep; index < pathway.steps.length; index++) {
      // Renew the pathway lease before each step so long runs stay owned by this worker.
      const renewed = await cortex.locks.renew(
        pathwayLockKey(currentRun.runId),
        ownerId,
        runtimeOptions.pathwayLockTtlMs
      );

      if (!renewed) {
        const pending = {
          ...currentRun,
          status: "pending",
          updatedAt: new Date().toISOString()
        } satisfies BrainPathwayRun;

        await persistPathwayRun(context, pending);
        await enqueuePathwayRetry(pending);
        return pending;
      }

      const step = pathway.steps[index]!;
      const existingStep = currentRun.steps.find((entry) => entry.index === index);
      const result = await executeStep(registry, step, currentInput);
      const stepEntry = resolveRegistryEntryByExecutable(registry, step);
      const stepRecord: BrainPathwayRunStep = {
        index,
        name: step.name,
        description: step.description,
        status: result.success ? "success" : "failed",
        input: currentInput,
        output: result.output,
        retries: result.success ? existingStep?.retries ?? 0 : (existingStep?.retries ?? 0) + 1,
        details: result.details,
        updatedAt: new Date().toISOString(),
        ...(stepEntry?.key ? { key: stepEntry.key } : {}),
        ...(result.memoryKey ? { memoryKey: result.memoryKey } : {}),
        ...(!result.success ? { error: errorMessage(result.error) } : {})
      };

      currentRun = {
        ...currentRun,
        steps: upsertRunStep(currentRun.steps, stepRecord),
        updatedAt: stepRecord.updatedAt
      };

      await cortex.memory.set(pathwayRunStepKey(currentRun.runId, index), stepRecord);

      if (!result.success) {
        if (currentRun.retryCount < currentRun.maxRetries) {
          const pending = {
            ...currentRun,
            status: "pending",
            currentStep: index,
            retryCount: currentRun.retryCount + 1,
            error: errorMessage(result.error),
            updatedAt: new Date().toISOString()
          } satisfies BrainPathwayRun;

          await persistPathwayRun(context, pending);
          await enqueuePathwayRetry(pending);
          return pending;
        }

        const failed = {
          ...currentRun,
          status: "failed",
          currentStep: index,
          error: errorMessage(result.error),
          failedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } satisfies BrainPathwayRun;

        await persistPathwayRun(context, failed);
        return failed;
      }

      const { error: _error, ...runWithoutError } = currentRun;

      currentInput = result.output;
      currentRun = {
        ...runWithoutError,
        currentStep: index + 1,
        output: result.output,
        updatedAt: new Date().toISOString()
      };

      await persistPathwayRun(context, currentRun);
    }

    const completed = {
      ...currentRun,
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } satisfies BrainPathwayRun;

    await persistPathwayRun(context, completed);
    return completed;
  }

  /** Requeue a pending pathway run after a retry-worthy failure or lease loss. */
  async function enqueuePathwayRetry(run: BrainPathwayRun): Promise<void> {
    await cortex.queue.enqueue<QueuePayload>(PATHWAY_QUEUE_KEY, {
      runId: run.runId,
      pathwayKey: run.pathwayKey,
      input: run.input,
      retryCount: run.retryCount,
      queuedAt: new Date().toISOString()
    });
  }
}
