# @synapsis/cortex

`@synapsis/cortex` provides the runtime state primitives used by Synapsis:
- memory
- queues
- lease-based locks

It is the shared storage surface that higher-level packages, especially `@synapsis/brain`, rely on.

## What This Package Means

Cortex is not an agent and not a workflow engine.

It is the infrastructure contract underneath them:
- memory stores durable state
- queues move work between producers and workers
- locks coordinate worker ownership

The package exports:
- core types from `@synapsis/cortex`
- an in-memory implementation from `@synapsis/cortex/memory`
- a Redis implementation from `@synapsis/cortex/redis`

## Installation

For types plus the in-memory runtime:

```bash
npm install @synapsis/cortex
```

For Redis-backed execution:

```bash
npm install @synapsis/cortex redis
```

## Import Layout

The root package exports the interfaces:

```ts
import type { Cortex, CortexMemory, CortexQueue, CortexLocks } from "@synapsis/cortex";
```

The runtime constructors live on subpaths:

```ts
import { createMemoryCortex } from "@synapsis/cortex/memory";
import { createRedisCortex } from "@synapsis/cortex/redis";
```

## Quick Start: In-Memory Cortex

```ts
import { createMemoryCortex } from "@synapsis/cortex/memory";

const cortex = createMemoryCortex();

await cortex.memory.set("ticket:1", {
  status: "pending"
});

await cortex.queue.enqueue("queue:support", {
  id: "ticket-1"
});

const ticket = await cortex.memory.get<{ status: string }>("ticket:1");
const job = await cortex.queue.dequeue<{ id: string }>("queue:support");

const acquired = await cortex.locks.acquire("lock:ticket:1", "worker-a", 30_000);

console.log(ticket, job, acquired);
```

Use the memory runtime for:
- tests
- local development
- examples
- single-process experiments

## Quick Start: Redis Cortex

```ts
import { createRedisCortex } from "@synapsis/cortex/redis";

const cortex = createRedisCortex({
  url: process.env.REDIS_URL,
  keyPrefix: "synapsis:"
});

await cortex.memory.set("ticket:1", {
  status: "pending"
});
```

You can also configure Redis via discrete fields:

```ts
const cortex = createRedisCortex({
  host: "127.0.0.1",
  port: 6379,
  database: 0,
  keyPrefix: "synapsis:"
});
```

## Core Interfaces

### `CortexMemory`

```ts
type CortexMemory = {
  get<T>(key: string): Awaitable<T | undefined>;
  set<T>(key: string, value: T): Awaitable<void>;
  delete?(key: string): Awaitable<void>;
};
```

Use it for:
- run snapshots
- cached results
- shared learning examples
- persistent worker state

### `CortexQueue`

```ts
type CortexQueue = {
  enqueue<T extends Record<string, unknown>>(queueKey: string, payload: T): Awaitable<void>;
  dequeue<T extends Record<string, unknown>>(queueKey: string): Awaitable<T | undefined>;
};
```

Use it for:
- background jobs
- workflow steps
- producer / worker handoff

### `CortexLocks`

```ts
type CortexLocks = {
  acquire(lockKey: string, owner: string, ttlMs: number): Awaitable<boolean>;
  renew(lockKey: string, owner: string, ttlMs: number): Awaitable<boolean>;
  release(lockKey: string, owner: string): Awaitable<boolean>;
};
```

Use it for:
- worker leases
- single-owner processing
- long-running queue consumers

## In-Memory Runtime Semantics

`createMemoryCortex()`:
- stores memory in process-local `Map`s
- serializes queue payloads to JSON
- implements lease expiry timestamps in memory

It is intentionally simple and isolated per instance.

Two `createMemoryCortex()` calls do not share state.

## Redis Runtime Semantics

`createRedisCortex()`:
- JSON-serializes memory values
- uses Redis lists for FIFO queues
- uses lease keys plus `PX` expiration for locks
- supports key prefixing via `keyPrefix`

The Redis runtime automatically connects on first use.

## `createRedisCortex` Options

Supported connection fields:
- `url`
- `host`
- `port`
- `username`
- `password`
- `database`
- `tls`
- `connectTimeoutMs`
- `keyPrefix`

`keyPrefix` is especially useful for:
- multi-tenant apps
- local isolation
- test environments

## Exports

Root exports:
- `Awaitable`
- `Cortex`
- `CortexMemory`
- `CortexQueue`
- `CortexLocks`

`@synapsis/cortex/memory` exports:
- `createMemoryCortex`

`@synapsis/cortex/redis` exports:
- `createRedisCortex`
- `resolveRedisStringToJSON`
- `CortexRedisConnectionParams`

## When To Use What

Use the memory runtime when:
- you want zero infrastructure
- you are running tests
- you are prototyping locally

Use the Redis runtime when:
- you need shared state across processes
- you need real worker coordination
- you want Brain pathways to survive outside one process
