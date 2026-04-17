/** Cortex key used to persist one pathway run. */
export function pathwayRunKey(runId: string): string {
  return `pathway:run:${runId}`;
}

/** Cortex key used to persist one pathway run step. */
export function pathwayRunStepKey(runId: string, stepIndex: number): string {
  return `pathway:run:${runId}:steps:${stepIndex}`;
}

/** Cortex lock key guarding ownership of a pathway run. */
export function pathwayLockKey(runId: string): string {
  return `lock:pathway:${runId}`;
}

/** Cortex key used to persist one executable run. */
export function executableRunKey(runId: string): string {
  return `executable:run:${runId}`;
}

/** Cortex key used to persist the event timeline for one executable run. */
export function executableRunEventKey(runId: string): string {
  return `executable:run:${runId}:events`;
}

/** Cortex lock key guarding ownership of an executable run. */
export function executableLockKey(runId: string): string {
  return `lock:executable:${runId}`;
}
