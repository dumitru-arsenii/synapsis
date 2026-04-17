import type { Cortex } from "@synapsis/cortex";
import type {
  BrainExecutableRun,
  BrainExecutableRunEvent,
  BrainPathwayRun,
  BrainRegistry,
  BrainRuntimeOptions
} from "../types";
import { executableRunEventKey, executableRunKey, pathwayRunKey } from "./keys";

export type RuntimeOptions = Required<BrainRuntimeOptions>;

export type RuntimeContext = {
  readonly cortex: Cortex;
  readonly registry: BrainRegistry;
  readonly runtimeOptions: RuntimeOptions;
  readonly workerId: string;
};

export type ScheduleExecutableRunDefinition = {
  readonly key: string;
  readonly input: unknown;
  readonly parentRunId?: string;
  readonly parentStepIndex?: number;
  readonly maxRetries?: number;
};

export async function persistPathwayRun(
  context: Pick<RuntimeContext, "cortex">,
  run: BrainPathwayRun
): Promise<void> {
  await context.cortex.memory.set(pathwayRunKey(run.runId), run);
}

export async function persistExecutableRun(
  context: Pick<RuntimeContext, "cortex">,
  run: BrainExecutableRun
): Promise<void> {
  await context.cortex.memory.set(executableRunKey(run.runId), run);
}

/** Append an event to the executable run timeline stored in Cortex. */
export function emitExecutableRunEvent(
  context: Pick<RuntimeContext, "cortex">,
  run: BrainExecutableRun,
  event: Omit<BrainExecutableRunEvent, "runId" | "createdAt" | "parentRunId">
): Promise<void> {
  return appendJsonEvent(context.cortex, executableRunEventKey(run.runId), {
    runId: run.runId,
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    createdAt: new Date().toISOString(),
    ...event
  });
}

/** Renew an executable lease in the background while the step is running. */
export function startLeaseRenewal(
  context: Pick<RuntimeContext, "cortex">,
  lockKey: string,
  ownerId: string,
  ttlMs: number
) {
  let lost = false;
  const timer = setInterval(() => {
    void (async () => {
      const renewed = await context.cortex.locks.renew(lockKey, ownerId, ttlMs);

      if (!renewed) {
        lost = true;
      }
    })();
  }, Math.max(1, Math.floor(ttlMs / 3)));

  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    leaseLost: () => lost
  };
}

/** Append an event to an event-array stored in Cortex memory. */
async function appendJsonEvent(cortex: Cortex, key: string, event: BrainExecutableRunEvent): Promise<void> {
  const current = (await cortex.memory.get<BrainExecutableRunEvent[]>(key)) ?? [];

  await cortex.memory.set(key, [...current, event]);
}
