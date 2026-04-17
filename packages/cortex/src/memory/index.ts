/**
 * In-memory Redis-compatible Cortex runtime.
 *
 * This implementation is primarily intended for tests and local development,
 * while preserving the same memory, queue, and lease semantics as the Redis driver.
 */
import type { Cortex } from "../types";

/** Creates an in-process runtime that mimics Redis behavior for tests. */
export function createMemoryCortex(): Cortex {
  // Store memory entries, queue contents, and lease metadata independently.
  const store = new Map<string, unknown>();
  const queues = new Map<string, string[]>();
  const leases = new Map<string, { owner: string; expiresAt: number }>();

  // Lazily evict expired leases before each lock operation.
  const clearExpiredLease = (lockKey: string) => {
    const current = leases.get(lockKey);

    if (current && current.expiresAt <= Date.now()) {
      leases.delete(lockKey);
    }
  };

  return {
    memory: {
      get: async <T = unknown>(key: string): Promise<T | undefined> => store.get(key) as T ?? undefined,
      set: async <T = unknown>(key: string, value: T) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      }
    },
    queue: {
      enqueue: async <T extends Record<string, unknown>>(queueKey: string, payload: T) => {
        const queue = queues.get(queueKey) ?? [];
        queue.push(JSON.stringify(payload));
        queues.set(queueKey, queue);
      },
      dequeue: async <T extends Record<string, unknown>>(queueKey: string): Promise<T | undefined> => {
        const queue = queues.get(queueKey) ?? [];
        const payload = queue.shift() ?? undefined;
        queues.set(queueKey, queue);
        if (!payload) return undefined;
        return JSON.parse(payload) as T;
      }
    },
    locks: {
      acquire: async (lockKey: string, owner: string, ttlMs: number) => {
        clearExpiredLease(lockKey);
        const current = leases.get(lockKey);

        // Another owner still holds the active lease.
        if (current && current.owner !== owner) {
          return false;
        }

        leases.set(lockKey, {
          owner,
          expiresAt: Date.now() + ttlMs
        });

        return true;
      },
      renew: async (lockKey: string, owner: string, ttlMs: number) => {
        clearExpiredLease(lockKey);
        const current = leases.get(lockKey);

        // Only the current owner can extend an existing lease.
        if (!current || current.owner !== owner) {
          return false;
        }

        leases.set(lockKey, {
          owner,
          expiresAt: Date.now() + ttlMs
        });

        return true;
      },
      release: async (lockKey: string, owner: string) => {
        clearExpiredLease(lockKey);
        const current = leases.get(lockKey);

        // Refuse to release leases owned by someone else.
        if (!current || current.owner !== owner) {
          return false;
        }

        leases.delete(lockKey);
        return true;
      }
    }
  };
}
