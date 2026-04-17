import { type AnyExecutable } from "@synapsis/pathway";
import zodToJsonSchema from "zod-to-json-schema";
import { resolveRegistryEntryByExecutable } from "../registry";
import type {
  BrainExecutableSnapshot,
  BrainPathwaySnapshot,
  BrainPathwaySnapshotStep,
  BrainRegistry,
  BrainRegistryEntry,
  BrainRegistryEntryPathway
} from "../types";
import { stableStringify } from "./utils";

/** Snapshot pathway metadata so queued work can validate compatibility later. */
export function createPathwaySnapshot(
  entry: BrainRegistryEntryPathway,
  registry: BrainRegistry
): BrainPathwaySnapshot {
  const firstStep = entry.steps[0]!;
  const lastStep = entry.steps[entry.steps.length - 1]!;

  return {
    pathwayKey: entry.key,
    name: entry.executable.name,
    description: entry.executable.description,
    inputSchema: zodToJsonSchema(firstStep.input),
    outputSchema: zodToJsonSchema(lastStep.output),
    steps: entry.steps.map((step: AnyExecutable, index: number) => createPathwaySnapshotStep(step, index, registry))
  };
}

/** Snapshot one pathway step, including its schemas and registry identity when known. */
export function createPathwaySnapshotStep(
  step: AnyExecutable,
  index: number,
  registry: BrainRegistry
): BrainPathwaySnapshotStep {
  const entry = resolveRegistryEntryByExecutable(registry, step);

  return {
    index,
    ...(entry?.key ? { key: entry.key } : {}),
    kind: entry?.kind ?? "executable",
    name: step.name,
    description: step.description,
    inputSchema: zodToJsonSchema(step.input),
    outputSchema: zodToJsonSchema(step.output)
  };
}

/** Snapshot a single executable for compatibility checks across workers. */
export function createExecutableSnapshot(entry: BrainRegistryEntry): BrainExecutableSnapshot {
  const { executable } = entry;

  return {
    key: entry.key,
    kind: entry.kind,
    name: executable.name,
    description: executable.description,
    inputSchema: zodToJsonSchema(executable.input),
    outputSchema: zodToJsonSchema(executable.output)
  };
}

/** Compare persisted executable snapshots to the current worker's registry view. */
export function isExecutableSnapshotCompatible(
  expected: BrainExecutableSnapshot,
  actual: BrainExecutableSnapshot
): boolean {
  return expected.key === actual.key &&
    expected.kind === actual.kind &&
    stableStringify(expected.inputSchema) === stableStringify(actual.inputSchema) &&
    stableStringify(expected.outputSchema) === stableStringify(actual.outputSchema);
}
