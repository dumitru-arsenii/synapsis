/** Tests covering pathway validation rules and direct-execution safeguards. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PathwayValidationError,
  createPathway,
  validatePathwaySteps,
  type Executable
} from "../src";

describe("@synapsis/pathway", () => {
  it("creates a pathway with the expected metadata and direct execution guard", () => {
    const messageSchema = z.object({
      message: z.string()
    });
    const ticketSchema = z.object({
      category: z.enum(["billing", "technical", "general"]),
      priority: z.enum(["low", "medium", "high"]),
      summary: z.string()
    });
    const replySchema = z.object({
      reply: z.string()
    });

    const extractIntent = {
      name: "extract-intent",
      description: "Turns a message into a structured ticket.",
      input: messageSchema,
      output: ticketSchema,
      execute: async () => ({
        category: "technical",
        priority: "medium",
        summary: "VPN login issue"
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          category: "technical",
          priority: "medium",
          summary: "VPN login issue"
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof messageSchema>, z.infer<typeof ticketSchema>>;

    const draftReply = {
      name: "draft-reply",
      description: "Drafts the support response from the structured ticket.",
      input: ticketSchema,
      output: replySchema,
      execute: async () => ({
        reply: "We are investigating: VPN login issue"
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          reply: "We are investigating: VPN login issue"
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof ticketSchema>, z.infer<typeof replySchema>>;

    const pathway = createPathway({
      name: "support-response",
      description: "Extract intent and then draft the support reply.",
      steps: [extractIntent, draftReply] as const
    });

    expect(pathway.name).toBe("support-response");
    expect(pathway.description).toBe("Extract intent and then draft the support reply.");
    expect(pathway.steps).toHaveLength(2);
    expect(pathway.steps[0]).toBe(extractIntent);
    expect(pathway.steps[1]).toBe(draftReply);
    expect(pathway.input).toBe(messageSchema);
    expect(pathway.output).toBe(replySchema);
    expect(() => pathway.execute({ message: "hello" })).toThrowError(
      'Pathway "support-response" have been created directly. Use brain.createPathway to create an executable pathway.'
    );
    expect(() => pathway.safeExecute?.({ message: "hello" })).toThrowError(
      'Pathway "support-response" have been created directly. Use brain.createPathway to create an executable pathway.'
    );
  });

  it("validates a chain when each step output matches the next step input", () => {
    const messageSchema = z.object({
      message: z.string()
    });
    const normalizedSchema = z.object({
      summary: z.string()
    });
    const resultSchema = z.object({
      result: z.string()
    });

    const normalize = {
      name: "normalize",
      description: "Normalizes the message.",
      input: messageSchema,
      output: normalizedSchema,
      execute: async (input: unknown) => {
        const { message } = input as z.infer<typeof messageSchema>;

        return {
          summary: message.trim().toUpperCase()
        };
      },
      safeExecute: async () => ({
        success: true,
        output: {
          summary: "hello"
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof messageSchema>, z.infer<typeof normalizedSchema>>;

    const finalize = {
      name: "finalize",
      description: "Builds the final payload.",
      input: normalizedSchema,
      output: resultSchema,
      execute: async (input: unknown) => {
        const { summary } = input as z.infer<typeof normalizedSchema>;

        return {
          result: `ready:${summary}`
        };
      },
      safeExecute: async (input: unknown) => {
        const { } = input as z.infer<typeof normalizedSchema>;
        return {
          success: true,
          output: {
            result: "ready:hello"
          },
          details: {}
        }
      }
    } satisfies Executable<z.infer<typeof normalizedSchema>, z.infer<typeof resultSchema>>;

    const result = validatePathwaySteps([normalize, finalize]);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects a chain when the next step would reject extra fields", () => {
    const firstInputSchema = z.object({
      message: z.string()
    });
    const firstOutputSchema = z.object({
      message: z.string(),
      score: z.number()
    });
    const secondInputSchema = z.object({
      message: z.string()
    });
    const secondOutputSchema = z.object({
      ok: z.boolean()
    });

    const first = {
      name: "first",
      description: "Produces extra fields.",
      input: firstInputSchema,
      output: firstOutputSchema,
      execute: async (input: unknown) => {
        const { message } = input as z.infer<typeof firstInputSchema>;

        return {
          message,
          score: 10
        };
      },
      safeExecute: async (input: unknown) => {
        const { message } = input as z.infer<typeof firstInputSchema>;
        return {
          success: true,
          output: {
            message: message,
            score: 10
          },
          details: {}
        }
      }
    } satisfies Executable<z.infer<typeof firstInputSchema>, z.infer<typeof firstOutputSchema>>;

    const second = {
      name: "second",
      description: "Accepts only the message field.",
      input: secondInputSchema,
      output: secondOutputSchema,
      execute: async () => ({
        ok: true
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          ok: true
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof secondInputSchema>, z.infer<typeof secondOutputSchema>>;

    const result = validatePathwaySteps([first, second]);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual([
      {
        index: 0,
        stepName: "first",
        reason: "The previous step emits this extra field, but the next step is strict and will reject it."
      }
    ]);
  });

  it("rejects incompatible field types and surfaces the first failing step", () => {
    const messageSchema = z.object({
      message: z.string()
    });
    const textPrioritySchema = z.object({
      priority: z.string()
    });
    const numericPrioritySchema = z.object({
      priority: z.number()
    });
    const weightSchema = z.object({
      weight: z.number()
    });

    const first = {
      name: "extract-intent",
      description: "Produces a text priority.",
      input: messageSchema,
      output: textPrioritySchema,
      execute: async () => ({
        priority: "high"
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          priority: "high"
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof messageSchema>, z.infer<typeof textPrioritySchema>>;

    const second = {
      name: "prioritize-ticket",
      description: "Requires a numeric priority.",
      input: numericPrioritySchema,
      output: weightSchema,
      execute: async () => ({
        weight: 100
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          weight: 100
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof numericPrioritySchema>, z.infer<typeof weightSchema>>;

    const result = validatePathwaySteps([first, second]);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual([
      {
        index: 0,
        stepName: "extract-intent",
        reason: "The previous step output schema is not assignable to the next step input schema."
      }
    ]);

    expect(() =>
      createPathway({
        name: "broken-priority-pathway",
        description: "Broken on purpose.",
        steps: [first, second] as unknown as never
      })
    ).toThrowError(PathwayValidationError);
  });

  it("rejects optional output fields when the next step requires them", () => {
    const messageSchema = z.object({
      message: z.string()
    });
    const maybeUserSchema = z.object({
      userId: z.string().optional()
    });
    const userSchema = z.object({
      userId: z.string()
    });
    const loadedSchema = z.object({
      loaded: z.boolean()
    });

    const first = {
      name: "maybe-user",
      description: "May omit the user id.",
      input: messageSchema,
      output: maybeUserSchema,
      execute: async () => ({
        userId: undefined
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          userId: undefined
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof messageSchema>, z.infer<typeof maybeUserSchema>>;

    const second = {
      name: "load-user",
      description: "Needs a definite user id.",
      input: userSchema,
      output: loadedSchema,
      execute: async () => ({
        loaded: true
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          loaded: true
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof userSchema>, z.infer<typeof loadedSchema>>;

    const result = validatePathwaySteps([first, second]);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual([
      {
        index: 0,
        stepName: "maybe-user",
        reason: "The previous step may omit this value, but the next step requires it."
      }
    ]);
  });

  it("uses JSON Schema constraints, not only base value kinds, during validation", () => {
    const messageSchema = z.object({
      message: z.string()
    });
    const shortSummarySchema = z.object({
      summary: z.string().min(3)
    });
    const longSummarySchema = z.object({
      summary: z.string().min(10)
    });
    const acceptedSchema = z.object({
      accepted: z.boolean()
    });

    const first = {
      name: "short-summary",
      description: "Can produce short summaries.",
      input: messageSchema,
      output: shortSummarySchema,
      execute: async () => ({
        summary: "abc"
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          summary: "abc"
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof messageSchema>, z.infer<typeof shortSummarySchema>>;

    const second = {
      name: "long-summary-consumer",
      description: "Needs a longer summary.",
      input: longSummarySchema,
      output: acceptedSchema,
      execute: async () => ({
        accepted: true
      }),
      safeExecute: async () => ({
        success: true,
        output: {
          accepted: true
        },
        details: {}
      })
    } satisfies Executable<z.infer<typeof longSummarySchema>, z.infer<typeof acceptedSchema>>;

    const result = validatePathwaySteps([first, second]);

    expect(result.success).toBe(false);
    expect(result.issues).toEqual([
      {
        index: 0,
        stepName: "short-summary",
        reason: "The previous step can produce shorter strings than the next step allows."
      }
    ]);
  });
});
