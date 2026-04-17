# @synapsis/brain

`@synapsis/brain` is the orchestration layer for Synapsis.

It combines:
- `@synapsis/neuron` for typed LLM steps
- `@synapsis/pathway` for step composition
- `@synapsis/cortex` for memory, queues, and worker leases

The result is a runtime that can register steps by stable keys, queue pathway runs, execute them through workers, and persist their state.

## What This Package Means

Use a brain when you want more than isolated executables.

A brain gives you:
- a shared registry of neurons, actions, and pathways
- queued pathway execution
- worker polling and lease ownership
- pathway run snapshots and step history in Cortex
- shared neuron learning storage when configured

If `@synapsis/neuron` is a typed intelligent step, `@synapsis/brain` is the runtime that turns many steps into a running system.

## Installation

```bash
npm install @synapsis/brain @synapsis/cortex @synapsis/openai @synapsis/neuron zod
```

If you already use a different agent adapter, you only need `@synapsis/openai` for the examples in this README.

## Quick Start

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
  description: "Turn a raw message into structured intent.",
  input: z.object({
    message: z.string()
  }),
  output: z.object({
    summary: z.string()
  }),
  prompt: {
    role: "Support triage assistant",
    task: "Summarize the support issue in one short sentence.",
    important: ["Return JSON only."]
  },
  critic: false
});

const draftReply = brain.createAction({
  key: "draft-reply",
  name: "draft-reply",
  description: "Draft a reply from the structured summary.",
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
  description: "Extract intent and then draft a reply.",
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

## Core API

### `createBrain(definition)`

Creates a runtime with:
- `createNeuron`
- `createAction`
- `createPathway`
- `startExecutionWorker`
- `registry`
- `agent`
- `cortex`
- `workerId`

Constructor input:

```ts
createBrain({
  agent,
  cortex,
  options
})
```

`agent` is any `Agent` implementation from `@synapsis/neuron`.

`cortex` is any `Cortex` implementation from `@synapsis/cortex`.

### `brain.createNeuron(definition)`

Wraps `@synapsis/neuron#createNeuron`, but adds:
- a required stable `key`
- automatic registry registration
- shared Cortex-backed learning storage when `learning` is configured

### `brain.createAction(definition)`

Creates a deterministic typed executable for non-LLM logic.

Actions:
- validate input and output with Zod
- register themselves in the brain registry
- receive `{ cortex, registry }` in `run`

Example:

```ts
const normalize = brain.createAction({
  key: "normalize-message",
  name: "normalize-message",
  description: "Normalize a support message.",
  input: z.object({ message: z.string() }),
  output: z.object({ summary: z.string() }),
  run: async ({ message }) => ({
    summary: message.trim().toUpperCase()
  })
});
```

### `brain.createPathway(definition)`

Creates a queued executable pathway with:
- a stable `key`
- static pathway compatibility validation
- registry registration
- async execution through Cortex queues and workers

Unlike `@synapsis/pathway#createPathway`, the brain version is executable.

### `brain.startExecutionWorker(label?)`

Starts a lightweight polling worker that drains:
- the pathway queue
- the executable queue

It returns a stop function:

```ts
const stop = brain.startExecutionWorker();
stop();
```

## Runtime Options

`createBrain({ options })` accepts `BrainRuntimeOptions`:
- `pathwayWaitIntervalMs`
- `pathwayWaitTimeoutMs`
- `pathwayLockTtlMs`
- `pathwayMaxRetries`
- `executableWaitIntervalMs`
- `executableWaitTimeoutMs`
- `executableLockTtlMs`
- `executableMaxRetries`

Use these when you need to tune:
- worker polling cadence
- timeout behavior while waiting for queued runs
- lease time-to-live
- retry budgets for queued work

## What Gets Persisted

The brain runtime stores pathway and executable state in Cortex memory.

That includes:
- pathway run records
- per-step pathway records
- executable run records
- executable event timelines
- shared neuron learning examples when enabled

This makes it possible to:
- inspect run progress
- debug failed steps
- share state across workers
- keep pathway execution reproducible

## Safe Execution Behavior

For pathways created through the brain:
- `execute(input)` throws on failure
- `safeExecute(input)` returns structured details

The safe pathway result includes details such as:
- `queued`
- `runId`
- `status`
- `steps`

This is useful when you want to surface workflow status to a UI or logs.

## Mental Model

Think of the package like this:
- neurons are intelligent typed steps
- actions are deterministic typed steps
- pathways are ordered chains of steps
- the brain is the runtime that registers, queues, and runs them

## Exports

Primary exports:
- `createBrain`

Useful types:
- `Brain`
- `BrainDefinition`
- `BrainRuntimeOptions`
- `BrainNeuronDefinition`
- `BrainActionDefinition`
- `BrainPathwayDefinition`
- `BrainPathwayRun`
- `BrainExecutableRun`
- `BrainExecutableRunEvent`

## When To Use What

Use `@synapsis/brain` when:
- you want stable keys for executables
- you want background workers
- you want queued pathway execution
- you want persisted run state
- you want shared learning through Cortex

Use `@synapsis/neuron` directly when:
- you only need one intelligent step

Use `@synapsis/pathway` directly when:
- you only need compile-time and runtime validation of step composition
