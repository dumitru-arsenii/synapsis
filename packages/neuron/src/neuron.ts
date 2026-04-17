/**
 * Neuron factory.
 *
 * A neuron combines prompt execution, validation, repair, critic review, and
 * optional learning into one typed unit of work.
 */
import type { ExecutableSafeResult } from "@synapsis/pathway";
import { critic } from "./critic";
import { createNeuronState } from "./state";
import { execute } from "./task";
import type { Neuron, NeuronDefinition } from "./types";
import { safeParseUnknown } from "./validation";

/**
 * Create a typed neuron with validation, repair, critic strategies, learning memory, and structured execution details.
 */
export function createNeuron<I, O>(definition: NeuronDefinition<I, O>): Neuron<I, O> {
    const { name, description, input, output } = definition

    // Both public execution methods are powered by the same internal safe path.
    const safeExecute = async (input: unknown): Promise<ExecutableSafeResult<I, O>> => {
        const parsedInputResult = safeParseUnknown(definition.input, input);

        if (!parsedInputResult.success) {
            return {
                success: false,
                error: parsedInputResult.error,
                output: input,
                details: {
                    timeline: [{
                        phase: "validation",
                        success: false,
                        output: input,
                        errors: parsedInputResult.error.issues
                    }]
                }
            }
        }

        const state = await createNeuronState(definition, parsedInputResult.data);

        const executionResult = await execute(state);

        if (!executionResult.success) {
            return {
                success: false,
                error: executionResult.error,
                output: executionResult.output,
                details: {
                    timeline: executionResult.state.timeline
                }
            };
        }

        // Critic review runs only after the output is structurally valid.
        if (executionResult.state.critic.enabled) {
            const criticResult = await critic(executionResult.state, executionResult.output);

            if (!criticResult.success) {
                return {
                    success: false,
                    error: criticResult.error,
                    output: criticResult.output,
                    details: {
                        timeline: criticResult.state.timeline
                    }
                };
            }

            return {
                success: true,
                output: criticResult.output,
                details: {
                    timeline: criticResult.state.timeline,
                }
            }
        }

        return {
            success: true,
            output: executionResult.output,
            details: {
                timeline: executionResult.state.timeline,
            }
        }
    }

    return {
        get name() {
            return name;
        },
        get input() {
            // Expose the original schema shape without forcing optional wrappers on consumers.
            const optional = input.optional();
            return (input.isOptional() ? optional : optional.unwrap()) as typeof input;
        },
        get output() {
            const optional = output.optional();
            return (output.isOptional() ? optional : optional.unwrap()) as typeof output;
        },
        get description() {
            return description;
        },
        get safeExecute() {
            return async (input: unknown) => safeExecute(input)
        },
        get execute() {
            return async (input: unknown) => {
                const result = await safeExecute(input);
                if (!result.success) {
                    throw result.error;
                }

                return result.output;
            }
        }
    }
}
