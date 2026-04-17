/**
 * Public Brain types.
 *
 * This package sits above Cortex, Neuron, and Pathway, so its types describe
 * how those building blocks are registered, scheduled, persisted, and observed
 * as part of one Brain runtime.
 */
import type { JsonSchema7Type } from "zod-to-json-schema";
import type {
  Agent,
  LearningStorage,
  Neuron,
  NeuronDefinition,
  PromptExample
} from "@synapsis/neuron";
import type {
  Executable,
  Executables,
  ExecutableSafeResult,
  Pathway,
  PathwayDefinition
} from "@synapsis/pathway";
import type {
  Awaitable,
  Cortex
} from "@synapsis/cortex";
import type { ExecutableDefinition } from "@synapsis/pathway";
import type { ExecutableDescription } from "@synapsis/pathway";


/** Queue timing and retry controls for the Brain worker runtime. */
export interface BrainRuntimeOptions {
  readonly pathwayWaitIntervalMs?: number;
  readonly pathwayWaitTimeoutMs?: number;
  readonly pathwayLockTtlMs?: number;
  readonly pathwayMaxRetries?: number;
  readonly executableWaitIntervalMs?: number;
  readonly executableWaitTimeoutMs?: number;
  readonly executableLockTtlMs?: number;
  readonly executableMaxRetries?: number;
}

/**
 * Brain injects the agent at runtime, so callers only define the neuron behavior here.
 */
export interface BrainNeuronDefinition<I, O>
  extends Omit<NeuronDefinition<I, O>, "agent" | "learning"> {
  readonly key: string;
  readonly learning?: Omit<NonNullable<NeuronDefinition<I, O>["learning"]>, "storage">;
}

export interface BrainActionContext {
  readonly cortex: Cortex;
  readonly registry: BrainRegistry;
}

/**
 * Thin deterministic wrapper over user code.
 */
export type BrainActionDefinition<I, O> = ExecutableDefinition<I, O> & {
  readonly key: string;
  readonly run: (input: I, context: BrainActionContext) => Awaitable<O>;
}

export type BrainNeuron<I, O> = Neuron<I, O> & {
  readonly key: string;
};

export type BrainAction<I, O> = Executable<I, O> & {
  readonly key: string;
};

/** Brain-level pathway definition that adds a stable registry key. */
export type BrainPathwayDefinition<Steps extends Executables> =
  ExecutableDescription & PathwayDefinition<Steps> & {
    readonly key: string;
  }

/** Serializable record of one inline pathway step execution. */
export interface BrainPathwayExecutionStep {
  readonly index: number;
  readonly name: string;
  readonly description: string;
  readonly input: unknown;
  readonly output: unknown;
}

/** Instantiated Brain pathway enriched with a stable registry key. */
export type BrainPathway<Steps extends Executables> = Readonly<{
  key: string;
} & Pathway<Steps>>;

/**
 * Internal registry shape used once pathway generics are erased at runtime.
 */
export type RegisteredBrainPathway = BrainPathway<Executables>;

/**
 * Stored workflow metadata used to keep queued executions reproducible and debuggable.
 */
export interface BrainPathwaySnapshotStep {
  readonly index: number;
  readonly key?: string;
  readonly kind: "neuron" | "action" | "pathway" | "executable";
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema7Type;
  readonly outputSchema: JsonSchema7Type;
}

export interface BrainPathwaySnapshot {
  readonly pathwayKey: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema7Type;
  readonly outputSchema: JsonSchema7Type;
  readonly steps: ReadonlyArray<BrainPathwaySnapshotStep>;
}

/** Lifecycle states for a persisted pathway run. */
export type BrainPathwayRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

/** Persisted record for one pathway step attempt. */
export interface BrainPathwayRunStep {
  readonly index: number;
  readonly key?: string;
  readonly name: string;
  readonly description: string;
  readonly status: "success" | "failed";
  readonly input: unknown;
  readonly output: unknown;
  readonly retries: number;
  readonly error?: string;
  readonly memoryKey?: string;
  readonly details?: Record<string, unknown>;
  readonly updatedAt: string;
}

/** Persisted state for one queued or running pathway execution. */
export interface BrainPathwayRun {
  readonly runId: string;
  readonly pathwayKey: string;
  readonly status: BrainPathwayRunStatus;
  readonly input: unknown;
  readonly output: unknown;
  readonly error?: string;
  readonly currentStep: number;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly snapshot: BrainPathwaySnapshot;
  readonly steps: ReadonlyArray<BrainPathwayRunStep>;
}

/** Runtime categories Brain can persist for executable snapshots. */
export type BrainExecutableKind = "neuron" | "action" | "pathway" | "executable";

/** Persisted schema snapshot for one executable at queue time. */
export interface BrainExecutableSnapshot {
  readonly key: string;
  readonly kind: BrainExecutableKind;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema7Type;
  readonly outputSchema: JsonSchema7Type;
}

/** Lifecycle states for an executable run. */
export type BrainExecutableRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

/** Persisted state for one executable run handled by a worker. */
export interface BrainExecutableRun {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly parentStepIndex?: number;
  readonly executableKey: string;
  readonly status: BrainExecutableRunStatus;
  readonly input: unknown;
  readonly output: unknown;
  readonly error?: string;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly workerId?: string;
  readonly snapshot: BrainExecutableSnapshot;
  readonly details?: Record<string, unknown>;
}

/** Event categories emitted while processing executable runs. */
export type BrainExecutableRunEventType =
  | "queued"
  | "started"
  | "completed"
  | "failed"
  | "requeued"
  | "skipped";

/** Timeline event appended to an executable run for debugging and observability. */
export interface BrainExecutableRunEvent {
  readonly runId: string;
  readonly type: BrainExecutableRunEventType;
  readonly createdAt: string;
  readonly workerId?: string;
  readonly message?: string;
  readonly error?: string;
  readonly parentRunId?: string;
}

/** Registry entry describing a Brain neuron. */
export type BrainRegistryEntryNeuron = {
  readonly kind: "neuron";
  readonly key: string;
  readonly executable: BrainNeuron<any, any>;
  readonly definition: BrainNeuronDefinition<any, any>;
}

/** Registry entry describing a Brain action. */
export type BrainRegistryEntryAction = {
  readonly kind: "action";
  readonly key: string;
  readonly executable: BrainAction<any, any>;
  readonly definition: BrainActionDefinition<any, any>;
}

/** Registry entry describing a Brain pathway. */
export type BrainRegistryEntryPathway = {
  readonly kind: "pathway";
  readonly key: string;
  readonly executable: RegisteredBrainPathway;
  readonly definition: BrainPathwayDefinition<Executables>;
  readonly steps: Executables;
}

/** Any registry entry stored in the Brain registry map. */
export type BrainRegistryEntry = BrainRegistryEntryNeuron | BrainRegistryEntryAction | BrainRegistryEntryPathway;

/** Mutable registry used by Brain factories and workers to resolve keys. */
export interface BrainRegistry {
  readonly root: Map<string, BrainRegistryEntry>;
  registerNeuron(entry: Omit<BrainRegistryEntryNeuron, "kind">): void;
  registerAction(entry: Omit<BrainRegistryEntryAction, "kind">): void;
  registerPathway(entry: Omit<BrainRegistryEntryPathway, "kind">): void;
  getNeuron(key: string): BrainRegistryEntryNeuron | null;
  getAction(key: string): BrainRegistryEntryAction | null;
  getPathway(key: string): BrainRegistryEntryPathway | null;
  assertUniqueKey(key: string, kind?: BrainRegistryEntry["kind"]): void;
}

/** Constructor inputs required to bootstrap a Brain instance. */
export interface BrainDefinition {
  readonly agent: Agent;
  readonly cortex: Cortex;
  readonly options?: BrainRuntimeOptions;
}

/** Public Brain runtime surface exposed to package consumers. */
export interface Brain {
  readonly agent: Agent;
  readonly cortex: Cortex;
  readonly workerId: string;
  readonly registry: BrainRegistry;
  createNeuron<I, O>(definition: BrainNeuronDefinition<I, O>): BrainNeuron<I, O>;
  createAction<I, O>(definition: BrainActionDefinition<I, O>): BrainAction<I, O>;
  createPathway<const Steps extends Executables>(
    definition: BrainPathwayDefinition<Steps>
  ): BrainPathway<Steps>;
  startExecutionWorker(label?: string): () => void;
}

/** Queue payload stored when a pathway execution is scheduled. */
export type QueuePayload = {
  readonly runId: string;
  readonly pathwayKey: string;
  readonly input: unknown;
  readonly retryCount: number;
  readonly queuedAt: string;
};

/** Queue payload stored when a single executable is scheduled. */
export type ExecutableQueuePayload = {
  readonly runId: string;
  readonly executableKey: string;
  readonly retryCount: number;
  readonly queuedAt: string;
};

/** Learning storage enriched with a synchronous snapshot helper. */
export type ManagedLearningStorage = LearningStorage & {
  snapshot: () => PromptExample<any, any>[];
};

/** Normalized step result used by the Brain runtime when composing executions. */
export type StepExecutionResult = ExecutableSafeResult<any, any> & {
  readonly memoryKey?: string;
};

/** Result shape for inline pathway execution inside a larger run. */
export type InlinePathwayResult = ExecutableSafeResult<any, any> & {
  readonly steps: BrainPathwayExecutionStep[];
};
