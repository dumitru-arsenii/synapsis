/**
 * OpenAI adapter tests.
 *
 * The suite mocks the SDK so adapter construction, request mapping, and error
 * handling can be verified without real network calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSpy = vi.fn();
const constructorSpy = vi.fn();

// Replace the SDK with a predictable in-memory test double.
vi.mock("openai", () => {
  class MockOpenAI {
    public readonly responses = {
      create: createSpy
    };

    constructor(options: unknown) {
      constructorSpy(options);
    }
  }

  return {
    default: MockOpenAI,
    OpenAI: MockOpenAI
  };
});

import { OpenAIAgentAdapter, createOpenAIAdapter } from "../src/index";

describe("@synapsis/openai", () => {
  beforeEach(() => {
    constructorSpy.mockReset();
    createSpy.mockReset();
  });

  it("creates an OpenAI agent adapter", () => {
    const adapter = createOpenAIAdapter({
      model: "gpt-5.4",
      apiKey: "sk-test"
    });

    expect(adapter).toBeInstanceOf(OpenAIAgentAdapter);
    expect(adapter.provider).toBe("openai");
    expect(adapter.model).toBe("gpt-5.4");
  });

  it("uses the dedicated ChatGPT prompt templates by default", () => {
    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      client: {
        responses: {
          create: vi.fn()
        }
      }
    });

    const prompt = adapter.buildPrompt({
      prompt: {
        role: "Extractor",
        task: "Extract a user name",
        important: ["Return JSON only"]
      },
      input: { text: "Jane Doe" },
      outputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string"
          }
        },
        required: ["name"]
      }
    });

    expect(prompt).toContain("You are ChatGPT");
    expect(prompt).toContain("Return ONLY a valid JSON object that matches this schema exactly");
    expect(prompt).toContain("Rules:");
  });

  it("creates an SDK client from constructor data and uses responses.create", async () => {
    createSpy.mockResolvedValueOnce({
      output_text: "{\"name\":\"Jane\"}"
    });

    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      apiKey: "sk-test",
      baseURL: "https://example.test/v1",
      defaultHeaders: {
        "x-test-header": "synapsis"
      },
      maxRetries: 4,
      organization: "org_123",
      project: "proj_123",
      request: {
        reasoning: { effort: "medium" },
        temperature: 0
      },
      timeout: 5_000
    });

    await expect(adapter.run("Return a JSON object.")).resolves.toBe("{\"name\":\"Jane\"}");

    expect(constructorSpy).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://example.test/v1",
      defaultHeaders: {
        "x-test-header": "synapsis"
      },
      maxRetries: 4,
      organization: "org_123",
      project: "proj_123",
      timeout: 5_000
    });
    expect(createSpy).toHaveBeenCalledWith({
      model: "gpt-5.4",
      input: "Return a JSON object.",
      text: {
        format: {
          type: "text"
        }
      },
      reasoning: {
        effort: "medium"
      },
      temperature: 0
    });
  });

  it("supports an injected OpenAI client from the constructor", async () => {
    const create = vi.fn(async () => ({
      output_text: "{\"name\":\"Jane\"}"
    }));

    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      client: {
        responses: {
          create
        }
      }
    });

    await expect(adapter.run("Return a JSON object.")).resolves.toBe("{\"name\":\"Jane\"}");
    expect(constructorSpy).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });

  it("passes through all supported response request options", async () => {
    createSpy.mockResolvedValueOnce({
      output_text: "{\"ok\":true}"
    });

    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      apiKey: "sk-test",
      request: {
        maxOutputTokens: 256,
        metadata: {
          source: "test-suite"
        },
        reasoning: {
          effort: "high"
        },
        store: false,
        temperature: 0.2,
        topP: 0.9
      }
    });

    await expect(adapter.run("Return a JSON object.")).resolves.toBe("{\"ok\":true}");

    expect(createSpy).toHaveBeenCalledWith({
      model: "gpt-5.4",
      input: "Return a JSON object.",
      max_output_tokens: 256,
      metadata: {
        source: "test-suite"
      },
      reasoning: {
        effort: "high"
      },
      store: false,
      temperature: 0.2,
      text: {
        format: {
          type: "text"
        }
      },
      top_p: 0.9
    });
  });

  it("throws when neither apiKey nor client is provided", () => {
    expect(() => new OpenAIAgentAdapter({
      model: "gpt-5.4"
    })).toThrow("OpenAI apiKey is required unless an OpenAI client is provided in the constructor.");
  });

  it("surfaces SDK errors", async () => {
    createSpy.mockRejectedValueOnce(new Error("Invalid API key."));

    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      apiKey: "sk-test"
    });

    await expect(adapter.run("Return a JSON object.")).rejects.toThrow(
      "Invalid API key."
    );
  });

  it("rejects blank SDK output text", async () => {
    createSpy.mockResolvedValueOnce({
      output_text: "   "
    });

    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      apiKey: "sk-test"
    });

    await expect(adapter.run("Return a JSON object.")).rejects.toThrow(
      "OpenAI response did not include assistant text output."
    );
  });

  it("allows template overrides to replace the ChatGPT defaults", () => {
    const adapter = new OpenAIAgentAdapter({
      model: "gpt-5.4",
      client: {
        responses: {
          create: vi.fn()
        }
      },
      promptTemplate: "Custom Template\nTask: {{task}}\nInput: {{input}}"
    });

    const prompt = adapter.buildPrompt({
      prompt: {
        role: "Extractor",
        task: "Extract a user name"
      },
      input: { text: "Jane Doe" },
      outputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string"
          }
        },
        required: ["name"]
      }
    });

    expect(prompt).toContain("Custom Template");
    expect(prompt).not.toContain("You are ChatGPT");
  });
});
