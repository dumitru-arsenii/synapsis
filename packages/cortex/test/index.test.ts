/** Cortex runtime tests covering prefixed memory, queues, locks, and scheduling. */
import { describe, expect, it } from "vitest";
import { createMemoryCortex } from "../src/memory/index.js";

describe("@synapsis/cortex", () => {
  it("provides Redis-backed memory, queue, locks, and scheduler facets", async () => {
    const cortex = createMemoryCortex();
    const otherTenant = createMemoryCortex();

    await cortex.memory.set("memory:key", {
      value: "stored"
    });
    await cortex.queue.enqueue("queue:work", { id: "job-1" });

    expect(await cortex.memory.get<{ value: string }>("memory:key")).toEqual({
      value: "stored"
    });
    expect(await otherTenant.memory.get("memory:key")).toBeUndefined();
    expect(await cortex.queue.dequeue("queue:work")).toEqual({ id: "job-1" });
    expect(await otherTenant.queue.dequeue("queue:work")).toBeUndefined();

    expect(await cortex.locks.acquire("lock:work", "worker-a", 1_000)).toBe(true);
    expect(await otherTenant.locks.acquire("lock:work", "worker-b", 1_000)).toBe(true);
    expect(await cortex.locks.renew("lock:work", "worker-a", 1_000)).toBe(true);
    expect(await cortex.locks.release("lock:work", "worker-a")).toBe(true);
  });
});
