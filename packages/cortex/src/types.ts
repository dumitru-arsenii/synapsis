/** A value that may be returned synchronously or via a promise. */
export type Awaitable<T> = T | Promise<T>;

/** Key/value storage used by Cortex for durable memory. */
export interface CortexMemory {
  /** Reads a previously stored value for the provided memory key. */
  get<T = Record<string, unknown>>(key: string): Awaitable<T | undefined>;
  /** Persists a value for the provided memory key. */
  set<T = Record<string, unknown>>(key: string, value: T): Awaitable<void>;
  /** Removes a stored value when the backing runtime supports deletion. */
  delete?(key: string): Awaitable<void>;
}

/** FIFO queue primitives used for scheduling and work dispatch. */
export interface CortexQueue {
  /** Pushes a payload onto the named queue. */
  enqueue<T extends Record<string, unknown>>(queueKey: string, payload: T): Awaitable<void>;
  /** Pops the next payload from the named queue. */
  dequeue<T extends Record<string, unknown>>(queueKey: string): Awaitable<T | undefined>;
}

/** Lease-based locking primitives used to coordinate workers. */
export interface CortexLocks {
  /** Attempts to claim or extend a lease for the same owner. */
  acquire(lockKey: string, owner: string, ttlMs: number): Awaitable<boolean>;
  /** Extends an existing lease if it is still owned by the caller. */
  renew(lockKey: string, owner: string, ttlMs: number): Awaitable<boolean>;
  /** Releases a lease if it is still owned by the caller. */
  release(lockKey: string, owner: string): Awaitable<boolean>;
}

/** Unified runtime surface exposed to Cortex consumers. */
export interface Cortex {
  /** Direct access to the memory adapter for advanced use cases. */
  readonly memory: CortexMemory;
  /** Direct access to the queue adapter for advanced use cases. */
  readonly queue: CortexQueue;
  /** Direct access to the lease adapter for advanced use cases. */
  readonly locks: CortexLocks;
}

