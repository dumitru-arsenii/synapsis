/**
 * OpenAI-specific prompt templates.
 *
 * Keeping these templates in a dedicated module makes the wording easy to
 * inspect, override, and evolve independently from the SDK adapter.
 */
import type { AgentTemplateOverrides } from "@synapsis/neuron";

/**
 * OpenAI-oriented prompt templates for Synapsis agents backed by ChatGPT-style
 * models.
 *
 * The base neuron package ships with provider-agnostic templates. This module
 * keeps the OpenAI-flavored wording in one place so package consumers can read,
 * reuse, and override those defaults without touching transport logic.
 */
export const openAIChatGPTTemplates = {
  /**
   * Main execution template used for the first model pass.
   */
  promptTemplate: `You are ChatGPT, operating as a structured extraction and reasoning engine for OpenAI Responses API workloads.

Follow the user's task exactly, use the provided context and examples, and keep the answer concise unless the task requires more detail.

Role:
{{role}}

Task:
{{task}}

Context:
{{backstory}}

Rules:
{{important}}

Examples:
{{examples}}

Input:
{{input}}

Return ONLY a valid JSON object that matches this schema exactly:
{{outputSchema}}`,

  /**
   * Repair template used after the runtime detects schema validation failures.
   */
  repairTemplate: `You are ChatGPT correcting your previous JSON response after schema validation failed.

Original Task:
{{task}}

Context:
{{backstory}}

Rules:
{{important}}

Input:
{{input}}

Invalid Output:
{{output}}

Schema Errors:
{{errors}}

Return ONLY the corrected JSON object that matches this schema exactly:
{{outputSchema}}`,

  /**
   * Review template used by the semantic critic before accepting a valid JSON
   * object.
   */
  critiqueReviewTemplate: `You are ChatGPT reviewing a JSON answer before it is accepted. Check semantic correctness, completeness, and whether the response used the relevant input. {{criticSentence}}

Task:
{{task}}

Context:
{{backstory}}

Rules:
{{important}}

Input:
{{input}}

Current Output:
{{output}}

Return ONLY a JSON object with this exact shape:
{
  "ok": boolean,
  "reason": string
}

Use "ok": true only when the output is already correct and complete. Use "ok": false when anything is missing, misplaced, or semantically wrong, and explain it in "reason".`,

  /**
   * Rewrite template used when critic feedback must be applied to a valid but
   * semantically incomplete output.
   */
  critiqueApplyTemplate: `You are ChatGPT fixing a JSON answer using critic feedback.

Task:
{{task}}

Context:
{{backstory}}

Rules:
{{important}}

Input:
{{input}}

Current Output:
{{output}}

Critic Feedback:
{{criticFeedback}}

Return ONLY the corrected JSON object that matches this schema exactly:
{{outputSchema}}`,

  /**
   * Few-shot example rendering template.
   */
  exampleTemplate: `Example Input:
{{input}}

Example Output:
{{output}}`,

  /**
   * Extra strictness sentence injected into critic review prompts by default.
   */
  criticSentenceTemplate: `Be strict about missing fields, unsupported assumptions, and values placed in the wrong part of the schema.`
} satisfies Required<AgentTemplateOverrides>;

/**
 * Merge package defaults with caller-provided template overrides.
 *
 * Later spreads win, which means consumers can replace any individual template
 * while still inheriting the rest of the OpenAI-specific prompt set.
 */
export function resolveOpenAIChatGPTTemplates(
  overrides: AgentTemplateOverrides = {}
): AgentTemplateOverrides {
  return {
    ...openAIChatGPTTemplates,
    ...overrides
  };
}
