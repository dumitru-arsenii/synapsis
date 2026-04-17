/** Tests for neuron validation, repair loops, and connection retry behavior. */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createNeuron, type PromptDefinition } from "../src";

describe("@synapsis/neuron validation", () => {
  describe("createNeuron", () => {
    it("creates a neuron with execute and safeExecute", () => {
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
        name: "extract-user",
        description: "Extracts a user record from raw input",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: {
          role: "Extractor",
          task: "Extract structured data from the provided text"
        },
        critic: false
      });

      expect(definition.execute).toBeTypeOf("function");
      expect(definition.safeExecute).toBeTypeOf("function");
    });

    it("preserves a prompt factory for runtime-driven prompt construction", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        facts: z.array(z.string())
      });
      type Input = z.infer<typeof inputSchema>;
      type Output = z.infer<typeof outputSchema>;
      const agent = {
        run: vi.fn().mockResolvedValue("{\"facts\":[\"Mars is red\"]}"),
        buildPrompt: vi.fn().mockReturnValue("prompt"),
        buildRepairPrompt: vi.fn().mockReturnValue("repair"),
        buildCritiqueReviewPrompt: vi.fn().mockReturnValue("critic-review"),
        buildCritiqueApplyPrompt: vi.fn().mockReturnValue("critic-apply"),
        buildLearningExample: vi.fn(({ input, output }) => ({
          input,
          output
        }))
      } as any;
      const prompt = ({ input }: { input: Input }) =>
        ({
          role: "Extractor",
          task: `Extract facts from: ${input.text}`,
          important: ["Use only the provided text"]
        }) satisfies PromptDefinition<Input, Output>;

      const definition = createNeuron({
        name: "extract-facts",
        description: "Builds prompts from runtime input",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt,
        critic: false
      });

      await definition.execute({ text: "Mars is red" });

      expect(agent.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.objectContaining({ task: "Extract facts from: Mars is red" })
      }));
    });
  });

  describe("input validation", () => {
    it("rejects invalid input before the agent runs", async () => {
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
        name: "input-validation",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false
      });

      await expect(definition.execute({ wrong: "data" })).rejects.toBeInstanceOf(z.ZodError);
      expect(agent.run).not.toHaveBeenCalled();
    });
  });

  describe("execution", () => {
    it("invokes agent.buildPrompt and agent.run on the happy path", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn().mockResolvedValue("{\"name\":\"Jane\",\"age\":30}"),
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
        name: "happy-path",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false
      });

      const result = await definition.execute({ text: "hello" });

      expect(agent.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
        input: { text: "hello" }
      }));
      expect(agent.run).toHaveBeenCalledWith("prompt");
      expect(result).toEqual({ name: "Jane", age: 30 });
    });

    it("retries provider failures before validation starts", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockRejectedValueOnce(new Error("temporary provider failure"))
          .mockResolvedValueOnce("{\"name\":\"Jane\",\"age\":30}"),
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
        name: "retry-provider",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false,
        retries: {
          max: 1
        }
      });

      const result = await definition.execute({ text: "hello" });

      expect(agent.run).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ name: "Jane", age: 30 });
    });
  });

  describe("repair loop combinations", () => {
    it("repairs invalid output when the second attempt validates", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("{\"age\":\"thirty\"}")
          .mockResolvedValueOnce("{\"name\":\"Jane\",\"age\":30}"),
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
        name: "repair-success",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false,
        retries: {
          max: 1
        }
      });

      const result = await definition.execute({ text: "hello" });

      expect(agent.buildRepairPrompt).toHaveBeenCalled();
      expect(result).toEqual({ name: "Jane", age: 30 });
    });

    it("retries plain-text invalid output through repair", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("Invalid JSON plain text")
          .mockResolvedValueOnce("{\"name\":\"Jane\"}"),
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
        name: "repair-text",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false,
        retries: {
          max: 1
        }
      });

      await definition.execute({ text: "hello" });

      expect(agent.buildRepairPrompt).toHaveBeenCalled();
      expect(agent.run).toHaveBeenNthCalledWith(2, "repair");
    });

    it("stores a learning example after a successful repair when learning is enabled", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const learningStorage = {
        add: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        rem: vi.fn()
      };
      const agent = {
        run: vi.fn()
          .mockResolvedValueOnce("{\"age\":\"thirty\"}")
          .mockResolvedValueOnce("{\"name\":\"Jane\",\"age\":30}"),
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
        name: "repair-learning",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false,
        retries: {
          max: 1
        },
        learning: {
          onlyFailedFields: true,
          storage: learningStorage
        }
      });

      await definition.execute({ text: "hello" });

      expect(learningStorage.add).toHaveBeenCalledTimes(1);
    });

    it("fails after retries are exhausted", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn().mockResolvedValue("{\"wrong\":\"data\"}"),
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
        name: "repair-exhausted",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false,
        retries: {
          max: 1
        }
      });

      await expect(definition.execute({ text: "hello" })).rejects.toBeInstanceOf(Error);
      expect(agent.run).toHaveBeenCalledTimes(2);
    });
  });

  describe("safeExecute", () => {
    it("returns a resolved result with the validation timeline in details on success", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const output = JSON.stringify({ name: "Jane" });
      const agent = {
        run: vi.fn().mockResolvedValueOnce(output),
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
        prompt: { role: "test", task: "test" },
        critic: false
      });

      const result = await definition.safeExecute({ text: "hello" });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toEqual({ name: "Jane" });
      }
      expect((result.details as any).timeline).toMatchObject([
        expect.objectContaining({
          phase: "execution",
          output
        }),
        expect.objectContaining({
          phase: "validation",
          success: true,
          output: { name: "Jane" }
        })
      ]);
    });

    it("returns a rejected result with the failed validation step", async () => {
      const inputSchema = z.object({
        text: z.string()
      });
      const outputSchema = z.object({
        name: z.string(),
        age: z.number().optional()
      });
      const agent = {
        run: vi.fn().mockResolvedValue("{\"wrong\":\"data\"}"),
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
        name: "safe-failure",
        description: "test",
        input: inputSchema,
        output: outputSchema,
        agent,
        prompt: { role: "test", task: "test" },
        critic: false
      });

      const result = await definition.safeExecute({ text: "hello" });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.output).toEqual({ wrong: "data" });
        expect(result.error).toBeInstanceOf(Error);
      }
      expect((result.details as any).timeline.find((step: any) => step.phase === "validation" && step.success === false)).toBeTruthy();
    });
  });
});
