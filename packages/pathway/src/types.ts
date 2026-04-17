/**
 * Public Pathway types.
 *
 * These types describe executable contracts, step chaining, validation issues,
 * and the composite pathway interface shared across Brain and standalone use.
 */
import { type ZodType } from "zod";

export type ExecutableDescription = Readonly<{
  name: string;
  description: string;
}>;

export type ExecutableDefinition<I, O> = ExecutableDescription & Readonly<{
  input: ZodType<I>;
  output: ZodType<O>;
}>;

/** One typed unit of work that can be chained into a pathway. */
export type Executable<I, O> = ExecutableDefinition<I, O> & Readonly<{
  execute: (input: unknown) => Promise<O>;
  safeExecute: (input: unknown) => Promise<ExecutableSafeResult<I, O>>
}>;

export type ExecutableSafeResultDetails = Record<string, unknown>


/** Non-throwing execution result shape shared by neurons, actions, and pathways. */
export type ExecutableSafeResult<I, O> = {
  readonly success: true;
  readonly output: O;
  readonly details: ExecutableSafeResultDetails;
} | {
  readonly success: false;
  readonly output: unknown;
  readonly error: any;
  readonly details: ExecutableSafeResultDetails;
};

/** A pathway must contain at least one executable step. */
export type Executables = [
  AnyExecutable,
  ...AnyExecutable[]
]

/** Type-level check that adjacent executable output/input types line up. */
export type ExecutableChain<T extends Executables = Executables> =
  T extends [infer First, infer Second, ...infer Rest]
  ? First extends Executable<any, infer Out1>
  ? Second extends Executable<Out1, any>
  ? [First, ...ExecutableChain<[Second, ...Extract<Rest, AnyExecutable[]>]>]
  : never
  : never
  : T;

/** Convenience alias for any executable shape. */
export type AnyExecutable = Executable<any, any>;

/** Input type extracted from an executable. */
export type InputOf<Step extends AnyExecutable> =
  Step extends Executable<infer I, any> ? I : never;

/** Output type extracted from an executable. */
export type OutputOf<Step extends AnyExecutable> =
  Step extends Executable<any, infer O> ? O : never;

/** First step in a pathway tuple. */
export type FirstStep<Steps extends Executables> = Steps[0];

type LastOf<T extends readonly unknown[]> =
  T extends readonly [...unknown[], infer Last] ? Last : never;

export type LastStep<Steps extends Executables> =
  LastOf<Steps> extends AnyExecutable ? LastOf<Steps> : never;

/** User-facing pathway definition prior to validation and instantiation. */
export interface PathwayDefinition<Steps extends Executables> {
  readonly name: string;
  readonly description: string;
  readonly steps: ExecutableChain<Steps>;
}

/** Serializable record of one executed pathway step. */
export interface PathwayExecutionStep {
  readonly index: number;
  readonly name: string;
  readonly description: string;
  readonly input: unknown;
  readonly output: unknown;
}

/** One static validation failure between adjacent pathway steps. */
export interface PathwayValidationIssue {
  readonly index: number;
  readonly stepName: string;
  readonly reason: string;
}

/** Result object returned by pathway validation. */
export interface PathwayValidationResult {
  readonly success: boolean;
  readonly issues: ReadonlyArray<PathwayValidationIssue>;
}

/** Instantiated pathway surface exposed to callers. */
export type Pathway<Steps extends Executables>
  = Readonly<Pick<PathwayDefinition<Steps>, "steps">> & Executable<InputOf<FirstStep<Steps>>, OutputOf<LastStep<Steps>>>;
