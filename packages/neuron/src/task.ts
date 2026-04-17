/**
 * Neuron task execution helpers.
 *
 * This module runs the main agent prompt, validates the response, and handles
 * retryable provider failures before the critic phase begins.
 */
import { learn } from "./learning";
import { connectionRetryConsumed, withTimelineStep, type NeuronState, type StatedResult } from "./state";
import { repairLoop, safeParseUnknown } from "./validation";

/** Run the main neuron execution pass before optional critic review. */
export async function execute<I, O>(
    state: NeuronState<I, O>
): Promise<StatedResult<I, O>> {
    const prompt = state.agent.buildPrompt({
        prompt: state.promptDefinition,
        input: state.input,
        outputSchema: state.output.schema
    })

    const maybeRetriedPromptResult = await runAgentWithRetries<I, O>(state, prompt);

    if (!maybeRetriedPromptResult.success) {
        return {
            success: false,
            error: maybeRetriedPromptResult.error,
            output: undefined,
            state: maybeRetriedPromptResult.state
        }
    }

    const response = maybeRetriedPromptResult.output;

    // Capture the raw model output before validation and repair possibly transform it.
    const afterPropmtState: NeuronState<I, O> = withTimelineStep<I, O>(maybeRetriedPromptResult.state,
        {
            phase: "execution",
            prompt,
            output: response,
            learningExamples: await state.learning.storage.list()
        }
    );

    const parsed = safeParseUnknown<O>(state.output.parser, response, true);

    if (!parsed.success) {
        const newState: NeuronState<I, O> = withTimelineStep<I, O>(
            afterPropmtState,
            {
                phase: "validation",
                success: false,
                output: parsed.data,
                errors: parsed.error.issues
            }
        )

        if (newState.retries.max <= 0 || newState.retries.preCriticRetries <= 0) {
            return {
                success: false,
                error: parsed.error,
                output: parsed.data,
                state: newState
            }
        }

        const repairResult = await repairLoop<I, O>(
            newState,
            parsed.data,
            parsed.error.issues,
            "preCritic"
        );

        if (!repairResult.success) {
            return repairResult;
        }

        return learn<I, O>(state, repairResult.output, parsed.error.issues);
    }

    // Successful first-pass validation can return immediately to the caller.
    return {
        success: true,
        output: parsed.data,
        state: withTimelineStep<I, O>(
            afterPropmtState,
            {
                phase: "validation",
                success: true,
                output: parsed.data
            }
        )
    };
}

/** Retry provider transport failures before surfacing them as execution errors. */
export async function runAgentWithRetries<I, O>(
    state: NeuronState<I, O>,
    prompt: string,
): Promise<StatedResult<I, O, string>> {
    try {
        const response = await state.agent.run(prompt);

        return {
            success: true,
            output: response,
            state
        };
    } catch (error) {
        const newState: NeuronState<I, O> = withTimelineStep<I, O>(state, {
            phase: "connectionError",
            prompt,
            error,
        });

        if (state.retries.connectionRetry > 0) {
            return runAgentWithRetries<I, O>(connectionRetryConsumed(newState), prompt);
        }

        return {
            success: false,
            error: error,
            output: undefined,
            state: newState
        };
    }
}
