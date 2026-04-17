import type { BrainPathwayRunStep } from "../types";

/** Serialize objects with stable key ordering for snapshot comparisons. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

/** Convert unknown throw values into a readable message for persisted state. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

/** Replace or insert a run step record while keeping step ordering stable. */
export function upsertRunStep(
  steps: ReadonlyArray<BrainPathwayRunStep>,
  nextStep: BrainPathwayRunStep
): ReadonlyArray<BrainPathwayRunStep> {
  const remaining = steps.filter((step) => step.index !== nextStep.index);

  return [...remaining, nextStep].sort((left, right) => left.index - right.index);
}
