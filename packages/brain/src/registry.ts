/**
 * Brain registry helpers.
 *
 * The registry is the source of truth that maps user-provided keys to the
 * executable instances and metadata a worker needs at runtime.
 */
import type { BrainRegistry, BrainRegistryEntry, BrainRegistryEntryAction, BrainRegistryEntryNeuron, BrainRegistryEntryPathway } from "./types";

/** Create the mutable registry used by a Brain instance. */
export function createBrainRegistry(): BrainRegistry {
  return {
    root: new Map<string, BrainRegistryEntry>(),
    registerNeuron(entry: Omit<BrainRegistryEntryNeuron, "kind">): void {
      this.assertUniqueKey(entry.key, "neuron");
      this.root.set(entry.key, { kind: "neuron", ...entry });
    },
    registerAction(entry: Omit<BrainRegistryEntryAction, "kind">): void {
      this.assertUniqueKey(entry.key, "action");
      this.root.set(entry.key, { kind: "action", ...entry });
    },
    registerPathway(entry: Omit<BrainRegistryEntryPathway, "kind">): void {
      this.assertUniqueKey(entry.key, "pathway");
      this.root.set(entry.key, { kind: "pathway", ...entry });
    },
    getNeuron(key: string): BrainRegistryEntryNeuron | null {
      const entry = this.root.get(key);
      return entry?.kind === "neuron" ? entry : null;
    },
    getAction(key: string): BrainRegistryEntryAction | null {
      const entry = this.root.get(key);
      return entry?.kind === "action" ? entry : null;
    },
    getPathway(key: string): BrainRegistryEntryPathway | null {
      const entry = this.root.get(key);
      return entry?.kind === "pathway" ? entry : null;
    },
    assertUniqueKey(key: string, kind?: BrainRegistryEntry["kind"]): void {
      if (this.root.has(key)) {
        throw new Error(`Brain already has a registered ${kind ?? "entry"} with key "${key}".`);
      }
    }
  };
}

/** Look up a registry entry by its user-facing Brain key. */
export function resolveRegistryEntryByKey(registry: BrainRegistry, key: string): BrainRegistryEntry | null {
  return registry.root.get(key) ?? null;
}

/** Reverse-resolve the registry entry that owns an executable instance. */
export function resolveRegistryEntryByExecutable(
  registry: BrainRegistry,
  executable: unknown
): BrainRegistryEntry | null {
  for (const entry of registry.root.values()) {
    if (entry.executable === executable) {
      return entry;
    }
  }

  return null;
}
