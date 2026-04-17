/**
 * Semantic critic pipeline.
 *
 * The critic reviews already-validated outputs for semantic completeness and
 * can optionally rewrite or repair them before the neuron returns control.
 */
import { type ZodIssue, boolean, string, object } from "zod";
import { learn } from "./learning";
import { retryConsumed, withTimelineStep, type NeuronState, type StatedResult } from "./state";
import type { CriticConfig, NeuronDefinition } from "./types";
import { repairLoop, safeParseUnknown } from "./validation";
import { runAgentWithRetries } from "./task";

/** Schema used for the critic's structured review response. */
export const criticSchema = object({
    ok: boolean(),
    reason: string().optional()
})

/** Resolve critic defaults from a neuron definition. */
export function resolveCriticConfig<I, O>(
    definition: NeuronDefinition<I, O>
): Required<CriticConfig & { enabled: boolean }> {
    return {
        enabled: typeof definition.critic === "boolean" ? definition.critic : true,
        sentence: (definition?.critic as CriticConfig)?.sentence || "",
        strategy: (definition?.critic as CriticConfig)?.strategy || "strict"
    }
}

/** Run the semantic critic flow for a structurally valid neuron output. */
export async function critic<I, O>(
    state: NeuronState<I, O>,
    output: O,
): Promise<StatedResult<I, O>> {
    const prompt = state.agent.buildCritiqueReviewPrompt({
        prompt: state.promptDefinition,
        input: state.input,
        output,
        outputSchema: state.output.schema,
        criticSentence: state.critic.sentence
    })

    const maybeRetriedPromptResult = await runAgentWithRetries(state, prompt);

    if (!maybeRetriedPromptResult.success) {
        return {
            success: false,
            error: maybeRetriedPromptResult.error,
            output,
            state: maybeRetriedPromptResult.state
        }
    }

    const response = maybeRetriedPromptResult.output;

    const afterPropmtState = withTimelineStep(state, {
        phase: "critic",
        prompt,
        output: response,
    });

    const criticResponseParsed = safeParseUnknown(criticSchema, response, true);

    if (!criticResponseParsed.success) {
        const newState = withTimelineStep(afterPropmtState, {
            phase: 'validation',
            success: false,
            output: criticResponseParsed.data as unknown,
            errors: criticResponseParsed.error.issues
        })

        if (newState.retries.max <= 0) {
            return {
                success: false,
                output,
                error: criticResponseParsed.error,
                state: newState
            }
        }

        return critic(retryConsumed(newState, 'critic'), output);
    }

    // The critic accepted the original output, so the neuron can finish here.
    if (criticResponseParsed.data.ok || !criticResponseParsed.data.reason) {
        return {
            success: true,
            output,
            state: withTimelineStep(afterPropmtState, {
                phase: 'critic',
                success: true,
                output,
            })
        };
    }

    // Ask the model to rewrite the output using the critic's feedback as a rule.
    const applyPrompt = afterPropmtState.agent.buildCritiqueApplyPrompt({
        prompt: {
            ...afterPropmtState.promptDefinition,
            important: [
                ...(afterPropmtState.promptDefinition.important || []),
                `Critic feedback: ${criticResponseParsed.data.reason!}`
            ]
        },
        input: afterPropmtState.input,
        output,
        outputSchema: afterPropmtState.output.schema,
        criticFeedback: criticResponseParsed.data.reason!
    })

    const maybeRetriedApplyPromptResult = await runAgentWithRetries(afterPropmtState, applyPrompt);

    if (!maybeRetriedApplyPromptResult.success) {
        return {
            success: false,
            error: maybeRetriedApplyPromptResult.error,
            output,
            state: maybeRetriedApplyPromptResult.state
        }
    }

    const applyResponse = maybeRetriedApplyPromptResult.output;

    const afterApplyPromptState = withTimelineStep(afterPropmtState, {
        phase: "critic",
        applyPrompt,
        output: applyResponse,
    });

    const applyResponseParsed = safeParseUnknown<O>(state.output.parser, applyResponse, true);

    if (!applyResponseParsed.success) {
        const newState = withTimelineStep(afterApplyPromptState, {
            phase: 'validation',
            success: false,
            output: applyResponseParsed.data as unknown,
            errors: applyResponseParsed.error.issues
        });

        switch (state.critic.strategy) {
            case "optimist":
                return {
                    success: true,
                    output,
                    state: newState
                };
            case "fallback":
                return fallbackCritic(newState, output, applyResponseParsed.error.issues);
            case "pessimist":
                return pessimistCritic(newState, output, applyResponseParsed.error.issues);
            default:
                return strictCritic(newState, output, applyResponseParsed.error.issues);
        }
    }

    const validatedState = withTimelineStep(afterApplyPromptState, {
        phase: 'validation',
        success: true,
        output: applyResponseParsed.data,
    });

    if (state.critic.strategy === "pessimist") {
        return critic(validatedState, applyResponseParsed.data);
    }

    return {
        success: true,
        output: applyResponseParsed.data,
        state: validatedState
    };
}

async function strictCritic<I, O>(
    state: NeuronState<I, O>,
    output: O,
    errors: ZodIssue[]
): Promise<StatedResult<I, O>> {
    const repairResult = await repairLoop(state, output, errors, 'postCritic');

    if (!repairResult.success) {
        return repairResult;
    }

    return learn(state, repairResult.output, errors);
}

/** Pessimist mode reapplies the critic even after a successful repair. */
async function pessimistCritic<I, O>(
    state: NeuronState<I, O>,
    output: O,
    errors: ZodIssue[]
): Promise<StatedResult<I, O>> {
    const repairResult = await repairLoop(state, output, errors, 'postCritic');

    if (!repairResult.success) {
        return repairResult;
    }

    await learn(state, repairResult.output, errors);

    return critic(repairResult.state, repairResult.output);
}

/** Fallback mode returns the original pre-critic output when repair cannot converge. */
async function fallbackCritic<I, O>(
    state: NeuronState<I, O>,
    output: O,
    errors: ZodIssue[]
): Promise<StatedResult<I, O>> {
    const result = await strictCritic(state, output, errors);

    if (!result.success) {
        return {
            success: true,
            output,
            state: result.state
        };
    }

    return result;
}
