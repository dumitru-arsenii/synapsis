/**
 * Neuron execution state helpers.
 *
 * State objects carry the parsed input, prompt definition, retry budgets,
 * schemas, learning config, critic config, and timeline through the runtime.
 */
import { zodToJsonSchema, type JsonSchema7Type } from "zod-to-json-schema";
import type { ZodType } from "zod";
import { resolveCriticConfig } from "./critic";
import { resolveLearningDefinition } from "./learning";
import type { Agent, CriticConfig, LearningDefinition, NeuronDefinition, NeuronPrompt, PromptDefinition, RetryConfig, TimelineStep } from "./types";
import { resolveValidationConfig } from "./validation";

/** Full mutable execution state threaded through one neuron run. */
export type NeuronState<I, O> = {
    name: string;
    description: string;
    agent: Agent;
    input: I;
    promptDefinition: PromptDefinition<I, O>;
    learning: Required<LearningDefinition<I, O>>;
    retries: Required<RetryConfig>;
    critic: Required<CriticConfig & { enabled: boolean }>;
    output: {
        parser: ZodType<O>;
        schema: JsonSchema7Type;
    }
    timeline: TimelineStep<I, O>[];
}

/** Execution result paired with the latest state snapshot. */
export type StatedResult<I, O, R = O> = {
    success: true;
    output: R;
    state: NeuronState<I, O>;
} | {
    success: false;
    error: any;
    output: unknown;
    state: NeuronState<I, O>;
}

/** Resolve a prompt definition and append recent learning examples. */
export async function getPromptDefinition<I, O>(
    prompt: NeuronPrompt<I, O>,
    input: I,
    learning: Required<LearningDefinition<I, O>>
): Promise<PromptDefinition<I, O>> {
    const promptDefinition = typeof prompt === "function"
        ? prompt({ input })
        : prompt

    const learningExamples = await learning.storage.list(learning.latest);

    return {
        ...promptDefinition,
        examples: [...(promptDefinition.examples ?? []), ...learningExamples]
    }
}

/** Build the initial runtime state for a neuron execution. */
export async function createNeuronState<I, O>(
    definition: NeuronDefinition<I, O>,
    input: I
): Promise<NeuronState<I, O>> {
    const { name, description, agent, prompt } = definition;

    const learning = resolveLearningDefinition<I, O>(definition.learning);
    const promptDefinition = await getPromptDefinition<I, O>(prompt, input, learning);

    return {
        name,
        description,
        agent,
        input,
        promptDefinition,
        learning,
        retries: resolveValidationConfig(definition),
        critic: resolveCriticConfig(definition),
        output: {
            parser: definition.output as ZodType<O>,
            schema: zodToJsonSchema(definition.output) as JsonSchema7Type
        },
        timeline: []
    }
}

/** Append one timeline event while preserving immutable state updates. */
export function withTimelineStep<I, O>(
    state: NeuronState<I, O>,
    step: TimelineStep<I, O>
): NeuronState<I, O> {
    return {
        ...state,
        timeline: [...state.timeline, step]
    }
}

/** Consume retry budget for the named validation phase. */
export function retryConsumed<I, O>(
    state: NeuronState<I, O>,
    step: 'preCritic' | 'postCritic' | 'critic'
): NeuronState<I, O> {
    return {
        ...state,
        retries: {
            max: state.retries.max - 1,
            preCriticRetries: step === 'preCritic' ? state.retries.preCriticRetries - 1 : state.retries.preCriticRetries,
            postCriticRetries: step === 'postCritic' ? state.retries.postCriticRetries - 1 : state.retries.postCriticRetries,
            hardLimit: state.retries.hardLimit - 1,
            connectionRetry: state.retries.connectionRetry
        }
    }
}

/** Consume one provider-connection retry attempt. */
export function connectionRetryConsumed<I, O>(
    state: NeuronState<I, O>
): NeuronState<I, O> {
    return {
        ...state,
        retries: {
            ...state.retries,
            connectionRetry: state.retries.connectionRetry - 1
        }
    }
}
