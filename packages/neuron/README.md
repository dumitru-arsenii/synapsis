# @synapsis/neuron

`@synapsis/neuron` is the typed LLM execution primitive in Synapsis.

A neuron takes:
- a Zod input schema
- a Zod output schema
- an agent adapter
- a prompt definition

It then handles the rest:
- input validation
- prompt construction
- model execution
- JSON parsing
- schema validation
- optional repair loops
- optional semantic critic review
- optional learning-example capture

This package is published from the open-source Synapsis monorepo:
- Repository: https://github.com/dumitru-arsenii/synapsis
- Package source: https://github.com/dumitru-arsenii/synapsis/tree/main/packages/neuron
- npm: https://www.npmjs.com/package/@synapsis/neuron
- Issues: https://github.com/dumitru-arsenii/synapsis/issues

## What This Package Means

Use a neuron when you want one LLM-backed operation to behave like a typed function instead of a loose text prompt.

Typical use cases:
- extracting structured data from text
- classifying content into a schema
- generating typed draft objects
- running one prompt step safely inside a larger workflow

If you need to chain multiple steps together, pair this package with `@synapsis/pathway` or `@synapsis/brain`.

## Installation

```bash
npm install @synapsis/neuron @synapsis/openai zod
```

`z` is also re-exported from `@synapsis/neuron`, but many users already import `zod` directly in app code.

## Quick Start

```ts
import { createNeuron, z } from "@synapsis/neuron";
import { createOpenAIAgentAdapter } from "@synapsis/openai";

const agent = createOpenAIAgentAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-5.4-mini",
  request: {
    temperature: 0
  }
});

const extractUser = createNeuron({
  name: "extract-user",
  description: "Extract a user record from a short piece of text.",
  input: z.object({
    text: z.string()
  }),
  output: z.object({
    name: z.string(),
    age: z.number().optional()
  }),
  agent,
  prompt: {
    role: "Extractor",
    task: "Extract the user's name and age from the input text.",
    important: [
      "Return JSON only.",
      "Do not invent missing values."
    ]
  },
  critic: false
});

const result = await extractUser.safeExecute({
  text: "Jane Doe is 34 years old."
});

if (result.success) {
  console.log(result.output.name);
  console.log(result.details.timeline);
}
```

## Core API

### `createNeuron(definition)`

Creates a typed executable with:
- `execute(input)` for throwing execution
- `safeExecute(input)` for non-throwing execution
- `name`, `description`, `input`, and `output` metadata

The returned neuron is also an `Executable<I, O>` from `@synapsis/pathway`, so it can be used as a pathway step.

### `AbstractAgent`

`AbstractAgent` is the provider-agnostic base class for model adapters. It owns:
- main prompt templating
- repair prompt templating
- critic review prompt templating
- critic apply prompt templating
- example rendering

Concrete adapters, such as `@synapsis/openai`, only need to implement `run(prompt: string)`.

### `Agent`

The minimal runtime interface a provider adapter must implement:
- `run`
- `buildPrompt`
- `buildRepairPrompt`
- `buildLearningExample`
- `buildCritiqueReviewPrompt`
- `buildCritiqueApplyPrompt`

### `PromptDefinition` and `NeuronPrompt`

The prompt can be:
- a static object
- a function of validated input

That lets you build runtime-aware prompts safely:

```ts
prompt: ({ input }) => ({
  role: "Support triage assistant",
  task: `Classify this message: ${input.message}`,
  important: ["Return JSON only."]
})
```

## Validation, Repair, and Safe Execution

Every neuron validates input before the agent is called.

Then the runtime:
1. builds the main prompt
2. runs the agent
3. parses JSON when needed
4. validates the output against the Zod schema
5. optionally repairs invalid output
6. optionally runs the semantic critic

`safeExecute` returns:

```ts
type Result =
  | { success: true; output: O; details: { timeline: TimelineStep<I, O>[] } }
  | { success: false; output: unknown; error: unknown; details: { timeline: TimelineStep<I, O>[] } };
```

The timeline is useful for:
- debugging prompt failures
- inspecting repair attempts
- capturing critic behavior
- logging retries and provider errors

## Critic Behavior

Critic review is enabled by default when `critic` is omitted.

To disable it completely:

```ts
critic: false
```

To configure it:

```ts
critic: {
  strategy: "strict",
  sentence: "Be strict about omitted facts."
}
```

Supported strategies:
- `strict`: critic feedback must lead to a valid corrected output or the run fails
- `fallback`: if post-critic correction cannot converge, return the original pre-critic valid output
- `optimist`: if the critic rewrite becomes invalid, keep the original valid output immediately
- `pessimist`: after a successful correction, run the critic again until it accepts or retries are exhausted

## Retry Configuration

Use `retries` to control repair and transport budgets:

```ts
retries: {
  max: 3,
  preCriticRetries: 2,
  postCriticRetries: 1,
  connectionRetry: 2,
  hardLimit: 10
}
```

Meaning:
- `max`: shared retry budget
- `preCriticRetries`: repair attempts before critic review
- `postCriticRetries`: repair attempts after critic feedback
- `connectionRetry`: retries for provider transport failures
- `hardLimit`: final safety cap against accidental loops

## Learning and Memory

Neurons can record corrected outputs as examples and feed them into future prompts.

```ts
learning: {
  latest: 3,
  onlyFailedFields: true
}
```

Important behavior:
- if you provide `learning.storage`, the examples are persisted in your store
- if you omit storage, the runtime uses an in-memory store
- `latest` controls how many past examples are appended to the prompt
- `onlyFailedFields` stores only the output fields implicated by validation errors when possible

`@synapsis/brain` uses this hook to persist neuron learning in Cortex memory and share it across workers.

## Custom Agent Adapter Example

```ts
import { AbstractAgent } from "@synapsis/neuron";

class EchoAgent extends AbstractAgent {
  async run(prompt: string): Promise<string> {
    console.log(prompt);
    return JSON.stringify({ ok: true });
  }
}
```

This is enough to integrate a custom provider as long as it returns model output as a string.

## Exports

Primary exports:
- `createNeuron`
- `AbstractAgent`
- `z`

Useful types:
- `Agent`
- `Neuron`
- `NeuronDefinition`
- `PromptDefinition`
- `PromptExample`
- `RetryConfig`
- `CriticConfig`
- `LearningStorage`
- `TimelineStep`

## When To Use What

Use `@synapsis/neuron` when:
- one typed prompt execution is enough
- you want validation, retries, and repair around a single model call
- you want steps that can later plug into pathways or a brain

Use `@synapsis/brain` when:
- you need registration by key
- you need queued pathway execution
- you need shared worker state and persisted learning
