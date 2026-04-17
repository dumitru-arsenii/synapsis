/**
 * OpenAI-backed Synapsis agent adapter.
 *
 * This module connects the provider-agnostic neuron runtime to the official
 * OpenAI SDK while keeping ChatGPT-specific prompt wording separate from the
 * transport layer.
 */
import OpenAI from "openai";
import { AbstractAgent, type AgentTemplateOverrides } from "@synapsis/neuron";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { resolveOpenAIChatGPTTemplates } from "./chatgpt-templates";

/**
 * Reasoning effort values supported by the OpenAI Responses API.
 */
export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Request options forwarded into `client.responses.create`.
 *
 * The adapter keeps these options intentionally focused on the knobs that make
 * sense at the Synapsis layer. More advanced OpenAI features can be surfaced in
 * future revisions without changing the adapter's overall role.
 */
export interface OpenAIResponseRequestOptions {
  /** Maximum number of tokens the model may emit for a single response. */
  readonly maxOutputTokens?: number;

  /** Optional metadata forwarded for tracing, analytics, or audit purposes. */
  readonly metadata?: Record<string, string>;

  /** Optional reasoning controls for models that expose effort tuning. */
  readonly reasoning?: {
    readonly effort?: OpenAIReasoningEffort;
  };

  /** Whether the response should be stored by OpenAI when supported. */
  readonly store?: boolean;

  /** Sampling temperature for non-deterministic generation. */
  readonly temperature?: number;

  /** Nucleus sampling parameter forwarded as `top_p`. */
  readonly topP?: number;
}

/**
 * Minimal client surface required by the adapter.
 *
 * Accepting this narrow shape makes the adapter easy to test and also lets
 * advanced callers inject a preconfigured OpenAI client wrapper.
 */
export interface OpenAIResponsesClient {
  readonly responses: {
    create: (body: ResponseCreateParamsNonStreaming) => Promise<Pick<Response, "output_text"> & Partial<Response>>;
  };
}

/**
 * Constructor options for the OpenAI adapter.
 *
 * Authentication is explicit by design: callers must provide either an `apiKey`
 * for internal SDK construction or a ready-to-use `client`.
 */
export interface OpenAIAgentAdapterOptions extends AgentTemplateOverrides {
  /** API key used when the adapter creates its own OpenAI SDK client. */
  readonly apiKey?: string;

  /** Optional base URL for proxies or OpenAI-compatible gateways. */
  readonly baseURL?: string;

  /** Preconfigured client instance to use instead of creating one internally. */
  readonly client?: OpenAIResponsesClient;

  /** Extra headers attached to every request from the internally created client. */
  readonly defaultHeaders?: Record<string, string>;

  /** OpenAI model name used for all requests issued by this adapter. */
  readonly model: string;

  /** Retry budget delegated to the underlying OpenAI SDK client. */
  readonly maxRetries?: number;

  /** Optional OpenAI organization identifier. */
  readonly organization?: string | null;

  /** Optional OpenAI project identifier. */
  readonly project?: string | null;

  /** Per-request options forwarded into the Responses API payload. */
  readonly request?: OpenAIResponseRequestOptions;

  /** SDK request timeout in milliseconds. */
  readonly timeout?: number;
}

/**
 * Concrete Synapsis agent implementation backed by the official OpenAI SDK.
 *
 * Its responsibilities are intentionally small:
 * - initialize the OpenAI client from explicit constructor data,
 * - apply OpenAI-specific prompt defaults on top of `AbstractAgent`,
 * - execute prompt strings through `responses.create`,
 * - normalize the SDK response back into the plain string expected by Synapsis.
 */
export class OpenAIAgentAdapter extends AbstractAgent {
  /** Stable provider identifier useful for diagnostics and adapter discovery. */
  public readonly provider = "openai";

  /** Narrow client dependency used for request execution. */
  private readonly client: OpenAIResponsesClient;

  /** Model name selected for this adapter instance. */
  private readonly modelName: string;

  /** Optional per-request settings merged into every Responses API call. */
  private readonly requestOptions: OpenAIResponseRequestOptions | undefined;

  /**
   * Create a new OpenAI adapter.
   *
   * Template overrides are resolved before the `AbstractAgent` constructor runs
   * so OpenAI/ChatGPT-specific prompt text becomes the default experience unless
   * the caller replaces it.
   */
  constructor(options: OpenAIAgentAdapterOptions) {
    super(resolveOpenAIChatGPTTemplates(options));

    if (!options.client && !options.apiKey) {
      throw new Error("OpenAI apiKey is required unless an OpenAI client is provided in the constructor.");
    }

    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        defaultHeaders: options.defaultHeaders,
        maxRetries: options.maxRetries,
        organization: options.organization,
        project: options.project,
        timeout: options.timeout
      });

    this.modelName = options.model;
    this.requestOptions = options.request;
  }

  /** Read-only accessor for the selected OpenAI model name. */
  get model(): string {
    return this.modelName;
  }

  /**
   * Execute a Synapsis prompt through the OpenAI Responses API.
   *
   * The neuron runtime expects a plain string response, so this method extracts
   * `output_text`, trims whitespace, and fails fast when the SDK response does
   * not contain usable text.
   */
  async run(prompt: string): Promise<string> {
    const response = await this.client.responses.create(this.buildRequestBody(prompt));
    const output = typeof response.output_text === "string" ? response.output_text.trim() : "";

    if (!output) {
      throw new Error("OpenAI response did not include assistant text output.");
    }

    return output;
  }

  /**
   * Translate Synapsis request options into the OpenAI request body shape.
   *
   * The adapter API uses camelCase for ergonomics while the OpenAI payload still
   * expects snake_case fields like `max_output_tokens` and `top_p`.
   */
  private buildRequestBody(prompt: string): ResponseCreateParamsNonStreaming {
    const body: ResponseCreateParamsNonStreaming = {
      model: this.modelName,
      input: prompt,
      text: {
        format: {
          type: "text"
        }
      }
    };

    if (this.requestOptions?.maxOutputTokens !== undefined) {
      body.max_output_tokens = this.requestOptions.maxOutputTokens;
    }

    if (this.requestOptions?.metadata !== undefined) {
      body.metadata = this.requestOptions.metadata;
    }

    if (this.requestOptions?.reasoning !== undefined) {
      body.reasoning = this.requestOptions.reasoning;
    }

    if (this.requestOptions?.store !== undefined) {
      body.store = this.requestOptions.store;
    }

    if (this.requestOptions?.temperature !== undefined) {
      body.temperature = this.requestOptions.temperature;
    }

    if (this.requestOptions?.topP !== undefined) {
      body.top_p = this.requestOptions.topP;
    }

    return body;
  }
}

/** Factory helper mirroring the class constructor. */
export function createOpenAIAgentAdapter(options: OpenAIAgentAdapterOptions): OpenAIAgentAdapter {
  return new OpenAIAgentAdapter(options);
}

/** Backwards-friendly alias for the factory helper. */
export const createOpenAIAdapter = createOpenAIAgentAdapter;

/** Ergonomic class alias for callers that prefer noun-style imports. */
export const OpenAIAgent = OpenAIAgentAdapter;

/** Re-export the OpenAI-specific prompt defaults and merge helper. */
export { openAIChatGPTTemplates, resolveOpenAIChatGPTTemplates } from "./chatgpt-templates";
