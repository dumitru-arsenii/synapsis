/**
 * Provider-agnostic agent base class.
 *
 * `AbstractAgent` owns prompt assembly and template customization while leaving
 * transport details to subclasses such as OpenAI adapters.
 */
import type { JsonSchema7Type } from "zod-to-json-schema";
import type { PromptDefinition, PromptExample, Agent, DeepPartial } from "./types";
import type { ZodIssue } from "zod";

/** Optional prompt-template overrides accepted by concrete agent adapters. */
export interface AgentTemplateOverrides {
    readonly promptTemplate?: string;
    readonly repairTemplate?: string;
    readonly critiqueReviewTemplate?: string;
    readonly critiqueApplyTemplate?: string;
    readonly exampleTemplate?: string;
    readonly criticSentenceTemplate?: string;
}

/** Base implementation of the Synapsis agent contract. */
export abstract class AbstractAgent implements Agent {
    // Prompt used for the main task.
    protected promptTemplate: string = `Role:\n{{role}}\n\nTask:\n{{task}}\n\nContext:\n{{backstory}}\n\nRules:\n{{important}}\n\nExamples:\n{{examples}}\n\nInput:\n{{input}}\n\nReturn ONLY a JSON object matching this schema:\n{{outputSchema}}`;

    // Prompt used when the model returned something that failed schema validation.
    protected repairTemplate: string = `Your previous output failed validation. Please fix the strict schema errors.\n\nOriginal Task:\n{{task}}\n\nInvalid Output:\n{{output}}\n\nSchema Errors:\n{{errors}}\n\nReturn ONLY a JSON object matching this schema:\n{{outputSchema}}`;

    // Prompt used to review a valid output semantically before trying to rewrite it.
    protected critiqueReviewTemplate: string = `Review whether the current output fully satisfies the task semantically, uses all relevant input, and places everything in the correct shape. {{criticSentence}}\n\nTask: {{task}}\nContext: {{backstory}}\nRules:\n{{important}}\n\nInput:\n{{input}}\n\nCurrent Output:\n{{output}}\n\nReturn ONLY a JSON object with this shape:\n{\n  "ok": boolean,\n  "reason": string\n}\n\nSet "ok" to true only if the output is already fully correct. When "ok" is true, "reason" may be omitted or empty. When "ok" is false, "reason" must explain exactly what is missing, incorrect, or incomplete.`;

    // Prompt used when critic review found a semantic gap that should be applied to the output.
    protected critiqueApplyTemplate: string = `The current output is structurally valid, but the critic found semantic issues that must be fixed.\n\nTask: {{task}}\nContext: {{backstory}}\nRules:\n{{important}}\n\nInput:\n{{input}}\n\nCurrent Output:\n{{output}}\n\nCritic Feedback:\n{{criticFeedback}}\n\nReturn ONLY the corrected JSON object matching this schema:\n{{outputSchema}}`;

    // Template used for each few-shot example embedded into the main prompt.
    protected exampleTemplate: string = `Input: {{input}}\nOutput: {{output}}`;

    protected criticSentenceTemplate: string = `Pay special attention to whether the output fully satisfies the task semantically, uses all relevant input, and places everything in the correct shape.`;

    /** Apply optional template overrides while keeping sensible runtime defaults. */
    constructor(templates: AgentTemplateOverrides = {}) {
        if (templates.promptTemplate !== undefined) {
            this.promptTemplate = templates.promptTemplate;
        }

        if (templates.repairTemplate !== undefined) {
            this.repairTemplate = templates.repairTemplate;
        }

        if (templates.critiqueReviewTemplate !== undefined) {
            this.critiqueReviewTemplate = templates.critiqueReviewTemplate;
        }

        if (templates.critiqueApplyTemplate !== undefined) {
            this.critiqueApplyTemplate = templates.critiqueApplyTemplate;
        }

        if (templates.exampleTemplate !== undefined) {
            this.exampleTemplate = templates.exampleTemplate;
        }

        if (templates.criticSentenceTemplate !== undefined) {
            this.criticSentenceTemplate = templates.criticSentenceTemplate;
        }
    }

    abstract run(prompt: string): Promise<string>;

    /** Build the main prompt that includes role, task, context, rules, examples, and schema. */
    buildPrompt<I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            outputSchema: JsonSchema7Type;
        }
    ): string {
        const p = details.prompt;
        // Convert structured rules/examples into plain text blocks that are easy for any LLM to consume.
        const important = p.important?.length ? p.important.map((rule: string) => `- ${rule}`).join('\n') : undefined;
        // Each example is rendered through the example template so subclasses can change its shape centrally.
        const examples = p.examples?.length ? p.examples.map((example: PromptExample<I, O>) => this.mapExampleToString(example)).join('\n\n') : undefined;

        // Schema formatting is delegated to a dedicated hook so subclasses can customize prompt wording.
        return this.fillTemplate(this.promptTemplate, {
            role: p.role,
            task: p.task,
            backstory: p.backstory,
            important: important,
            examples: examples,
            input: this.mapInputToString(details.input),
            outputSchema: this.mapOutputSchemaToString(details.outputSchema)
        });
    }

    /** Build the critic review prompt that returns an ok/reason verdict. */
    buildCritiqueReviewPrompt<I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            criticSentence?: string;
            output: O;
            outputSchema: JsonSchema7Type;
        }
    ): string {
        return this.fillTemplate(this.critiqueReviewTemplate, {
            criticSentence: details.criticSentence ?? this.criticSentenceTemplate,
            task: details.prompt.task,
            backstory: details.prompt.backstory,
            important: details.prompt.important?.length ? details.prompt.important.map((rule: string) => `- ${rule}`).join('\n') : undefined,
            outputSchema: this.mapOutputSchemaToString(details.outputSchema),
            input: this.mapInputToString(details.input),
            output: this.mapOutputToString(details.output)
        });
    }

    /** Build the prompt that applies critic feedback to a previously valid output. */
    buildCritiqueApplyPrompt<I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            output: O;
            outputSchema: JsonSchema7Type;
            criticFeedback: string;
        }
    ): string {
        return this.fillTemplate(this.critiqueApplyTemplate, {
            task: details.prompt.task,
            backstory: details.prompt.backstory,
            important: details.prompt.important?.length ? details.prompt.important.map((rule: string) => `- ${rule}`).join('\n') : undefined,
            input: this.mapInputToString(details.input),
            output: this.mapOutputToString(details.output),
            criticFeedback: details.criticFeedback,
            outputSchema: this.mapOutputSchemaToString(details.outputSchema)
        });
    }

    /** Build the repair prompt used when the model returned something that failed schema validation. */
    buildRepairPrompt<I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            output: unknown;
            outputSchema: JsonSchema7Type;
            errors: ZodIssue[];
        }
    ): string {
        return this.fillTemplate(this.repairTemplate, {
            task: details.prompt.task,
            backstory: details.prompt.backstory,
            important: details.prompt.important?.length ? details.prompt.important.map((rule: string) => `- ${rule}`).join('\n') : undefined,
            input: this.mapInputToString(details.input),
            output: this.mapOutputToString(details.output),
            errors: details.errors.map((issue) => `- ${issue.message} (path: ${issue.path.join('.')})`).join('\n'),
            outputSchema: this.mapOutputSchemaToString(details.outputSchema)
        });
    }

    buildLearningExample<I, O>(
        details: {
            input: I;
            output: DeepPartial<O>;
            errors: ZodIssue[];
        }
    ): PromptExample<I, O> {
        // Learning examples are intentionally lightweight: just the corrected pair.
        return {
            input: details.input,
            output: details.output
        };
    }

    /** Convert a single example into a string for inclusion in the prompt. */
    protected mapExampleToString<I, O>(
        example: PromptExample<I, O>
    ): string {
        return this.fillTemplate(this.exampleTemplate, {
            input: this.mapInputToString(example.input),
            output: this.mapOutputToString(example.output)
        });
    }

    /** Convert the output schema into a human-readable string for the prompt. */
    protected mapOutputSchemaToString(
        schema: JsonSchema7Type
    ): string {
        // Default: return a compact JSON schema representation.
        // Subclasses can override this to provide a more natural language description if preferred.
        return JSON.stringify(schema, null, 2);
    }

    /** Convert the input value into a human-readable string for the prompt. */
    protected mapInputToString<I>(
        input: I
    ): string {
        // Default: return a compact JSON representation.
        // Subclasses can override this to provide a more natural language description if preferred.
        return JSON.stringify(input, null, 2);
    }

    /** Convert the output value into a human-readable string for the prompt. */
    protected mapOutputToString<O>(
        output: O
    ): string {
        // Default: return a compact JSON representation.
        // Subclasses can override this to provide a more natural language description if preferred.
        return JSON.stringify(output, null, 2);
    }

    /** Helper to fill a template string with the given values. */
    protected fillTemplate(template: string, values: Record<string, string | undefined>): string {
        let result = template;
        for (const [key, value] of Object.entries(values)) {
            if (value !== undefined) {
                result = result.replaceAll(`{{${key}}}`, value);
            }
        }

        // Strip unresolved placeholders so optional sections can be omitted cleanly.
        return result.replaceAll(/{{.*?}}/g, '');
    }
}
