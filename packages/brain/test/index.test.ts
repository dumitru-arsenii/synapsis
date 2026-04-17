/**
 * Brain integration-style tests.
 *
 * These tests exercise Brain registration, shared Cortex state, learning, and
 * queued execution behavior against the in-memory Cortex runtime.
 */
import { describe, expect, it, vi } from "vitest";
import { createMemoryCortex } from "../../cortex/src/memory/index.js";
import { z } from "../../neuron/src/index";
import {
  createBrain,
  type BrainDefinition,
  type BrainPathwayRun
} from "../src/index";

/** Build a minimal agent stub whose prompt hooks are easy to assert against. */
function createMockAgent(output = "{\"name\":\"Jane\"}") {
  return {
    run: vi.fn().mockResolvedValue(output),
    buildPrompt: vi.fn().mockReturnValue("prompt"),
    buildRepairPrompt: vi.fn().mockReturnValue("repair"),
    buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
    buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
    buildLearningExample: vi.fn(({ input, output }) => ({
      input,
      output
    }))
  } as any;
}

/** Create a Brain backed by an isolated in-memory Cortex runtime for tests. */
function createMemoryCortexBrain(
  definition: Omit<BrainDefinition, "cortex">
) {
  const cortex = createMemoryCortex();
  const brain = createBrain({
    ...definition,
    cortex
  });

  return {
    brain,
    cortex,
    redis: cortex
  };
}

describe("@synapsis/brain", () => {
  it("requires a Cortex runtime when creating a brain", () => {
    expect(() =>
      createBrain({
        agent: createMockAgent()
      } as BrainDefinition)
    ).toThrowError("A Cortex runtime is required to create a brain.");
  });

  it("exposes only the public execution worker entrypoint from runtime", () => {
    const { brain } = createMemoryCortexBrain({
      agent: createMockAgent()
    });
    const runtimeMethodNames = [
      "getPathwayRun",
      "processPathwayQueue",
      "scheduleExecutableRun",
      "getExecutableRun",
      "getExecutableRunEvents",
      "processExecutableQueue",
      "startExecutableWorker"
    ];

    expect(brain.startExecutionWorker).toEqual(expect.any(Function));

    for (const methodName of runtimeMethodNames) {
      expect(methodName in brain).toBe(false);
    }
  });

  it("creates neurons through the existing neuron factory and injects the brain agent", async () => {
    const agent = createMockAgent("{\"name\":\"Jane\"}");
    const { brain } = createMemoryCortexBrain({
      agent
    });

    const neuron = brain.createNeuron({
      key: "extract-user",
      name: "extract-user",
      description: "Extracts a user record from raw input",
      input: z.object({
        text: z.string()
      }),
      output: z.object({
        name: z.string()
      }),
      prompt: {
        role: "Extractor",
        task: "Extract the user"
      },
      critic: false
    });

    const result = await neuron.execute({
      text: "Jane"
    });

    expect(neuron.key).toBe("extract-user");
    expect(result).toEqual({
      name: "Jane"
    });
    expect(agent.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        text: "Jane"
      }
    }));
    expect(brain.registry.root.get("extract-user")).toMatchObject({
      kind: "neuron",
      executable: neuron
    });
  });

  it("loads latest shared neuron examples from Redis before each execution", async () => {
    const agent = createMockAgent("{\"message\":\"OK\"}");
    const { brain, redis } = createMemoryCortexBrain({
      agent,
    });
    const firstExample = {
      input: {
        topic: "billing"
      },
      output: {
        message: "Use a billing tone."
      }
    };
    const secondExample = {
      input: {
        topic: "refund"
      },
      output: {
        message: "Use a refund tone."
      }
    };

    const neuron = brain.createNeuron({
      key: "learned-draft",
      name: "learned-draft",
      description: "Drafts with shared examples.",
      input: z.object({
        topic: z.string()
      }),
      output: z.object({
        message: z.string()
      }),
      prompt: {
        role: "Writer",
        task: "Draft a message"
      },
      critic: false,
      learning: {
        latest: 5
      }
    });

    await redis.memory.set("learned-draft", {
      examples: [firstExample]
    });
    await neuron.safeExecute({
      topic: "billing"
    });

    const firstPromptCall = agent.buildPrompt.mock.calls[agent.buildPrompt.mock.calls.length - 1]?.[0];

    expect(firstPromptCall.prompt.examples).toEqual([
      firstExample
    ]);

    await redis.memory.set("learned-draft", {
      examples: [firstExample, secondExample]
    });
    await neuron.safeExecute({
      topic: "refund"
    });

    const secondPromptCall = agent.buildPrompt.mock.calls[agent.buildPrompt.mock.calls.length - 1]?.[0];

    expect(secondPromptCall.prompt.examples).toEqual([
      firstExample,
      secondExample
    ]);
  });

  it("persists learned neuron examples back to shared Redis memory", async () => {
    const agent = createMockAgent();
    agent.run
      .mockResolvedValueOnce("{\"wrong\":\"bad\"}")
      .mockResolvedValueOnce("{\"message\":\"fixed\"}");

    const { brain, redis } = createMemoryCortexBrain({
      agent,
    });

    const neuron = brain.createNeuron({
      key: "learned-draft-persist",
      name: "learned-draft-persist",
      description: "Persists learned examples.",
      input: z.object({
        topic: z.string()
      }),
      output: z.object({
        message: z.string()
      }),
      prompt: {
        role: "Writer",
        task: "Draft a message"
      },
      critic: false,
      learning: {
        latest: 5
      }
    });

    const result = await neuron.safeExecute({
      topic: "billing"
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      output: {
        message: "fixed"
      }
    }));
    expect(await redis.memory.get("learned-draft-persist")).toEqual({
      examples: [
        {
          input: {
            topic: "billing"
          },
          output: {
            message: "fixed"
          }
        }
      ]
    });
  });

  it("creates thin action wrappers and registers them by brain key", async () => {
    const { brain } = createMemoryCortexBrain({
      agent: createMockAgent()
    });

    const trimMessage = brain.createAction({
      key: "trim-message",
      name: "trim-message",
      description: "Trims input text.",
      input: z.object({
        message: z.string()
      }),
      output: z.object({
        message: z.string()
      }),
      run: async (input: { message: string }) => ({
        message: input.message.trim()
      })
    });

    const success = await trimMessage.execute({
      message: "  hello  "
    });
    const failure = await trimMessage.safeExecute({
      wrong: true
    });

    expect(trimMessage.key).toBe("trim-message");
    expect(success).toEqual({
      message: "hello"
    });
    expect(failure.success).toBe(false);
    expect(brain.registry.root.get("trim-message")).toMatchObject({
      kind: "action",
      executable: trimMessage
    });
  });

  it("executes pathways through the brain while preserving low-level pathway validation", async () => {
    const { brain } = createMemoryCortexBrain({
      agent: createMockAgent(),
      options: {
        pathwayWaitIntervalMs: 5,
        pathwayWaitTimeoutMs: 250
      }
    });

    const normalize = brain.createAction({
      key: "normalize",
      name: "normalize",
      description: "Normalize the input message.",
      input: z.object({
        message: z.string()
      }),
      output: z.object({
        summary: z.string()
      }),
      run: async (input: { message: string }) => ({
        summary: input.message.trim().toUpperCase()
      })
    });

    const finalize = brain.createAction({
      key: "finalize",
      name: "finalize",
      description: "Finalize the normalized payload.",
      input: z.object({
        summary: z.string()
      }),
      output: z.object({
        result: z.string()
      }),
      run: async (input: { summary: string }) => ({
        result: `ready:${input.summary}`
      })
    });

    const pathway = brain.createPathway({
      key: "message-pipeline",
      name: "message-pipeline",
      description: "Normalizes then finalizes.",
      steps: [normalize, finalize] as const
    });

    const stopWorker = brain.startExecutionWorker("pathway-worker");

    try {
      const result = await pathway.execute({
        message: "  hello  "
      });

      expect(pathway.key).toBe("message-pipeline");
      expect(result).toEqual({
        result: "ready:HELLO"
      });
      expect(brain.registry.root.get("message-pipeline")).toMatchObject({
        kind: "pathway",
        executable: pathway
      });
    } finally {
      stopWorker();
    }
  });

  it("queues pathways in redis, persists run snapshots, and lets a worker finish them", async () => {
    const { brain, redis } = createMemoryCortexBrain({
      agent: createMockAgent(),
      options: {
        pathwayWaitIntervalMs: 5,
        pathwayWaitTimeoutMs: 250
      }
    });

    const normalize = brain.createAction({
      key: "queued-normalize",
      name: "queued-normalize",
      description: "Normalize queued input.",
      input: z.object({
        message: z.string()
      }),
      output: z.object({
        summary: z.string()
      }),
      run: async (input: { message: string }) => ({
        summary: input.message.trim().toUpperCase()
      })
    });

    const finalize = brain.createAction({
      key: "queued-finalize",
      name: "queued-finalize",
      description: "Finalize queued output.",
      input: z.object({
        summary: z.string()
      }),
      output: z.object({
        result: z.string()
      }),
      run: async (input: { summary: string }) => ({
        result: `ready:${input.summary}`
      })
    });

    const pathway = brain.createPathway({
      key: "queued-pathway",
      name: "queued-pathway",
      description: "Persist and execute a queued pathway.",
      steps: [normalize, finalize] as const
    });

    const executionPromise = pathway.safeExecute({
      message: "  hello  "
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopWorker = brain.startExecutionWorker("worker-1");

    try {
      const execution = await executionPromise;
      const runId = (execution.details as { runId: string }).runId;
      const storedRun = await redis.memory.get<BrainPathwayRun>("pathway:run:" + runId);

      expect(execution.success).toBe(true);
      expect(storedRun).toEqual(expect.objectContaining({
        pathwayKey: "queued-pathway",
        status: "completed",
        output: {
          result: "ready:HELLO"
        },
        snapshot: expect.objectContaining({
          pathwayKey: "queued-pathway",
          steps: [
            expect.objectContaining({
              key: "queued-normalize",
              kind: "action"
            }),
            expect.objectContaining({
              key: "queued-finalize",
              kind: "action"
            })
          ]
        })
      }));
      expect(await redis.memory.get("pathway:run:" + runId + ":steps:0")).toEqual(
        expect.objectContaining({
          status: "success",
          output: {
            summary: "HELLO"
          }
        })
      );
      expect(await redis.memory.get("pathway:run:" + runId + ":steps:1")).toEqual(
        expect.objectContaining({
          status: "success",
          output: {
            result: "ready:HELLO"
          }
        })
      );
    } finally {
      stopWorker();
    }
  });

  it("stores shared neuron memory when a neuron executes inside a queued pathway", async () => {
    const { brain, redis } = createMemoryCortexBrain({
      agent: createMockAgent("{\"message\":\"HELLO\"}"),
      options: {
        pathwayWaitIntervalMs: 5,
        pathwayWaitTimeoutMs: 250
      }
    });

    const neuron = brain.createNeuron({
      key: "draft-message",
      name: "draft-message",
      description: "Drafts a message.",
      input: z.object({
        topic: z.string()
      }),
      output: z.object({
        message: z.string()
      }),
      prompt: {
        role: "Writer",
        task: "Draft a message"
      },
      critic: false,
      learning: {
        latest: 5
      }
    });

    const finalize = brain.createAction({
      key: "message-to-result",
      name: "message-to-result",
      description: "Convert a drafted message into the final result.",
      input: z.object({
        message: z.string()
      }),
      output: z.object({
        result: z.string()
      }),
      run: async (input: { message: string }) => ({
        result: `ready:${input.message}`
      })
    });

    const pathway = brain.createPathway({
      key: "neuron-pathway",
      name: "neuron-pathway",
      description: "Run a neuron and finalize its output.",
      steps: [neuron, finalize] as const
    });

    const executionPromise = pathway.safeExecute({
      topic: "hello"
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopWorker = brain.startExecutionWorker("worker-neuron");

    try {
      const execution = await executionPromise;
      const runId = (execution.details as { runId: string }).runId;
      const run = await redis.memory.get<BrainPathwayRun>("pathway:run:" + runId);
      const memoryKey = "draft-message";

      expect(execution.success).toBe(true);
      expect(run?.steps[0]).toEqual(expect.objectContaining({
        name: "draft-message",
        memoryKey
      }));
      expect(await redis.memory.get(memoryKey)).toEqual({
        examples: []
      });
    } finally {
      stopWorker();
    }
  });

  it("requeues failed pathway runs and completes them on retry", async () => {
    const { brain, redis } = createMemoryCortexBrain({
      agent: createMockAgent(),
      options: {
        pathwayWaitIntervalMs: 5,
        pathwayWaitTimeoutMs: 500,
        pathwayMaxRetries: 1
      }
    });

    let attempts = 0;

    const flakyNormalize = brain.createAction({
      key: "flaky-normalize",
      name: "flaky-normalize",
      description: "Fail once, then normalize successfully.",
      input: z.object({
        message: z.string()
      }),
      output: z.object({
        summary: z.string()
      }),
      run: async (input: { message: string }) => {
        attempts += 1;

        if (attempts === 1) {
          throw new Error("temporary failure");
        }

        return {
          summary: input.message.trim().toUpperCase()
        };
      }
    });

    const finalize = brain.createAction({
      key: "retry-finalize",
      name: "retry-finalize",
      description: "Finalize the retried output.",
      input: z.object({
        summary: z.string()
      }),
      output: z.object({
        result: z.string()
      }),
      run: async (input: { summary: string }) => ({
        result: `ready:${input.summary}`
      })
    });

    const pathway = brain.createPathway({
      key: "retry-pathway",
      name: "retry-pathway",
      description: "Demonstrate pathway retry behavior.",
      steps: [flakyNormalize, finalize] as const
    });

    const executionPromise = pathway.safeExecute({
      message: "  hello  "
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopWorker = brain.startExecutionWorker("retry-worker");

    try {
      const execution = await executionPromise;
      const run = await redis.memory.get<BrainPathwayRun>(
        "pathway:run:" + (execution.details as { runId: string }).runId
      );

      expect(execution).toEqual(expect.objectContaining({
        success: true,
        output: {
          result: "ready:HELLO"
        }
      }));
      expect(attempts).toBe(2);
      expect(run).toEqual(expect.objectContaining({
        status: "completed",
        retryCount: 1
      }));
      expect(run?.steps[0]).toEqual(expect.objectContaining({
        status: "success",
        retries: 1
      }));
    } finally {
      stopWorker();
    }
  });

  it("enforces brain-level key uniqueness across registered objects", () => {
    const { brain } = createMemoryCortexBrain({
      agent: createMockAgent()
    });

    brain.createAction({
      key: "shared-key",
      name: "shared-key",
      description: "Occupy the shared key in the registry.",
      input: z.object({
        value: z.string()
      }),
      output: z.object({
        value: z.string()
      }),
      run: async (input: { value: string }) => ({
        value: input.value
      })
    });

    expect(() =>
      brain.createPathway({
        key: "shared-key",
        name: "shared-key",
        description: "Attempt to reuse an existing registry key.",
        steps: [
          brain.createAction({
            key: "step-one",
            name: "step-one",
            description: "Single step used in the duplicate pathway test.",
            input: z.object({
              value: z.string()
            }),
            output: z.object({
              value: z.string()
            }),
            run: async (input: { value: string }) => ({
              value: input.value
            })
          })
        ] as const
      })
    ).toThrowError('Brain already has a registered pathway with key "shared-key".');
  });
});
