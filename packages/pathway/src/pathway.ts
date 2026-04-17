/**
 * Pathway construction and validation.
 *
 * A pathway is a compile-time and runtime-checked chain of executables whose
 * schemas must compose cleanly from one step to the next.
 */
import zodToJsonSchema from "zod-to-json-schema";
import { validateJsonSchemaCompatibility } from "./compatibility";
import type {
  Executables,
  LastStep,
  Pathway,
  PathwayDefinition,
  PathwayValidationIssue,
  PathwayValidationResult
} from "./types";

/** Error thrown when adjacent pathway steps are schema-incompatible. */
export class PathwayValidationError extends Error {
  readonly issues: ReadonlyArray<PathwayValidationIssue>;

  constructor(pathwayName: string, issues: ReadonlyArray<PathwayValidationIssue>) {
    super(buildValidationMessage(pathwayName, issues));
    this.name = "PathwayValidationError";
    this.issues = issues;
  }
}

/** Validate the schema compatibility of every adjacent step pair in a pathway. */
export function validatePathwaySteps<const Steps extends Executables>(steps: Steps): PathwayValidationResult {
  const issues: PathwayValidationIssue[] = [];

  for (let index = 0; index < steps.length - 1; index++) {
    const source = steps[index]!;
    const target = steps[index + 1]!;
    const issue = validateJsonSchemaCompatibility(
      zodToJsonSchema(source.output),
      zodToJsonSchema(target.input)
    );

    if (issue) {
      issues.push({
        index,
        stepName: source.name,
        reason: issue.reason
      });
    }
  }

  return {
    success: issues.length === 0,
    issues
  };
}

/** Create a non-executable pathway definition that must later be run by Brain. */
export function createPathway<const Steps extends Executables>(
  definition: PathwayDefinition<Steps>
): Pathway<Steps> {
  const validation = validatePathwaySteps(definition.steps);
  const firstStep = definition.steps[0];
  const lastStep = definition.steps[definition.steps.length - 1] as LastStep<Steps>;

  if (!validation.success) {
    throw new PathwayValidationError(definition.name, validation.issues);
  }

  // Direct execution is intentionally blocked because Brain owns queued execution.
  const executionThrow = () => {
    throw new Error(`Pathway "${definition.name}" have been created directly. Use brain.createPathway to create an executable pathway.`);
  }

  return {
    name: definition.name,
    description: definition.description,
    steps: definition.steps,
    input: firstStep.input,
    output: lastStep.output,
    execute: executionThrow,
    safeExecute: executionThrow
  };
}

/** Build a human-readable validation message from the first compatibility issue. */
function buildValidationMessage(
  pathwayName: string,
  issues: ReadonlyArray<PathwayValidationIssue>
): string {
  const [firstIssue] = issues;

  if (!firstIssue) {
    return `Pathway "${pathwayName}" is invalid.`;
  }

  return [
    `Pathway "${pathwayName}" is invalid.`,
    `Step ${firstIssue.index + 1} "${firstIssue.stepName}".`,
    `Reason: ${firstIssue.reason}`
  ].join(" ");
}
