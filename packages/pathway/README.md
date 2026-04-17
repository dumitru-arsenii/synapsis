# @synapsis/pathway

`@synapsis/pathway` defines the typed step contract used across Synapsis and validates that adjacent steps are schema-compatible.

It gives you:
- the `Executable<I, O>` interface
- pathway construction
- pathway validation
- pathway-specific error types

## What This Package Means

A pathway is an ordered chain of typed executables.

Each step has:
- input schema
- output schema
- `execute`
- `safeExecute`

This package ensures that the output of one step can safely become the input of the next step.

Important: this package validates and constructs pathways, but it does not run them directly. Actual queued execution belongs to `@synapsis/brain`.

## Installation

```bash
npm install @synapsis/pathway zod
```

## Quick Start

```ts
import { z } from "zod";
import { createPathway, type Executable } from "@synapsis/pathway";

const normalizeMessage = {
  name: "normalize-message",
  description: "Normalize the incoming text.",
  input: z.object({
    message: z.string()
  }),
  output: z.object({
    summary: z.string()
  }),
  execute: async ({ message }) => ({
    summary: message.trim().toUpperCase()
  }),
  safeExecute: async ({ message }) => ({
    success: true,
    output: {
      summary: message.trim().toUpperCase()
    },
    details: {}
  })
} satisfies Executable<
  { message: string },
  { summary: string }
>;

const draftReply = {
  name: "draft-reply",
  description: "Draft a reply from the normalized summary.",
  input: z.object({
    summary: z.string()
  }),
  output: z.object({
    reply: z.string()
  }),
  execute: async ({ summary }) => ({
    reply: `Received: ${summary}`
  }),
  safeExecute: async ({ summary }) => ({
    success: true,
    output: {
      reply: `Received: ${summary}`
    },
    details: {}
  })
} satisfies Executable<
  { summary: string },
  { reply: string }
>;

const pathway = createPathway({
  name: "support-reply",
  description: "Normalize first, then draft the reply.",
  steps: [normalizeMessage, draftReply] as const
});

console.log(pathway.input);
console.log(pathway.output);
```

## Important Execution Note

`createPathway()` returns a valid pathway object, but its `execute` and `safeExecute` methods intentionally throw.

That is by design.

Why:
- this package owns step composition and validation
- `@synapsis/brain` owns runtime execution, worker orchestration, and persistence

So the normal flow is:
1. define compatible executables
2. use pathway validation to catch composition problems early
3. pass the steps into `brain.createPathway(...)` when you want an executable workflow

## Validation API

### `validatePathwaySteps(steps)`

Checks adjacent step compatibility and returns:

```ts
{
  success: boolean;
  issues: ReadonlyArray<{
    index: number;
    stepName: string;
    reason: string;
  }>;
}
```

Example:

```ts
import { validatePathwaySteps } from "@synapsis/pathway";

const validation = validatePathwaySteps([normalizeMessage, draftReply] as const);

if (!validation.success) {
  console.error(validation.issues);
}
```

### `PathwayValidationError`

`createPathway()` throws `PathwayValidationError` when step schemas do not compose.

This error includes:
- a human-readable message
- `issues`, the structured validation issues

## Core Types

### `Executable<I, O>`

The main unit of work:

```ts
type Executable<I, O> = {
  name: string;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  execute(input: unknown): Promise<O>;
  safeExecute(input: unknown): Promise<ExecutableSafeResult<I, O>>;
};
```

This type is implemented by:
- neurons
- brain actions
- executable brain pathways
- your own custom deterministic steps

### `ExecutableSafeResult<I, O>`

Non-throwing execution result shape:
- success branch with typed output
- failure branch with raw output, error, and details

### `PathwayDefinition<Steps>`

Metadata plus ordered steps:
- `name`
- `description`
- `steps`

### `Pathway<Steps>`

The instantiated pathway object. It exposes:
- `name`
- `description`
- `steps`
- `input`
- `output`
- guarded `execute`
- guarded `safeExecute`

## Type-Level Composition

`ExecutableChain` and related helper types make pathway definitions safer at compile time.

Useful exported helpers:
- `Executables`
- `ExecutableChain`
- `AnyExecutable`
- `InputOf`
- `OutputOf`
- `FirstStep`
- `LastStep`

These are helpful when building utilities around reusable executable steps.

## Integration With Brain

`@synapsis/pathway` is the schema and composition layer.

`@synapsis/brain` is the runtime layer.

Typical integration looks like:

```ts
const pathway = brain.createPathway({
  key: "support-reply",
  name: "support-reply",
  description: "Normalize first, then draft the reply.",
  steps: [normalizeMessage, draftReply] as const
});
```

Here, the same step contracts are preserved, but execution becomes queue-backed and worker-driven.

## Exports

Primary exports:
- `createPathway`
- `validatePathwaySteps`
- `PathwayValidationError`

Useful types:
- `Executable`
- `ExecutableDefinition`
- `ExecutableSafeResult`
- `Pathway`
- `PathwayDefinition`
- `PathwayValidationIssue`
- `PathwayValidationResult`
- `InputOf`
- `OutputOf`

## When To Use What

Use `@synapsis/pathway` when:
- you want to define typed step contracts
- you want to validate composition before runtime
- you want reusable step interfaces independent of a worker runtime

Use `@synapsis/brain` when:
- you want those pathways to actually execute
- you need queues, locks, workers, and persisted runs
