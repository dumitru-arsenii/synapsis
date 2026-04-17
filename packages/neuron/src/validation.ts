/**
 * Validation and repair helpers for neurons.
 *
 * This module owns retry-budget resolution, safe parsing of raw model output,
 * and the repair loop that asks the model to fix schema violations.
 */
import type { SafeParseReturnType, ZodIssue, ZodType } from "zod";
import { DEFAULT_MAX_CONNECTION_RETRIES, DEFAULT_RETRIES_HARD_LIMIT } from "./constants";
import { retryConsumed, withTimelineStep, type NeuronState, type StatedResult } from "./state";
import type { NeuronDefinition, RetryConfig } from "./types";
import { runAgentWithRetries } from "./task";

/** Resolve concrete retry budgets from user-supplied neuron config. */
export function resolveValidationConfig<I, O>(
    definition: NeuronDefinition<I, O>
): Required<RetryConfig> {
    const hardLimit = definition.retries?.hardLimit || DEFAULT_RETRIES_HARD_LIMIT;
    return {
        max: definition.retries?.max || hardLimit,
        preCriticRetries: definition.retries?.preCriticRetries || hardLimit,
        postCriticRetries: definition.retries?.postCriticRetries || hardLimit,
        hardLimit,
        connectionRetry: definition.retries?.connectionRetry || DEFAULT_MAX_CONNECTION_RETRIES
    }
}

/** Parse unknown input and optionally retry after JSON parsing string responses. */
export function safeParseUnknown<T>(
    parser: ZodType<T>,
    input: unknown,
    tryJsonParse: boolean = false
): SafeParseReturnType<T, T> {
    let value: unknown = input;
    let parseResult = parser.safeParse(value);

    if (!parseResult.success && tryJsonParse) {
        try {
            value = JSON.parse(input as string);
            parseResult = parser.safeParse(value);
        } catch { }
    }

    if (parseResult.success) {
        return parseResult
    }

    return {
        success: false,
        error: parseResult.error,
        data: value
    } as SafeParseReturnType<T, T>
}

/** Repeatedly ask the model to fix validation errors until budgets are exhausted. */
export async function repairLoop<I, O>(
    state: NeuronState<I, O>,
    output: unknown,
    errors: ZodIssue[],
    step: 'preCritic' | 'postCritic'
): Promise<StatedResult<I, O>> {
    const prompt = state.agent.buildRepairPrompt({
        prompt: state.promptDefinition,
        input: state.input,
        output,
        outputSchema: state.output.schema,
        errors
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

    const newState = retryConsumed(
        withTimelineStep(state, {
            phase: "repair",
            output: response,
            errors,
            prompt,
            step
        }),
        step
    );

    const parsed = safeParseUnknown<O>(state.output.parser, response, true);

    if (!parsed.success) {
        const failedState = withTimelineStep(newState, {
            phase: "validation",
            success: false,
            output: parsed.data as unknown,
            errors: parsed.error.issues
        })

        if (failedState.retries.max <= 0) {
            return {
                success: false,
                error: parsed.error,
                output: parsed.data,
                state: failedState
            }
        }

        if (step === "preCritic" && failedState.retries.preCriticRetries <= 0) {
            return {
                success: false,
                error: new Error("Max pre-critic retries reached"),
                output: response,
                state: failedState
            }
        }

        if (step === "postCritic" && failedState.retries.postCriticRetries <= 0) {
            return {
                success: false,
                error: new Error("Max post-critic retries reached"),
                output: response,
                state: failedState
            }
        }

        return repairLoop(failedState, response, parsed.error.issues, step);
    }

    return {
        success: true,
        output: parsed.data,
        state: withTimelineStep(newState, {
            phase: "validation",
            success: true,
            output: parsed.data,
        })
    }
}
