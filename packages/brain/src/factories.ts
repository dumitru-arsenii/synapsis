/**
 * Brain factories.
 *
 * These helpers adapt lower-level neuron/pathway primitives into Brain-aware
 * executables that register themselves, use shared Cortex services, and expose
 * consistent `execute` / `safeExecute` behavior.
 */
import { createNeuron, type Agent, type LearningStorage, type PromptExample } from "@synapsis/neuron";
import { createPathway as createBasePathway, type Executables, type ExecutableSafeResult, type FirstStep, type InputOf, type LastStep } from "@synapsis/pathway";
import type {
    BrainAction,
    BrainActionContext,
    BrainActionDefinition,
    BrainNeuron,
    BrainNeuronDefinition,
    BrainPathway,
    BrainPathwayDefinition,
    BrainRegistry,
    RegisteredBrainPathway
} from "./types";
import type { BrainRuntime } from "./runtime";
import type { Cortex } from "@synapsis/cortex";

export type CreateActionFactoryOptions = {
    cortex: Cortex;
    registry: BrainRegistry;
};

export type CreateNeuronFactoryOptions = {
    cortex: Cortex;
    registry: BrainRegistry;
    agent: Agent;
};

export type CreatePathwayFactoryOptions = {
    registry: BrainRegistry;
    runtime: BrainRuntime;
};

/** Build the action factory bound to one Brain registry and Cortex runtime. */
export function createActionFactory({ cortex, registry }: CreateActionFactoryOptions) {
    return <I, O>(definition: BrainActionDefinition<I, O>): BrainAction<I, O> => {
        registry.assertUniqueKey(definition.key, "action");

        const name = definition.name ?? definition.key;
        const description = definition.description ?? name;

        // Actions are deterministic wrappers, so Brain validates both input and output.
        const safeExecute = async (input: unknown): Promise<ExecutableSafeResult<I, O>> => {
            const context: BrainActionContext = {
                cortex,
                registry
            };
            const inputParseResult = definition.input.safeParse(input);

            if (!inputParseResult.success) {
                return {
                    success: false,
                    error: inputParseResult.error,
                    output: input,
                    details: {
                        inputRaw: input,
                        error: inputParseResult.error
                    }
                };
            }

            const inputParsed = inputParseResult.data;

            try {
                const result = await definition.run(inputParsed, context);
                const outputParseResult = definition.output.safeParse(result);

                if (!outputParseResult.success) {
                    return {
                        success: false,
                        error: outputParseResult.error,
                        output: result,
                        details: {
                            inputRaw: input,
                            input: inputParsed,
                            outputRaw: result,
                            error: outputParseResult.error
                        }
                    };
                }

                return {
                    success: true,
                    output: outputParseResult.data,
                    details: {
                        inputRaw: input,
                        input: inputParsed,
                        outputRaw: result,
                        output: outputParseResult.data
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error,
                    output: input,
                    details: {
                        inputRaw: input,
                        input: inputParsed,
                        error
                    }
                };
            }
        };

        // The throwing API is derived from `safeExecute` so both paths stay consistent.
        const action = {
            key: definition.key,
            name,
            description,
            input: definition.input,
            output: definition.output,
            safeExecute,
            execute: async (input: unknown) => {
                const result = await safeExecute(input);

                if (!result.success) {
                    throw result.error;
                }

                return result.output;
            }
        } as BrainAction<I, O>;

        registry.registerAction({
            key: definition.key,
            executable: action,
            definition
        });

        return action;
    };
}

/** Build the neuron factory that injects the shared Brain agent and learning store. */
export function createNeuronFactory({ cortex, registry, agent }: CreateNeuronFactoryOptions) {
    return <I, O>(definition: BrainNeuronDefinition<I, O>): BrainNeuron<I, O> => {
        registry.assertUniqueKey(definition.key, "neuron");

        const { key, learning, ...rest } = definition;
        // Learned examples are stored in Cortex so workers share the same feedback memory.
        const storage = learning ? createCortexLearningStorage<I, O>(cortex, key) : undefined;
        const neuron = createNeuron<I, O>({
            ...rest,
            name: rest.name ?? key,
            description: rest.description ?? rest.name ?? key,
            agent,
            ...(learning ? {
                learning: {
                    ...learning,
                    storage: storage!
                }
            } : {})
        });

        const brainNeuron = {
            key,
            ...neuron
        } as BrainNeuron<I, O>;

        registry.registerNeuron({
            key,
            executable: brainNeuron,
            definition
        });

        return brainNeuron;
    };
}

/** Build the pathway factory that queues work into the Brain runtime. */
export function createPathwayFactory({ registry, runtime }: CreatePathwayFactoryOptions) {
    return <const Steps extends Executables>(definition: BrainPathwayDefinition<Steps>): BrainPathway<Steps> => {
        registry.assertUniqueKey(definition.key, "pathway");

        const name = definition.name ?? definition.key;
        const description = definition.description ?? name;

        createBasePathway({
            name,
            description,
            steps: definition.steps as any
        });

        const firstStep = definition.steps[0];
        const lastStep = definition.steps[definition.steps.length - 1] as LastStep<Steps>;

        const safeExecute = async (
            input: unknown
        ): Promise<ExecutableSafeResult<InputOf<FirstStep<Steps>>, any>> => {
            // Pathways are executed asynchronously by workers, then awaited through Cortex state.
            const run = await runtime.schedulePathwayRun(definition.key, input);
            const completedRun = await runtime.waitForPathwayRun(run.runId);

            if (!completedRun) {
                return {
                    success: false,
                    output: input,
                    error: new Error(`Pathway run "${run.runId}" timed out while waiting for a worker.`),
                    details: {
                        queued: true,
                        runId: run.runId,
                        status: "pending"
                    }
                };
            }

            if (completedRun.status === "completed") {
                return {
                    success: true,
                    output: completedRun.output,
                    details: {
                        queued: true,
                        runId: completedRun.runId,
                        status: completedRun.status,
                        steps: completedRun.steps
                    }
                };
            }

            return {
                success: false,
                output: completedRun.output,
                error: new Error(completedRun.error ?? `Pathway run "${completedRun.runId}" failed.`),
                details: {
                    queued: true,
                    runId: completedRun.runId,
                    status: completedRun.status,
                    steps: completedRun.steps
                }
            };
        };

        const pathway = {
            key: definition.key,
            name,
            description,
            steps: definition.steps,
            input: firstStep.input,
            output: lastStep.output,
            safeExecute,
            execute: async (input: unknown) => {
                const result = await safeExecute(input);

                if (!result.success) {
                    throw result.error;
                }

                return result.output;
            }
        } as BrainPathway<Steps>;

        registry.registerPathway({
            key: definition.key,
            executable: pathway as unknown as RegisteredBrainPathway,
            definition: definition as unknown as BrainPathwayDefinition<Executables>,
            steps: definition.steps
        });

        return pathway;
    };
}

/** Store shared neuron learning examples in Cortex memory under the neuron key. */
function createCortexLearningStorage<I, O>(cortex: Cortex, key: string): LearningStorage<I, O> {
    const getAll = async <I, O>(): Promise<PromptExample<I, O>[]> => {
        const raw = await cortex.memory.get<{ examples: PromptExample<I, O>[] }>(key);

        if (!raw) {
            await cortex.memory.set(key, { examples: [] });
            return [];
        }

        try {
            return raw.examples;
        } catch {
            return [];
        }
    };

    return {
        add: async (example) => {
            const all = await getAll();

            all.push(example);

            await cortex.memory.set(key, { examples: all });
        },
        list: async <I, O>(tail?: number): Promise<PromptExample<I, O>[]> => {
            const all = await getAll<I, O>();

            return tail ? all.slice(-tail) : all;
        },
        rem: async <I, O>(example: PromptExample<I, O>) => {
            const all = await getAll<I, O>();
            const filtered = all.filter((entry) => JSON.stringify(entry) !== JSON.stringify(example));

            await cortex.memory.set(key, { examples: filtered });
        }
    };
}
