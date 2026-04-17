/** Tests covering the semantic critic strategies used by neurons. */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createNeuron } from "../src";

describe("@synapsis/neuron critic", () => {
  describe("disabled", () => {
    it("does not invoke critic prompts when critic is false", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn().mockResolvedValue("{\"name\":\"Jane\"}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "critic-disabled",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false
      });

      const result = await definition.execute({ text: "hello" });

      expect(result).toEqual({ name: "Jane" });
      expect(agent.buildCritiqueReviewPrompt).not.toHaveBeenCalled();
      expect(agent.buildCritiqueApplyPrompt).not.toHaveBeenCalled();
    });
  });

  describe("default", () => {
    it("returns the pre-critic output when the critic review is ok", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("{\"name\":\"Jane\"}")
          .mockResolvedValueOnce("{\"ok\":true}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "critic-ok",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" }
      });

      const result = await definition.execute({ text: "hello" });

      expect(agent.buildCritiqueReviewPrompt).toHaveBeenCalledTimes(1);
      expect(agent.buildCritiqueApplyPrompt).not.toHaveBeenCalled();
      expect(result).toEqual({ name: "Jane" });
    });
  });

  describe("strict", () => {
    it("applies critic feedback and returns the corrected output", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const criticFeedback = "Age is missing.";
      const criticSentence = "Check semantic completeness.";
      const runResponses = [
        "{\"name\":\"Jane\"}",
        `{\"ok\":false,\"reason\":\"${criticFeedback}\"}`,
        "{\"name\":\"Jane\",\"age\":30}"
      ];
      const agent = {
        run: vi.fn().mockImplementation(() => {
          const response = runResponses.shift();
          if (response === undefined) {
            throw new Error("No more responses");
          }

          return Promise.resolve(response);
        }),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "critic-strict",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: {
          strategy: "strict",
          sentence: criticSentence
        },
        retries: {
          postCriticRetries: 1
        }
      });

      const result = await definition.execute({ text: "hello" });

      expect(runResponses).toEqual([]);
      expect(result).toEqual({ name: "Jane", age: 30 });
      expect(agent.buildCritiqueReviewPrompt).toHaveBeenCalledWith(expect.objectContaining({
        criticSentence
      }));
      expect(agent.buildCritiqueApplyPrompt).toHaveBeenCalledWith(expect.objectContaining({
        criticFeedback,
        prompt: expect.objectContaining({
          important: expect.arrayContaining([`Critic feedback: ${criticFeedback}`])
        })
      }));
    });
  });

  describe("fallback", () => {
    it("returns the pre-critic output when post-critic repair fails", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("{\"name\":\"Jane\"}")
          .mockResolvedValueOnce("{\"ok\":false,\"reason\":\"Age is missing.\"}")
          .mockResolvedValueOnce("{\"age\":\"thirty\"}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "critic-fallback",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: {
          strategy: "fallback"
        },
        retries: {
          postCriticRetries: 1
        }
      });

      const result = await definition.execute({ text: "hello" });

      expect(result).toEqual({ name: "Jane" });
    });
  });

  describe("optimist", () => {
    it("returns the pre-critic output when critic application is invalid", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("{\"name\":\"Jane\"}")
          .mockResolvedValueOnce("{\"ok\":false,\"reason\":\"Age is missing.\"}")
          .mockResolvedValueOnce("{\"age\":\"thirty\"}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "critic-optimist",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: {
          strategy: "optimist"
        },
        retries: {
          postCriticRetries: 2
        }
      });

      const result = await definition.execute({ text: "hello" });

      expect(result).toEqual({ name: "Jane" });
      expect(agent.buildRepairPrompt).not.toHaveBeenCalled();
    });
  });

  describe("pessimist", () => {
    it("re-runs critic review until the critic finally accepts the output", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("{\"name\":\"Jane\"}")
          .mockResolvedValueOnce("{\"ok\":false,\"reason\":\"Age is missing.\"}")
          .mockResolvedValueOnce("{\"name\":\"Jane\",\"age\":30}")
          .mockResolvedValueOnce("{\"ok\":false,\"reason\":\"Use full name.\"}")
          .mockResolvedValueOnce("{\"name\":\"Jane Doe\",\"age\":30}")
          .mockResolvedValueOnce("{\"ok\":true}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "critic-pessimist",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: {
          strategy: "pessimist"
        },
        retries: {
          postCriticRetries: 2
        }
      });

      const result = await definition.execute({ text: "hello" });

      expect(agent.buildCritiqueReviewPrompt).toHaveBeenCalledTimes(3);
      expect(agent.buildCritiqueApplyPrompt).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ name: "Jane Doe", age: 30 });
    });
  });

  describe("safeExecute", () => {
    it("returns a resolved result with critic timeline steps in details when critic succeeds", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const output = JSON.stringify({ name: "Jane" });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce(output)
          .mockResolvedValueOnce("{\"ok\":true}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;

      const definition = createNeuron({
        name: "safe-success",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" }
      });

      const result = await definition.safeExecute({ text: "hello" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toEqual({ name: "Jane" });
      }
      expect(result.details.timeline).toHaveLength(4);
      expect(result.details.timeline).toMatchObject([
        expect.objectContaining({
          phase: "execution",
          output
        }),
        expect.objectContaining({
          phase: "validation",
          success: true,
          output: { name: "Jane" }
        }),
        expect.objectContaining({
          phase: "critic",
          output: JSON.stringify({ ok: true })
        }),
        expect.objectContaining({
          phase: "critic",
          success: true,
          output: { name: "Jane" }
        })
      ]);
    });
  });
});
