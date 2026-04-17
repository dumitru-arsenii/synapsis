/**
 * Brain worker runtime.
 *
 * This module owns queue scheduling, worker leases, run persistence, retry
 * behavior, and the translation between runtime state in Cortex and executable
 * instances in the Brain registry.
 */
import { createExecutableRuntime } from "./executables";
import { createPathwayRuntime } from "./pathways";
import type { RuntimeContext } from "./shared";

export type BrainRuntime = ReturnType<typeof createRuntime>;

/** Create the private runtime surface used internally by `createBrain`. */
export function createRuntime(context: RuntimeContext) {
  const { workerId, runtimeOptions } = context;
  const pathwayRuntime = createPathwayRuntime(context);
  const executableRuntime = createExecutableRuntime(context);

  /** Start a lightweight polling worker that drains both pathway and executable queues. */
  const startExecutionWorker = (label = workerId): (() => void) => {
    let stopped = false;
    let processing = false;

    // Avoid overlapping queue drains when the timer fires faster than work completes.
    const drainQueues = async () => {
      if (stopped || processing) {
        return;
      }

      processing = true;

      try {
        while (!stopped) {
          const processedPathway = await pathwayRuntime.processPathwayQueue(label);
          const processedExecutable = await executableRuntime.processExecutableQueue(label);

          if (!processedPathway && !processedExecutable) {
            return;
          }
        }
      } finally {
        processing = false;
      }
    };

    void drainQueues();

    const timer = setInterval(() => {
      void drainQueues();
    }, Math.min(runtimeOptions.pathwayWaitIntervalMs, runtimeOptions.executableWaitIntervalMs));

    timer.unref?.();

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  };

  return {
    schedulePathwayRun: pathwayRuntime.schedulePathwayRun,
    startExecutionWorker,
    waitForPathwayRun: pathwayRuntime.waitForPathwayRun
  };
}
