/**
 * Brain runtime defaults.
 *
 * These values keep local development snappy while still reflecting the
 * distributed worker model that Brain uses in production.
 */
import type { BrainRuntimeOptions } from "./types";

/**
 * Conservative defaults keep the queue runtime usable locally while still
 * mapping cleanly to a real distributed worker setup.
 */
export const DEFAULT_PATHWAY_WAIT_INTERVAL_MS = 10;
export const DEFAULT_PATHWAY_WAIT_TIMEOUT_MS = 5_000;
export const DEFAULT_PATHWAY_LOCK_TTL_MS = 30_000;
export const DEFAULT_PATHWAY_MAX_RETRIES = 1;
export const PATHWAY_QUEUE_KEY = "queue:pathways";

export const DEFAULT_EXECUTABLE_WAIT_INTERVAL_MS = 10;
export const DEFAULT_EXECUTABLE_WAIT_TIMEOUT_MS = 5_000;
export const DEFAULT_EXECUTABLE_LOCK_TTL_MS = 30_000;
export const DEFAULT_EXECUTABLE_MAX_RETRIES = 1;
export const EXECUTABLE_QUEUE_KEY = "queue:executables";

/** Resolve a complete runtime option object by filling in conservative defaults. */
export function resolveBrainRuntimeOptions(options?: BrainRuntimeOptions): Required<BrainRuntimeOptions> {
    return {
        pathwayWaitIntervalMs: options?.pathwayWaitIntervalMs ?? DEFAULT_PATHWAY_WAIT_INTERVAL_MS,
        pathwayWaitTimeoutMs: options?.pathwayWaitTimeoutMs ?? DEFAULT_PATHWAY_WAIT_TIMEOUT_MS,
        pathwayLockTtlMs: options?.pathwayLockTtlMs ?? DEFAULT_PATHWAY_LOCK_TTL_MS,
        pathwayMaxRetries: options?.pathwayMaxRetries ?? DEFAULT_PATHWAY_MAX_RETRIES,
        executableWaitIntervalMs: options?.executableWaitIntervalMs ?? DEFAULT_EXECUTABLE_WAIT_INTERVAL_MS,
        executableWaitTimeoutMs: options?.executableWaitTimeoutMs ?? DEFAULT_EXECUTABLE_WAIT_TIMEOUT_MS,
        executableLockTtlMs: options?.executableLockTtlMs ?? DEFAULT_EXECUTABLE_LOCK_TTL_MS,
        executableMaxRetries: options?.executableMaxRetries ?? DEFAULT_EXECUTABLE_MAX_RETRIES,
    }
}
