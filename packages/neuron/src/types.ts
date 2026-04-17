/**
 * Public Neuron types.
 *
 * These types describe the execution timeline, prompt contract, retry budgets,
 * learning storage, semantic critic behavior, and agent adapter interface.
 */
import type { Executable, ExecutableDefinition, ExecutableSafeResultDetails } from "@synapsis/pathway";
import type { ZodIssue } from 'zod';
import type { JsonSchema7Type } from "zod-to-json-schema";

/**
 * One observable step in the neuron runtime.
 * 
 */

export type ExecutionStep<I, O> = {
    phase: "execution";
    prompt: string;
    learningExamples: PromptExample<I, O>[];
    output: string;
}

export type ValidationStep<I, O> = {
    phase: "validation";
    success: true;
    output: O;
} | {
    phase: "validation";
    success: false;
    output: unknown;
    errors: ZodIssue[];
}

/** Timeline entries emitted by the semantic critic flow. */
export type CriticStep<I, O> = {
    phase: "critic";
    prompt: string;
    output: string;
} | {
    phase: "critic";
    success: true;
    output: O;
} | {
    phase: "critic";
    success: false;
    feedback: string;
    output: O;
    errors: ZodIssue[]
} | {
    phase: "critic";
    applyPrompt: string;
    output: string;
}

/** Timeline entry emitted when a failed output is stored as a learning example. */
export type LearningStep<I, O> = {
    phase: "learning";
    output: O;
    errors: ZodIssue[];
}

/** Timeline entry emitted when the runtime asks the model to repair bad JSON. */
export type RepairStep<I, O> = {
    phase: "repair";
    prompt: string;
    output: string;
    errors: ZodIssue[];
    step: 'preCritic' | 'postCritic'
}

/** Timeline entry emitted when the provider call itself fails. */
export type ConnectionErrorStep<I, O> = {
    phase: "connectionError";
    prompt: string;
    error: any;
}

/** Union of all timeline events a neuron may record. */
export type TimelineStep<I, O> = ExecutionStep<I, O> | ValidationStep<I, O> | RepairStep<I, O> | CriticStep<I, O> | LearningStep<I, O> | ConnectionErrorStep<I, O>

/** Structured details returned from `safeExecute`. */
export interface NeuronExecutionDetails<I, O> extends ExecutableSafeResultDetails {
    readonly timeline: TimelineStep<I, O>[];
}

/**
 * Retry budgets for the different runtime stages.
 */
export interface RetryConfig {
    /** Global retry cap shared by every stage. */
    readonly max?: number;
    /** Retries available before the critic phase starts. */
    readonly preCriticRetries?: number;
    /** Retries available after the critic phase starts. */
    readonly postCriticRetries?: number;
    /** Final hard stop protecting against accidental infinite loops. */
    readonly hardLimit?: number;
    /** Retry budget for connection errors. */
    readonly connectionRetry?: number;
}

export type CriticStrategy = "strict" | "optimist" | "fallback" | "pessimist";

/** Recursive partial helper used when storing incomplete learning examples. */
export type DeepPartial<T> =
    T extends readonly (infer U)[]
    ? Array<DeepPartial<U>>
    : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Semantic critic settings.
 */
export interface CriticConfig {
    /** Extra semantic guidance appended to the critic review prompt. */
    readonly sentence?: string;
    /** How aggressively the runtime should enforce critic feedback. */
    readonly strategy?: CriticStrategy;
}


/**
 * Represents a prompt example containing partial input and output.
 * Used for few-shot learning and self-correction.
 */
export interface PromptExample<I, O> {
    readonly input: Partial<I>;
    readonly output: DeepPartial<O>;
}

/**
 * Structure of a Prompt Definition used to construct LLM operations.
 */
export interface PromptDefinition<I, O> {
    /** The system role of the agent (e.g. "Extractor"). */
    readonly role: string;
    /** The primary task to perform. */
    readonly task: string;
    /** Background story or context to help ground the agent. */
    readonly backstory?: string | undefined;
    /** Important rules or guarantees the agent must follow. */
    readonly important?: readonly string[] | undefined;
    /** Expected input/output examples for the prompt. */
    readonly examples?: ReadonlyArray<PromptExample<I, O>> | undefined;
}

/**
 * A prompt definition which can either be static or dynamically generated.
 */
export type NeuronPrompt<I, O> =
    | PromptDefinition<I, O>
    | ((props: { input: I }) => PromptDefinition<I, O>);

/**
 * Storage mechanism for learning examples.
 * Allows a neuron to remember previous mistakes and inject them as examples.
 */
export interface LearningStorage<I = unknown, O = unknown> {
    add: (example: PromptExample<I, O>) => Promise<void>;
    list: (tail?: number) => Promise<PromptExample<I, O>[]>;
    rem: (example: PromptExample<I, O>) => Promise<void>;
}

/**
 * Defines the learning behavior for a neuron.
 */
export interface LearningDefinition<I = unknown, O = unknown> {
    /** When true, only invalid fields should be stored in the example output. */
    readonly onlyFailedFields?: boolean;
    /** Limit the number of past examples to inject from storage. */
    readonly latest?: number;
    /** Storage interface to use for recording and reading past mistakes. */
    readonly storage?: LearningStorage<I, O>;
}

/**
 * Configuration needed to instantiate a neuron.
 */
export type NeuronDefinition<I, O> = ExecutableDefinition<I, O> & {
    readonly agent: Agent;
    readonly prompt: NeuronPrompt<I, O>;
    /** `false` disables critic, `string` sets critic sentence, object configures strategy and sentence. */
    readonly critic?: false | CriticConfig;
    /** Retry budgets for pre-critic and post-critic phases. */
    readonly retries?: RetryConfig;
    readonly learning?: LearningDefinition<I, O>;
}

/**
 * The instantiated neuron which includes throwing and non-throwing execution APIs.
 */
export type Neuron<I, O> = Executable<I, O>

/**
 * Adapter interface representing the generic interactions with LLM providers.
 */
export interface Agent {
    run: (prompt: string) => Promise<string>;

    buildPrompt: <I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            outputSchema: JsonSchema7Type;
        }
    ) => string;

    buildRepairPrompt: <I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            output: unknown;
            outputSchema: JsonSchema7Type;
            errors: ZodIssue[];
        }
    ) => string;

    buildLearningExample: <I, O>(
        details: {
            input: I;
            output: DeepPartial<O>;
            errors: ZodIssue[];
        }
    ) => PromptExample<I, O>;

    buildCritiqueReviewPrompt: <I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            output: O;
            outputSchema: JsonSchema7Type;
            criticSentence?: string;
        }
    ) => string;

    buildCritiqueApplyPrompt: <I, O>(
        details: {
            prompt: PromptDefinition<I, O>;
            input: I;
            output: O;
            outputSchema: JsonSchema7Type;
            criticFeedback: string;
        }
    ) => string;
}
