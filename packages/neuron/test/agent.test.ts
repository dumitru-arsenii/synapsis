/** Tests for agent prompt construction and template override behavior. */
import { describe, expect, it } from "vitest";
import type { JsonSchema7Type } from "zod-to-json-schema";
import { AbstractAgent } from "../src";

describe("@synapsis/neuron", () => {
  describe("AbstractAgent", () => {
    describe("constructor", () => {
      it("allows all core templates to be overridden", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })({
          promptTemplate: "Custom task: {{task}}\nPayload: {{input}}",
          repairTemplate: "Repair errors: {{errors}}",
          critiqueReviewTemplate: "Review output: {{output}}",
          critiqueApplyTemplate: "Apply feedback: {{criticFeedback}}",
          exampleTemplate: "Example Input: {{input}}\nExample Output: {{output}}",
          criticSentenceTemplate: "Use the project-specific review checklist."
        });

        const prompt = agent.buildPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user"
          },
          input: { text: "Jane" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] }
        });

        const repair = agent.buildRepairPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user"
          },
          input: { text: "Jane" },
          output: { age: "wrong" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] },
          errors: [
            {
              code: "invalid_type",
              expected: "number",
              received: "string",
              path: ["age"],
              message: "Expected number, received string"
            }
          ]
        });

        const review = agent.buildCritiqueReviewPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user"
          },
          input: { text: "Jane" },
          output: { name: "Jane" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] }
        });

        const apply = agent.buildCritiqueApplyPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user"
          },
          input: { text: "Jane" },
          output: { name: "Jane" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] },
          criticFeedback: "Name is missing confidence metadata."
        });

        expect(prompt).toContain("Custom task: Extract user");
        expect(repair).toContain("Repair errors:");
        expect(review).toContain("Review output:");
        expect(apply).toContain("Apply feedback:");
      });
    });

    describe("buildPrompt", () => {
      it("maps input to a reusable prompt string", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })();

        expect(agent.renderInput({ text: "John is 28" })).toContain("\"text\": \"John is 28\"");
      });

      it("maps output schema to a reusable prompt string", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })();

        const schema = agent.renderOutputSchema({
          name: { type: "string" },
          age: { type: "number" }
        });

        expect(schema).toContain("\"name\": {");
        expect(schema).toContain("\"type\": \"string\"");
        expect(schema).toContain("\"age\": {");
        expect(schema).toContain("\"type\": \"number\"");
      });

      it("uses the example template when rendering few-shot examples", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })({
          exampleTemplate: "Example Input: {{input}}\nExample Output: {{output}}"
        });

        const prompt = agent.buildPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user details",
            examples: [
              {
                input: { text: "Jane is 34" },
                output: { name: "Jane", age: 34 }
              }
            ]
          },
          input: { text: "John is 28" },
          outputSchema: { type: 'object', properties: { name: { type: "string" }, age: { type: "number" } }, required: ['name', 'age'] }
        });

        expect(prompt).toContain("Example Input:");
        expect(prompt).toContain("Example Output:");
      });
    });

    describe("critic templates", () => {
      it("uses the provided critic sentence in the review prompt", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })();

        const prompt = agent.buildCritiqueReviewPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user details"
          },
          input: { text: "John is 28" },
          output: { name: "John" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] },
          criticSentence: "Verify nothing important is missing."
        });

        expect(prompt).toContain("Verify nothing important is missing.");
        expect(prompt).toContain("\"name\": \"John\"");
        expect(prompt).toContain("\"ok\": boolean");
      });

      it("falls back to the default critic sentence", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })();
        const details = {
          prompt: {
            role: "Extractor",
            task: "Extract user details"
          },
          input: { text: "John is 28" },
          output: { name: "John" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] }
        } as const

        const prompt = agent.buildCritiqueReviewPrompt(details);

        expect(prompt).not.toContain(details.prompt.role);
        expect(prompt).toContain(details.prompt.task);
        expect(prompt).toContain(details.input.text);
        expect(prompt).toContain(details.output.name);
      });

      it("includes critic feedback in the apply prompt", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })();

        const prompt = agent.buildCritiqueApplyPrompt({
          prompt: {
            role: "Extractor",
            task: "Extract user details",
            important: ["Return JSON only"]
          },
          input: { text: "John is 28" },
          output: { name: "John" },
          outputSchema: { type: 'object', properties: { name: { type: "string" } }, required: ['name'] },
          criticFeedback: "The age field is missing."
        });

        expect(prompt).toContain("Critic Feedback:");
        expect(prompt).toContain("The age field is missing.");
        expect(prompt).toContain("- Return JSON only");
      });
    });

    describe("buildLearningExample", () => {
      it("keeps valid data while blanking only failing output fields", () => {
        const agent = new (class extends AbstractAgent {
          async run(): Promise<string> {
            return "{\"name\":\"Jane\"}";
          }

          public renderInput<I>(input: I): string {
            return this.mapInputToString(input);
          }

          public renderOutputSchema<O>(outputSchema: Record<keyof O, JsonSchema7Type>): string {
            return this.mapOutputSchemaToString(outputSchema);
          }
        })();

        const example = agent.buildLearningExample({
          input: { text: "Jane is 34" },
          output: {
            profile: {
              name: "Jane",
              age: 34
            }
          } as any,
          errors: [
            {
              code: "invalid_type",
              expected: "number",
              received: "string",
              path: ["profile", "age"],
              message: "Expected number, received string"
            }
          ]
        });

        expect(example).toEqual({
          input: { text: "Jane is 34" },
          output: {
            profile: {
              name: "Jane",
              age: 34
            }
          }
        });
      });
    });
  });
});
