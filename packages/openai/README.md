# @synapsis/openai

`@synapsis/openai` is the official OpenAI adapter for Synapsis agents.

It connects the provider-agnostic agent contract from `@synapsis/neuron` to the OpenAI Responses API and ships ChatGPT-oriented prompt templates tuned for structured JSON work.

## What This Package Means

This package is the bridge between Synapsis execution primitives and OpenAI models.

It is responsible for:
- creating or accepting an OpenAI client
- sending prompts through `responses.create`
- returning plain string output back to Synapsis
- applying OpenAI-specific prompt defaults

Use it when you want a ready-made agent adapter instead of building your own `AbstractAgent` subclass.

## Installation

```bash
npm install @synapsis/openai @synapsis/neuron
```

The `openai` SDK is installed as a package dependency of `@synapsis/openai`.

## Quick Start

```ts
import { createOpenAIAgentAdapter } from "@synapsis/openai";
import { createNeuron, z } from "@synapsis/neuron";

const agent = createOpenAIAgentAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-5.4-mini",
  request: {
    temperature: 0,
    reasoning: {
      effort: "medium"
    }
  }
});

const classifyTicket = createNeuron({
  name: "classify-ticket",
  description: "Classify a support ticket.",
  input: z.object({
    message: z.string()
  }),
  output: z.object({
    category: z.enum(["billing", "technical", "general"]),
    priority: z.enum(["low", "medium", "high"])
  }),
  agent,
  prompt: {
    role: "Support classifier",
    task: "Classify the ticket category and priority.",
    important: ["Return JSON only."]
  },
  critic: false
});

const result = await classifyTicket.execute({
  message: "My invoice is wrong and I need a refund."
});

console.log(result.category);
```

## Core API

### `createOpenAIAgentAdapter(options)`

Factory helper that returns an `OpenAIAgentAdapter`.

### `new OpenAIAgentAdapter(options)`

Concrete agent adapter implementation built on the OpenAI Responses API.

Key constructor options:
- `model`
- `apiKey`
- `client`
- `baseURL`
- `defaultHeaders`
- `maxRetries`
- `organization`
- `project`
- `timeout`
- `request`

You must provide either:
- `apiKey`, so the adapter can create its own OpenAI client
- `client`, if you want to inject a preconfigured client

## Request Options

The adapter exposes a focused `request` object:

```ts
request: {
  maxOutputTokens?: number;
  metadata?: Record<string, string>;
  reasoning?: {
    effort?: "minimal" | "low" | "medium" | "high";
  };
  store?: boolean;
  temperature?: number;
  topP?: number;
}
```

These are translated into the OpenAI Responses API payload:
- `maxOutputTokens` -> `max_output_tokens`
- `topP` -> `top_p`

## Injecting a Client

For tests, proxies, or advanced SDK setup, inject your own narrow client:

```ts
const agent = new OpenAIAgentAdapter({
  model: "gpt-5.4-mini",
  client: {
    responses: {
      create: async (body) => {
        console.log(body);
        return {
          output_text: "{\"ok\":true}"
        };
      }
    }
  }
});
```

## Prompt Templates

This package ships with OpenAI / ChatGPT-oriented defaults for:
- the main prompt
- repair prompts
- critic review prompts
- critic apply prompts
- example rendering
- critic strictness wording

Those defaults are exported as:
- `openAIChatGPTTemplates`
- `resolveOpenAIChatGPTTemplates`

You can override any template through the same template override fields supported by `AbstractAgent`:
- `promptTemplate`
- `repairTemplate`
- `critiqueReviewTemplate`
- `critiqueApplyTemplate`
- `exampleTemplate`
- `criticSentenceTemplate`

Example:

```ts
const agent = new OpenAIAgentAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-5.4-mini",
  promptTemplate: "Custom Template\nTask: {{task}}\nInput: {{input}}"
});
```

## Aliases and Exports

Primary exports:
- `OpenAIAgentAdapter`
- `createOpenAIAgentAdapter`

Friendly aliases:
- `OpenAIAgent`
- `createOpenAIAdapter`

Useful supporting exports:
- `OpenAIAgentAdapterOptions`
- `OpenAIResponseRequestOptions`
- `OpenAIResponsesClient`
- `OpenAIReasoningEffort`
- `openAIChatGPTTemplates`
- `resolveOpenAIChatGPTTemplates`

## Error Behavior

The adapter throws when:
- neither `apiKey` nor `client` is provided
- the OpenAI SDK throws
- the response does not include usable `output_text`

This matches the expectations of Synapsis agent consumers such as neurons and brains.

## When To Use What

Use `@synapsis/openai` when:
- you want a ready-to-use OpenAI adapter
- you want prompt templates already tuned for structured JSON work
- you want to plug OpenAI directly into `@synapsis/neuron` or `@synapsis/brain`

Build your own `AbstractAgent` subclass when:
- you need a different provider
- you need a different transport layer
- you want full control over prompt formatting
