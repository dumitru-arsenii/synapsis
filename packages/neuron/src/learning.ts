/**
 * Learning helpers for neurons.
 *
 * This module decides how failed examples are stored, filtered, and fed back
 * into future prompt construction.
 */
import type { ZodIssue } from "zod";
import { DEFAULT_LEARNING_EXAMPLES, DEFAULT_LEARNING_ONLY_FAILED_FIELDS } from "./constants";
import { getPromptDefinition, withTimelineStep, type NeuronState, type StatedResult } from "./state";
import type { DeepPartial, LearningDefinition, NeuronDefinition, PromptExample } from "./types";

/**
 * Attach a lightweight in-memory store when learning is enabled without custom storage.
 */
export function initializeLearningMemory<I, O>() {
    const memory: PromptExample<I, O>[] = [];

    return {
        add: async (example: PromptExample<I, O>) => {
            memory.push(example);
        },
        list: async () => [...memory],
        rem: async (example: PromptExample<I, O>) => {
            const index = memory.indexOf(example);
            if (index !== -1) {
                memory.splice(index, 1);
            }
        }
    }
}

export function resolveLearningDefinition<I, O>(
    learning: NeuronDefinition<I, O>["learning"]
): Required<LearningDefinition<I, O>> {
    const onlyFailedFields = learning?.onlyFailedFields || DEFAULT_LEARNING_ONLY_FAILED_FIELDS;
    const latest = learning?.latest || DEFAULT_LEARNING_EXAMPLES;

    if (learning?.storage) {
        return {
            storage: learning.storage,
            onlyFailedFields,
            latest
        };
    }

    return {
        storage: initializeLearningMemory<I, O>(),
        onlyFailedFields,
        latest
    }
}

/** Persist a new learning example and rebuild the prompt definition with it included. */
export async function learn<I, O>(
    state: NeuronState<I, O>,
    output: O,
    errors: ZodIssue[]
): Promise<StatedResult<I, O>> {
    let outputExample: DeepPartial<O> = output as DeepPartial<O>;

    if (state.learning.onlyFailedFields) {
        outputExample = buildErroredOutputExample(output, errors);
    }

    const example = state.agent.buildLearningExample({
        input: state.input,
        output: outputExample,
        errors
    });

    await state.learning.storage.add(example);

    return {
        success: true,
        output,
        state: {
            ...withTimelineStep(state, {
                phase: "learning",
                output,
                errors,
            }),
            promptDefinition: await getPromptDefinition(state.promptDefinition, state.input, state.learning)
        }
    }
}

/** Reduce a failed output to only the nested fields implicated by validation errors. */
function buildErroredOutputExample<O>(
    output: O,
    errors: ZodIssue[]
): DeepPartial<O> {
    if (errors.some(error => error.path.length === 0)) {
        return output as DeepPartial<O>;
    }

    const keys = new Set<string>(errors.map(error => error.path.join(".")));

    return pickNested(output as Record<string, unknown>, [...keys]) as DeepPartial<O>;
}

/** Read a nested value by dotted path from an object-like structure. */
function getByPath<T>(
    obj: Record<string, unknown>,
    path: string
): T | undefined {
    return path.split('.').reduce((acc: unknown, key) => {
        if (typeof acc === 'object' && acc !== null && key in acc) {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined
    }, obj) as T | undefined;
}

/** Detect whether a path segment refers to an array index. */
function isIndex(key: string): boolean {
    return /^\d+$/.test(key);
}

/** Build a sparse object/array tree that contains only the requested nested paths. */
function pickNested<T extends Record<string, unknown>>(
    source: T,
    paths: string[]
): DeepPartial<T> {
    const result: any = Array.isArray(source) ? [] : {};

    for (const path of paths) {
        const value = getByPath(source, path);
        if (value === undefined) continue;

        const keys = path.split('.');
        let current: any = result;

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]!;
            const nextKey = keys[i + 1]!;

            const isLast = i === keys.length - 1;
            const keyIsIndex = isIndex(key);

            if (isLast) {
                if (keyIsIndex) {
                    if (!Array.isArray(current)) current = [];
                    current[+key] = value;
                    Array.from({ length: +key }).forEach((_, i) => current[i] = '')
                } else {
                    current[key] = value;
                }
            } else {
                const nextIsIndex = isIndex(nextKey);

                if (keyIsIndex) {
                    const index = Number(key);

                    if (!Array.isArray(current)) {
                        current = [];
                    }

                    if (!current[index]) {
                        current[index] = nextIsIndex ? [] : {};
                    }

                    current = current[index];
                } else {
                    if (!current[key]) {
                        current[key] = nextIsIndex ? [] : {};
                    }

                    current = current[key];
                }
            }
        }
    }

    return result;
}
