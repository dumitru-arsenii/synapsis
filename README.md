# Synapsis

Synapsis is a TypeScript-first framework for building typed AI systems out of small, composable runtime primitives.

[![npm: brain](https://img.shields.io/npm/v/%40synapsis%2Fbrain?label=%40synapsis%2Fbrain)](https://www.npmjs.com/package/@synapsis/brain)
[![npm: cortex](https://img.shields.io/npm/v/%40synapsis%2Fcortex?label=%40synapsis%2Fcortex)](https://www.npmjs.com/package/@synapsis/cortex)
[![npm: neuron](https://img.shields.io/npm/v/%40synapsis%2Fneuron?label=%40synapsis%2Fneuron)](https://www.npmjs.com/package/@synapsis/neuron)
[![npm: openai](https://img.shields.io/npm/v/%40synapsis%2Fopenai?label=%40synapsis%2Fopenai)](https://www.npmjs.com/package/@synapsis/openai)
[![npm: pathway](https://img.shields.io/npm/v/%40synapsis%2Fpathway?label=%40synapsis%2Fpathway)](https://www.npmjs.com/package/@synapsis/pathway)

At a high level:
- `@synapsis/neuron` is the typed intelligence unit
- `@synapsis/pathway` is the step-composition layer
- `@synapsis/cortex` is the runtime state layer
- `@synapsis/brain` is the orchestration runtime
- `@synapsis/openai` is the OpenAI adapter

The core idea is simple: instead of treating AI calls as loose strings, Synapsis treats them as typed executables that can be validated, composed, queued, retried, and inspected.

## What The Framework Means

Synapsis gives you a layered model for AI systems:

1. Use a `Neuron` when you want one intelligent typed operation.
2. Use a `Pathway` when you want to validate that multiple typed steps fit together.
3. Use a `Brain` when you want those steps registered, queued, persisted, and executed through workers.
4. Use `Cortex` when you need runtime memory, queues, and locks behind that orchestration.
5. Use `@synapsis/openai` when you want OpenAI to power the agent layer.

This makes it easier to build systems that are:
- type-safe at package boundaries
- observable at runtime
- resilient to malformed model output
- structured enough to evolve beyond one-off prompts

## Packages

The current monorepo includes these publishable packages:

| Package | Purpose | Docs |
| --- | --- | --- |
| `@synapsis/brain` | Queue-backed orchestration for neurons, actions, and pathways | [packages/brain/README.md](./packages/brain/README.md) |
| `@synapsis/cortex` | Memory, queue, and lock abstractions plus in-memory and Redis runtimes | [packages/cortex/README.md](./packages/cortex/README.md) |
| `@synapsis/neuron` | Typed LLM execution with validation, repair, critic review, and learning | [packages/neuron/README.md](./packages/neuron/README.md) |
| `@synapsis/openai` | OpenAI Responses API adapter for Synapsis agents | [packages/openai/README.md](./packages/openai/README.md) |
| `@synapsis/pathway` | Executable contracts and pathway compatibility validation | [packages/pathway/README.md](./packages/pathway/README.md) |

## How The Pieces Fit

Think about the stack like this:

### `@synapsis/neuron`

A neuron is the smallest intelligent unit in the system.

It:
- accepts typed input
- builds a prompt
- runs an agent
- parses JSON
- validates output
- optionally repairs invalid output
- optionally runs a semantic critic
- optionally stores learning examples

### `@synapsis/pathway`

A pathway is a typed chain of executables.

It ensures that:
- the output of one step is compatible with the next step
- step composition errors are caught early
- the contract between steps stays explicit

### `@synapsis/cortex`

Cortex provides the runtime infrastructure:
- memory for persisted state
- queues for work dispatch
- locks for worker ownership

### `@synapsis/brain`

Brain is the runtime kernel that brings everything together.

It:
- registers neurons, actions, and pathways by stable keys
- schedules pathways through Cortex queues
- runs workers
- persists run snapshots and step history
- shares neuron learning through Cortex storage

### `@synapsis/openai`

This package plugs OpenAI into the Synapsis agent contract so neurons and brains can run on top of the OpenAI Responses API.

## End-To-End Example

This is the smallest framework-level example that shows how the packages work together:

```ts
import { createBrain } from "@synapsis/brain";
import { createMemoryCortex } from "@synapsis/cortex/memory";
import { createOpenAIAgentAdapter } from "@synapsis/openai";
import { z } from "@synapsis/neuron";

const cortex = createMemoryCortex();

const agent = createOpenAIAgentAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-5.4-mini",
  request: {
    temperature: 0
  }
});

const brain = createBrain({
  agent,
  cortex
});

const extractIntent = brain.createNeuron({
  key: "extract-intent",
  name: "extract-intent",
  description: "Extract the support issue summary.",
  input: z.object({
    message: z.string()
  }),
  output: z.object({
    summary: z.string()
  }),
  prompt: {
    role: "Support triage assistant",
    task: "Summarize the user's issue in one short sentence.",
    important: ["Return JSON only."]
  },
  critic: false
});

const draftReply = brain.createAction({
  key: "draft-reply",
  name: "draft-reply",
  description: "Turn the summary into a reply.",
  input: z.object({
    summary: z.string()
  }),
  output: z.object({
    reply: z.string()
  }),
  run: async ({ summary }) => ({
    reply: `We received your request: ${summary}`
  })
});

const supportReply = brain.createPathway({
  key: "support-reply",
  name: "support-reply",
  description: "Extract intent and draft a reply.",
  steps: [extractIntent, draftReply] as const
});

const stopWorker = brain.startExecutionWorker("local-worker");

try {
  const result = await supportReply.execute({
    message: "My VPN login stopped working this morning."
  });

  console.log(result.reply);
} finally {
  stopWorker();
}
```

What happens here:
- `@synapsis/openai` provides the agent adapter
- `@synapsis/neuron` powers the intelligent extraction step
- `@synapsis/brain` registers both steps and creates an executable pathway
- `@synapsis/cortex` stores queue and run state
- the worker drains queued work and completes the pathway

## Typical Usage Patterns

### Use only `@synapsis/neuron`

Choose this when:
- one typed prompt call is enough
- you want validation and retry behavior without background workers

### Use `@synapsis/neuron` + `@synapsis/pathway`

Choose this when:
- you want to define and validate step composition
- you are still keeping runtime execution simple

### Use the full stack

Choose `brain + cortex + neuron + pathway + provider adapter` when:
- you want queued execution
- you want persistent run state
- you want worker coordination
- you want shared learning or multi-step flows

## Package Docs

Each package has its own focused documentation:

- [Brain package docs](./packages/brain/README.md)
- [Cortex package docs](./packages/cortex/README.md)
- [Neuron package docs](./packages/neuron/README.md)
- [OpenAI package docs](./packages/openai/README.md)
- [Pathway package docs](./packages/pathway/README.md)

## Monorepo Development

Install dependencies:

```bash
pnpm install
```

Run all tests:

```bash
pnpm test
```

Run workspace typecheck:

```bash
pnpm typecheck
```

Build all packages:

```bash
pnpm build
```

Run one package test suite:

```bash
pnpm --filter @synapsis/brain test
```

## Publishing

The repo includes an npm publish workflow:

- [GitHub publish workflow](./.github/workflows/publish-npm.yml)

Package-specific npm-facing documentation is included in each package README, and those READMEs are packed into the published tarballs.
