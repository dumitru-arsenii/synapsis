import { type AnyExecutable, type Executables } from "@synapsis/pathway";
import { resolveRegistryEntryByExecutable } from "../registry";
import type { BrainPathwayExecutionStep, BrainRegistry, StepExecutionResult } from "../types";

/** Execute a step, unwrapping nested Brain pathways when needed. */
export async function executeStep(
  registry: BrainRegistry,
  step: AnyExecutable,
  input: unknown
): Promise<StepExecutionResult> {
  const entry = resolveRegistryEntryByExecutable(registry, step);

  if (entry?.kind === "pathway") {
    return executeInlinePathway(registry, entry.steps, input);
  }

  const result = normalizeSafeResult(await step.safeExecute(input));

  return {
    ...result,
    ...(entry?.kind === "neuron" ? { memoryKey: entry.key } : {})
  };
}

/** Execute an inline pathway by walking each step synchronously in-process. */
async function executeInlinePathway(
  registry: BrainRegistry,
  steps: Executables,
  input: unknown
): Promise<StepExecutionResult> {
  let currentInput = input;
  const executedSteps: BrainPathwayExecutionStep[] = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    const result = await executeStep(registry, step, currentInput);

    if (!result.success) {
      return {
        success: false,
        output: result.output,
        error: result.error,
        details: {
          ...result.details,
          steps: executedSteps
        }
      };
    }

    executedSteps.push({
      index,
      name: step.name,
      description: step.description,
      input: currentInput,
      output: result.output
    });
    currentInput = result.output;
  }

  return {
    success: true,
    output: currentInput,
    details: {
      steps: executedSteps
    }
  };
}

/** Normalize unknown `safeExecute` output into the Brain step result contract. */
function normalizeSafeResult(result: unknown): StepExecutionResult {
  if (!result || typeof result !== "object" || !("success" in result)) {
    return {
      success: false,
      output: result,
      error: new Error("Step returned an invalid safe execution result."),
      details: {}
    };
  }

  const safeResult = result as {
    readonly success: boolean;
    readonly output: unknown;
    readonly error?: unknown;
    readonly details?: Record<string, unknown>;
  };

  if (safeResult.success) {
    return {
      success: true,
      output: safeResult.output,
      details: extractDetails(safeResult)
    };
  }

  return {
    success: false,
    output: safeResult.output,
    error: safeResult.error,
    details: extractDetails(safeResult)
  };
}

/** Pull optional `details` off a safe result without trusting its full shape. */
function extractDetails(result: unknown): Record<string, unknown> {
  return (result as { details?: Record<string, unknown> }).details ?? {};
}
