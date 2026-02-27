/**
 * DAG Workflow Engine — Core Types
 *
 * All TypeScript types, interfaces, discriminated unions, and type guards
 * for the DAG-based workflow engine. This file contains zero runtime imports
 * from other pipeline-core sub-modules (type-only imports are allowed).
 *
 * Every node in the workflow graph operates on the uniform data contract:
 * `Items → Items` (except `merge`, which receives `Items[]`).
 */

import type { AIInvoker, ProcessTracker } from '../map-reduce/types';

// =============================================================================
// Item Types
// =============================================================================

/**
 * A single data item flowing through the workflow.
 *
 * Values are constrained to JSON-safe primitives. `null` is used for
 * missing/empty CSV cells instead of `undefined` to keep JSON serialisation
 * predictable.
 */
export type Item = Record<string, string | number | boolean | null>;

/** An ordered collection of data items. */
export type Items = Item[];

// =============================================================================
// Load Source (discriminated union)
// =============================================================================

/**
 * Source for a load node. Executors must switch on `source.type`.
 *
 * - `csv`    — read a CSV file from disk
 * - `json`   — read a JSON file from disk (must contain an array of objects)
 * - `inline` — items provided directly in the YAML
 * - `ai`     — generate items via an AI prompt; `schema` lists expected field names
 */
export type LoadSource =
    | { type: 'csv'; path: string; delimiter?: string }
    | { type: 'json'; path: string }
    | { type: 'inline'; items: Item[] }
    | { type: 'ai'; prompt: string; schema: string[]; model?: string };

// =============================================================================
// Filter Rule (recursive discriminated union)
// =============================================================================

/**
 * Comparison operators for field-based filter rules.
 *
 * Mirrors the existing pipeline filter operators but uses abbreviated names
 * for conciseness in YAML.
 */
export type WorkflowFilterOp =
    | 'eq' | 'neq' | 'in' | 'nin'
    | 'contains' | 'not_contains'
    | 'gt' | 'lt' | 'gte' | 'lte'
    | 'matches';

/**
 * Composable boolean algebra for filter rules.
 *
 * The `and`, `or`, and `not` variants enable recursive composition,
 * allowing arbitrarily nested filter expressions (requires TypeScript 3.7+).
 */
export type WorkflowFilterRule =
    | { type: 'field'; field: string; op: WorkflowFilterOp; value?: unknown; values?: unknown[] }
    | { type: 'ai'; prompt: string; model?: string; concurrency?: number; timeoutMs?: number }
    | { type: 'and'; rules: WorkflowFilterRule[] }
    | { type: 'or'; rules: WorkflowFilterRule[] }
    | { type: 'not'; rule: WorkflowFilterRule };

// =============================================================================
// Transform Operations
// =============================================================================

/**
 * Data transformation operations applied in sequence by a transform node.
 *
 * Uses `op` (not `type`) as the discriminant to visually distinguish
 * transform operations from node configs.
 *
 * For the `add` operation, `value` supports `{{fieldName}}` template
 * interpolation evaluated at execution time by the transform executor
 * (not at parse time).
 */
export type TransformOp =
    | { op: 'select'; fields: string[] }
    | { op: 'drop'; fields: string[] }
    | { op: 'rename'; from: string; to: string }
    | { op: 'add'; field: string; value: string };

// =============================================================================
// Reduce Strategy
// =============================================================================

/**
 * Strategy for reducing items to a single result.
 *
 * Reuses identifiers from `MROutputFormat` (`list`, `table`, `json`, `csv`, `ai`)
 * but adds `concat` (plain concatenation) and omits `text` — plain text
 * concatenation is superseded by `concat` for clarity in DAG workflows.
 */
export type ReduceStrategy = 'list' | 'table' | 'json' | 'csv' | 'concat' | 'ai';

// =============================================================================
// Base Node
// =============================================================================

/**
 * Base interface for all workflow nodes.
 *
 * Every concrete node interface must extend this and redeclare `type`
 * as a string literal to enable discriminated union narrowing.
 */
export interface BaseNode {
    /** Node type discriminant (intentionally wide on the base). */
    type: string;
    /**
     * Node IDs of parent nodes whose output feeds into this node.
     * Omit for root nodes (e.g., load nodes with no dependencies).
     */
    from?: string[];
    /** Human-readable label for display in logs and dashboards. */
    label?: string;
    /**
     * Error handling strategy.
     * - `'abort'` (default) — propagate the error, halting execution.
     * - `'warn'` — emit empty Items and continue execution.
     */
    onError?: 'abort' | 'warn';
}

// =============================================================================
// Concrete Node Configs
// =============================================================================

/**
 * Load node — reads items from an external source.
 *
 * The `source` field holds a `LoadSource` discriminated union;
 * executors must switch on `source.type`.
 */
export interface LoadNodeConfig extends BaseNode {
    type: 'load';
    source: LoadSource;
}

/**
 * Script node — executes an external command.
 *
 * - `run` is shell-interpolated (uses `shell: true` in child_process.spawn).
 * - `output: 'passthrough'` means stdout is ignored and input items pass through unchanged.
 * - `output: 'json'` means the executor parses stdout as a JSON array of `Item` objects.
 * - `output: 'csv'` means the executor parses stdout as CSV text.
 * - `output: 'text'` means stdout is captured as a single-item result with a `text` field.
 * - `cwd` is relative to `workflowDirectory` if not absolute.
 */
export interface ScriptNodeConfig extends BaseNode {
    type: 'script';
    /** Command string, shell-interpolated. */
    run: string;
    /** Additional arguments for the command. */
    args?: string[];
    /** Environment variables to set for the command. */
    env?: Record<string, string>;
    /** Working directory (relative to workflowDirectory if not absolute). */
    cwd?: string;
    /** Timeout in milliseconds for the command execution. */
    timeoutMs?: number;
    /** How to pass input items to the command's stdin. Default: `'none'`. */
    input?: 'json' | 'csv' | 'none';
    /** How to interpret the command's stdout. Default: `'passthrough'`. */
    output?: 'json' | 'csv' | 'text' | 'passthrough';
}

/**
 * Filter node — filters items using composable boolean rules.
 *
 * The `rule` field holds a `WorkflowFilterRule` which supports recursive
 * boolean algebra (and/or/not composition).
 */
export interface FilterNodeConfig extends BaseNode {
    type: 'filter';
    rule: WorkflowFilterRule;
}

/**
 * Map node — applies an AI prompt to each item (or batch of items).
 *
 * Exactly one of `prompt` or `promptFile` must be specified.
 */
export interface MapNodeConfig extends BaseNode {
    type: 'map';
    /** Inline prompt template. Supports `{{fieldName}}` interpolation. */
    prompt?: string;
    /** Path to a prompt file (relative to workflowDirectory). */
    promptFile?: string;
    /** Field names to parse from the AI response. */
    output?: string[];
    /** Model override for this node. */
    model?: string;
    /** Maximum number of concurrent AI calls. */
    concurrency?: number;
    /** Timeout per AI call in milliseconds. */
    timeoutMs?: number;
    /** Number of items per AI call (default: 1). */
    batchSize?: number;
}

/**
 * Reduce node — aggregates items into a single result.
 *
 * When `strategy` is `'ai'`, exactly one of `prompt` or `promptFile` must be specified.
 */
export interface ReduceNodeConfig extends BaseNode {
    type: 'reduce';
    /** Aggregation strategy. */
    strategy: ReduceStrategy;
    /** Inline prompt (required when strategy is `'ai'`, unless `promptFile` is set). */
    prompt?: string;
    /** Path to a prompt file (alternative to `prompt` for the `'ai'` strategy). */
    promptFile?: string;
    /** Field names to parse from the AI response (for `'ai'` strategy). */
    output?: string[];
    /** Model override for this node. */
    model?: string;
    /** Timeout in milliseconds (for `'ai'` strategy). */
    timeoutMs?: number;
}

/**
 * Merge node — combines items from multiple parent nodes.
 *
 * This is the only node that receives `Items[]` (one per parent).
 * `from` must have at least two entries — this constraint cannot be enforced
 * at the type level and is validated at runtime by the graph validator
 * (`MERGE_NEEDS_MULTIPLE_PARENTS` error code).
 *
 * - `'concat'` (default) — concatenate all parent items in order.
 * - `'zip'` — interleave items from parents by index.
 */
export interface MergeNodeConfig extends BaseNode {
    type: 'merge';
    /** Merge strategy. Default: `'concat'`. */
    strategy?: 'concat' | 'zip';
}

/**
 * Transform node — applies a sequence of data transformations to items.
 *
 * Operations are applied in the order they appear in the `ops` array.
 */
export interface TransformNodeConfig extends BaseNode {
    type: 'transform';
    /** Ordered list of transform operations to apply. */
    ops: TransformOp[];
}

/**
 * AI node — sends items to an AI model in a single prompt.
 *
 * Unlike `map` (which processes items individually or in batches), this node
 * sends all items at once. Exactly one of `prompt` or `promptFile` must be specified.
 */
export interface AINodeConfig extends BaseNode {
    type: 'ai';
    /** Inline prompt template. Supports `{{fieldName}}` and `{{ITEMS}}` interpolation. */
    prompt?: string;
    /** Path to a prompt file (relative to workflowDirectory). */
    promptFile?: string;
    /** Field names to parse from the AI response. */
    output?: string[];
    /** Model override for this node. */
    model?: string;
    /** Timeout in milliseconds. */
    timeoutMs?: number;
}

// =============================================================================
// NodeConfig Discriminated Union
// =============================================================================

/**
 * Union of all node configuration types.
 *
 * Each member has `type` as a string literal discriminant, enabling exhaustive
 * `switch (config.type)` narrowing. An exhaustive switch should end with:
 *
 * ```typescript
 * default: {
 *   const _exhaustive: never = config;
 *   throw new Error(`Unhandled node type: ${(_exhaustive as NodeConfig).type}`);
 * }
 * ```
 */
export type NodeConfig =
    | LoadNodeConfig
    | ScriptNodeConfig
    | FilterNodeConfig
    | MapNodeConfig
    | ReduceNodeConfig
    | MergeNodeConfig
    | TransformNodeConfig
    | AINodeConfig;

// =============================================================================
// Workflow Configuration
// =============================================================================

/**
 * Global settings for a workflow, providing defaults for all nodes.
 *
 * Node-level settings override these; these override hardcoded defaults.
 * Cascade order: node-level → settings block → hardcoded defaults.
 */
export interface WorkflowSettings {
    /** Default AI model for all AI-capable nodes. */
    model?: string;
    /** Default concurrency for parallel operations (default: 5). */
    concurrency?: number;
    /** Default timeout in milliseconds (default: 1,800,000 = 30 minutes). */
    timeoutMs?: number;
    /** Default error handling strategy for all nodes. */
    onError?: 'abort' | 'warn';
}

/**
 * Top-level workflow configuration as parsed from YAML.
 *
 * The `nodes` record maps node IDs (user-defined strings) to their
 * configuration. The workflow engine builds a DAG from `from` references
 * and executes nodes tier-by-tier.
 */
export interface WorkflowConfig {
    /** Human-readable workflow name. */
    name: string;
    /** Optional description. */
    description?: string;
    /** Global settings providing defaults for all nodes. */
    settings?: WorkflowSettings;
    /**
     * Node definitions. Keys are unique node IDs referenced in `from` arrays.
     * Order does not matter — the engine resolves execution order via topological sort.
     */
    nodes: Record<string, NodeConfig>;
}

// =============================================================================
// Execution Results
// =============================================================================

/**
 * Execution statistics for a single node.
 */
export interface NodeStats {
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
    /** Number of input items received. */
    inputCount: number;
    /** Number of output items produced. */
    outputCount: number;
}

/**
 * Result of executing a single node.
 */
export interface NodeResult {
    /** Node ID. */
    nodeId: string;
    /** Whether the node completed successfully. */
    success: boolean;
    /** Output items (empty array on failure if `onError: 'warn'`). */
    items: Items;
    /** Error message if the node failed. */
    error?: string;
    /** Execution statistics. */
    stats: NodeStats;
}

/**
 * Overall result of executing a complete workflow.
 *
 * `results` and `leaves` use `Map<string, NodeResult>` (not `Record`) to
 * preserve insertion order (which equals topological execution order) and
 * provide O(1) lookup without prototype pollution concerns. Callers that
 * need plain objects for serialisation are responsible for conversion.
 */
export interface WorkflowResult {
    /** Whether the entire workflow completed successfully. */
    success: boolean;
    /** Results for every executed node, keyed by node ID. */
    results: Map<string, NodeResult>;
    /** Results for leaf nodes only (nodes with no downstream dependents). */
    leaves: Map<string, NodeResult>;
    /** Total wall-clock duration in milliseconds. */
    totalDurationMs: number;
    /** Error message if the workflow failed. */
    error?: string;
}

// =============================================================================
// DAG Graph Types
// =============================================================================

/**
 * Adjacency-list representation of the workflow DAG.
 *
 * - `adjacency` maps each node ID to its list of direct children (dependents).
 * - `inDegree` maps each node ID to the count of incoming edges (parents).
 */
export interface DAGGraph {
    /** Map of node ID → list of child node IDs. */
    adjacency: Map<string, string[]>;
    /** Map of node ID → number of incoming edges. */
    inDegree: Map<string, number>;
}

/**
 * An execution tier — a group of node IDs that can run in parallel.
 *
 * Tiers are produced by topological sort (Kahn's algorithm); within a tier,
 * all nodes have their dependencies satisfied.
 */
export type ExecutionTier = string[];

// =============================================================================
// Execution Options
// =============================================================================

/**
 * Options for executing a workflow.
 */
export interface WorkflowExecutionOptions {
    /**
     * AI invoker function for AI-capable nodes (map, reduce, ai, filter with ai rule, load with ai source).
     * Imported from `map-reduce/types` — do not redefine.
     */
    aiInvoker?: AIInvoker;
    /**
     * Process tracker for integration with AI process manager.
     * Imported from `map-reduce/types` — do not redefine.
     */
    processTracker?: ProcessTracker;
    /**
     * Directory containing the workflow YAML file.
     *
     * Used to resolve relative paths in `promptFile`, `source.path`, `cwd`, etc.
     * This is the directory where the workflow package lives.
     */
    workflowDirectory?: string;
    /**
     * Workspace root directory.
     *
     * Used for operations that need the project root (e.g., git operations).
     * Distinct from `workflowDirectory` which is the pipeline package directory.
     */
    workspaceRoot?: string;
    /** Override the default AI model for all nodes. */
    model?: string;
    /** Override the default concurrency. */
    concurrency?: number;
    /** Override the default timeout in milliseconds. */
    timeoutMs?: number;
    /** Abort signal for cancellation support. */
    signal?: AbortSignal;
}

// =============================================================================
// Type Guards
// =============================================================================

/** All known node type literals. */
const NODE_TYPES = new Set(['load', 'script', 'filter', 'map', 'reduce', 'merge', 'transform', 'ai']);

/**
 * Check whether a value is a non-null object with a `type` property.
 * @internal
 */
function isObjectWithType(value: unknown): value is { type: string } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        typeof (value as { type: unknown }).type === 'string'
    );
}

/** Type guard for {@link LoadNodeConfig}. */
export function isLoadNode(config: unknown): config is LoadNodeConfig {
    return isObjectWithType(config) && config.type === 'load';
}

/** Type guard for {@link ScriptNodeConfig}. */
export function isScriptNode(config: unknown): config is ScriptNodeConfig {
    return isObjectWithType(config) && config.type === 'script';
}

/** Type guard for {@link FilterNodeConfig}. */
export function isFilterNode(config: unknown): config is FilterNodeConfig {
    return isObjectWithType(config) && config.type === 'filter';
}

/** Type guard for {@link MapNodeConfig}. */
export function isMapNode(config: unknown): config is MapNodeConfig {
    return isObjectWithType(config) && config.type === 'map';
}

/** Type guard for {@link ReduceNodeConfig}. */
export function isReduceNode(config: unknown): config is ReduceNodeConfig {
    return isObjectWithType(config) && config.type === 'reduce';
}

/** Type guard for {@link MergeNodeConfig}. */
export function isMergeNode(config: unknown): config is MergeNodeConfig {
    return isObjectWithType(config) && config.type === 'merge';
}

/** Type guard for {@link TransformNodeConfig}. */
export function isTransformNode(config: unknown): config is TransformNodeConfig {
    return isObjectWithType(config) && config.type === 'transform';
}

/** Type guard for {@link AINodeConfig}. */
export function isAINode(config: unknown): config is AINodeConfig {
    return isObjectWithType(config) && config.type === 'ai';
}

/**
 * Type guard for {@link NodeConfig}.
 *
 * Returns `true` if the value is an object with a `type` property matching
 * one of the eight known node type literals.
 */
export function isNodeConfig(value: unknown): value is NodeConfig {
    return isObjectWithType(value) && NODE_TYPES.has(value.type);
}
