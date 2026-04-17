/**
 * High-level Brain entrypoints.
 *
 * This module turns package definitions into a running Brain instance that
 * wires together Cortex storage, registry bookkeeping, execution factories,
 * and worker runtime behavior.
 */
import { randomUUID } from "node:crypto";
import { createRuntime } from "./runtime";
import { createBrainRegistry } from "./registry";
import type {
  Brain,
  BrainDefinition,
} from "./types";
import { createActionFactory, createNeuronFactory, createPathwayFactory } from "./factories";
import { resolveBrainRuntimeOptions } from "./options";

/**
 * The brain is the runtime kernel for Synapsis.
 *
 * It keeps definition-time objects small and pure, then composes runtime
 * procedures for registry, Cortex-backed work, and shared neuron learning.
 */
export function createBrain(definition: BrainDefinition): Brain {
  if (!definition.cortex) {
    throw new Error("A Cortex runtime is required to create a brain.");
  }

  // Each Brain instance gets its own worker id so lease ownership is traceable.
  const workerId = randomUUID();
  const registry = createBrainRegistry();
  const runtimeOptions = resolveBrainRuntimeOptions(definition.options);
  const cortex = definition.cortex;
  const runtime = createRuntime({
    cortex,
    registry,
    runtimeOptions,
    workerId
  });

  // Factories close over shared runtime services so user definitions stay small.
  return {
    agent: definition.agent,
    workerId,
    cortex,
    registry,
    createNeuron: createNeuronFactory({
      agent: definition.agent,
      cortex,
      registry
    }),
    createAction: createActionFactory({
      registry,
      cortex
    }),
    createPathway: createPathwayFactory({
      registry,
      runtime
    }),
    startExecutionWorker: runtime.startExecutionWorker
  };
}
