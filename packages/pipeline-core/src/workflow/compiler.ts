/**
 * Pipeline → Workflow Compiler
 *
 * Compiles legacy pipeline YAML configs (`PipelineConfig`) into the DAG-based
 * `WorkflowConfig` format. Also handles workflow YAML passthrough (validate + return).
 *
 * Entry points:
 * - `compileToWorkflow(yaml)` — parse YAML string and compile
 * - `compileToWorkflowFromObject(parsed)` — compile from already-parsed object
 * - `detectFormat(parsed)` — detect whether a parsed object is pipeline or workflow
 */

import { PipelineCoreError } from '../errors/pipeline-core-error';
import type { ErrorCodeType } from '../errors/error-codes';
import type {
    WorkflowConfig,
    LoadNodeConfig,
    FilterNodeConfig,
    MapNodeConfig,
    ReduceNodeConfig,
    AINodeConfig,
    NodeConfig,
    WorkflowSettings,
    WorkflowFilterRule,
    WorkflowFilterOp,
    ReduceStrategy,
} from './types';
import { validate } from './validator';
import type {
    PipelineConfig,
    InputConfig,
    FilterConfig,
    MapConfig,
    ReduceConfig,
    JobConfig,
    PipelineParameter,
    FilterOperator,
    FilterRule,
} from '../pipeline/types';
import { isCSVSource } from '../pipeline/types';

// =============================================================================
// Error
// =============================================================================

/** Error code for compile-time failures. */
const COMPILER_ERROR = 'COMPILER_ERROR';

/**
 * Error thrown when pipeline-to-workflow compilation fails.
 */
export class CompilerError extends PipelineCoreError {
    constructor(message: string, meta?: Record<string, unknown>) {
        super(message, { code: COMPILER_ERROR as ErrorCodeType, meta });
        this.name = 'CompilerError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// =============================================================================
// Format Detection
// =============================================================================

export type DetectedFormat = 'pipeline' | 'workflow';

/**
 * Detect whether a parsed YAML object is a pipeline config or workflow config.
 *
 * Heuristic:
 *   - Has `nodes` key (Record<string, NodeConfig>) → workflow
 *   - Has `input`, `map`, `job`, `filter`, or `reduce` at top level → pipeline
 *   - Otherwise → throw
 */
export function detectFormat(parsed: Record<string, unknown>): DetectedFormat {
    if (parsed.nodes && typeof parsed.nodes === 'object' && !Array.isArray(parsed.nodes)) {
        return 'workflow';
    }
    if ('input' in parsed || 'map' in parsed || 'job' in parsed || 'filter' in parsed || 'reduce' in parsed) {
        return 'pipeline';
    }
    throw new CompilerError(
        'Cannot detect format: object has neither `nodes` (workflow) nor `input`/`map`/`job`/`filter`/`reduce` (pipeline)',
    );
}

// =============================================================================
// Operator Mapping
// =============================================================================

const OPERATOR_MAP: Record<FilterOperator, WorkflowFilterOp> = {
    equals: 'eq',
    not_equals: 'neq',
    in: 'in',
    not_in: 'nin',
    contains: 'contains',
    not_contains: 'not_contains',
    greater_than: 'gt',
    less_than: 'lt',
    gte: 'gte',
    lte: 'lte',
    matches: 'matches',
};

// =============================================================================
// Reduce Type Mapping
// =============================================================================

const REDUCE_TYPE_MAP: Record<string, ReduceStrategy> = {
    list: 'list',
    table: 'table',
    json: 'json',
    csv: 'csv',
    ai: 'ai',
    text: 'concat',
};

// =============================================================================
// Node Compilers
// =============================================================================

/**
 * Compile a pipeline `InputConfig` to a workflow `LoadNodeConfig`.
 * @internal exported for testing
 */
export function compileLoadNode(input: InputConfig): LoadNodeConfig {
    if (input.from && isCSVSource(input.from)) {
        return {
            type: 'load',
            source: {
                type: 'csv',
                path: input.from.path,
                ...(input.from.delimiter && { delimiter: input.from.delimiter }),
            },
            ...(input.limit != null && { limit: input.limit }),
        };
    }
    if (input.from && Array.isArray(input.from)) {
        return {
            type: 'load',
            source: { type: 'inline', items: input.from },
            ...(input.limit != null && { limit: input.limit }),
        };
    }
    if (input.items) {
        return {
            type: 'load',
            source: { type: 'inline', items: input.items },
            ...(input.limit != null && { limit: input.limit }),
        };
    }
    if (input.generate) {
        return {
            type: 'load',
            source: {
                type: 'ai',
                prompt: input.generate.prompt,
                schema: input.generate.schema,
                ...(input.generate.model && { model: input.generate.model }),
            },
            ...(input.limit != null && { limit: input.limit }),
        };
    }
    throw new CompilerError('input must have one of: items, from, generate');
}

/**
 * Compile a single pipeline `FilterRule` to a workflow field rule.
 * @internal
 */
function compileFilterRule(rule: FilterRule): WorkflowFilterRule {
    return {
        type: 'field',
        field: rule.field,
        op: OPERATOR_MAP[rule.operator],
        ...(rule.value !== undefined && { value: rule.value }),
        ...(rule.values && { values: rule.values }),
    };
}

/**
 * Compile a pipeline `FilterConfig` to a workflow `FilterNodeConfig`.
 * @internal exported for testing
 */
export function compileFilterNode(filter: FilterConfig, from: string): FilterNodeConfig {
    let rule: WorkflowFilterRule;

    if (filter.type === 'rule' && filter.rule) {
        const fieldRules = filter.rule.rules.map(compileFilterRule);
        rule = fieldRules.length === 1
            ? fieldRules[0]
            : { type: filter.rule.mode === 'any' ? 'or' : 'and', rules: fieldRules };
    } else if (filter.type === 'ai' && filter.ai) {
        rule = {
            type: 'ai',
            prompt: filter.ai.prompt,
            ...(filter.ai.model && { model: filter.ai.model }),
            ...(filter.ai.parallel && { concurrency: filter.ai.parallel }),
            ...(filter.ai.timeoutMs && { timeoutMs: filter.ai.timeoutMs }),
        };
    } else if (filter.type === 'hybrid' && filter.rule && filter.ai) {
        const fieldRules = filter.rule.rules.map(compileFilterRule);
        const ruleNode: WorkflowFilterRule = fieldRules.length === 1
            ? fieldRules[0]
            : { type: filter.rule.mode === 'any' ? 'or' : 'and', rules: fieldRules };
        const aiNode: WorkflowFilterRule = {
            type: 'ai',
            prompt: filter.ai.prompt,
            ...(filter.ai.model && { model: filter.ai.model }),
            ...(filter.ai.parallel && { concurrency: filter.ai.parallel }),
            ...(filter.ai.timeoutMs && { timeoutMs: filter.ai.timeoutMs }),
        };
        rule = { type: filter.combineMode === 'or' ? 'or' : 'and', rules: [ruleNode, aiNode] };
    } else {
        throw new CompilerError('Invalid filter configuration');
    }

    return { type: 'filter', from: [from], rule };
}

/**
 * Compile a pipeline `MapConfig` to a workflow `MapNodeConfig`.
 * @internal exported for testing
 */
export function compileMapNode(map: MapConfig, from: string): MapNodeConfig {
    return {
        type: 'map',
        from: [from],
        ...(map.prompt && { prompt: map.prompt }),
        ...(map.promptFile && { promptFile: map.promptFile }),
        ...(map.skill && { skill: map.skill }),
        ...(map.output && { output: map.output }),
        ...(map.model && { model: map.model }),
        ...(map.parallel && { concurrency: map.parallel }),
        ...(map.timeoutMs && { timeoutMs: map.timeoutMs }),
        ...(map.batchSize && { batchSize: map.batchSize }),
    };
}

/**
 * Compile a pipeline `JobConfig` to a workflow `AINodeConfig`.
 * @internal exported for testing
 */
export function compileJobNode(job: JobConfig): AINodeConfig {
    return {
        type: 'ai',
        ...(job.prompt && { prompt: job.prompt }),
        ...(job.promptFile && { promptFile: job.promptFile }),
        ...(job.skill && { skill: job.skill }),
        ...(job.output && { output: job.output }),
        ...(job.model && { model: job.model }),
        ...(job.timeoutMs && { timeoutMs: job.timeoutMs }),
    };
}

/**
 * Compile a pipeline `ReduceConfig` to a workflow `ReduceNodeConfig`.
 * @internal exported for testing
 */
export function compileReduceNode(reduce: ReduceConfig, from: string): ReduceNodeConfig {
    const strategy = REDUCE_TYPE_MAP[reduce.type];
    if (!strategy) {
        throw new CompilerError(`Unsupported reduce type: ${reduce.type}`);
    }
    return {
        type: 'reduce',
        from: [from],
        strategy,
        ...(reduce.prompt && { prompt: reduce.prompt }),
        ...(reduce.promptFile && { promptFile: reduce.promptFile }),
        ...(reduce.skill && { skill: reduce.skill }),
        ...(reduce.output && { output: reduce.output }),
        ...(reduce.model && { model: reduce.model }),
    };
}

// =============================================================================
// Parameter Merging
// =============================================================================

/**
 * Merge top-level and input-level pipeline parameters into a Record.
 * Input-level parameters take precedence.
 */
function mergeParameters(
    topLevel?: PipelineParameter[],
    inputLevel?: PipelineParameter[],
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const p of topLevel ?? []) {
        result[p.name] = String(p.value);
    }
    for (const p of inputLevel ?? []) {
        result[p.name] = String(p.value);
    }
    return result;
}

// =============================================================================
// Pipeline Structural Validation
// =============================================================================

/**
 * Lightweight structural check for pipeline configs before compilation.
 * @internal
 */
function validatePipelineStructure(pipeline: PipelineConfig): void {
    if (!pipeline.name) {
        throw new CompilerError('Pipeline config missing "name"');
    }
    if (pipeline.job && pipeline.map) {
        throw new CompilerError('Cannot use `job` and `map` in the same pipeline');
    }
    if (!pipeline.job && !pipeline.map) {
        throw new CompilerError('Pipeline must have either `job` or `map`');
    }
}

// =============================================================================
// Full Pipeline → Workflow Compilation
// =============================================================================

/**
 * Compile a pipeline config object into a WorkflowConfig.
 * @internal
 */
function compilePipelineToWorkflow(parsed: Record<string, unknown>): WorkflowConfig {
    const pipeline = parsed as unknown as PipelineConfig;
    validatePipelineStructure(pipeline);

    const nodes: Record<string, NodeConfig> = {};
    let lastNodeId = '';

    // Job mode
    if (pipeline.job) {
        nodes['job'] = compileJobNode(pipeline.job);
        lastNodeId = 'job';
    } else {
        // Map-reduce mode
        if (pipeline.input) {
            nodes['load'] = compileLoadNode(pipeline.input);
            lastNodeId = 'load';
        }

        if (pipeline.filter) {
            nodes['filter'] = compileFilterNode(pipeline.filter, lastNodeId);
            lastNodeId = 'filter';
        }

        if (pipeline.map) {
            nodes['map'] = compileMapNode(pipeline.map, lastNodeId);
            lastNodeId = 'map';
        }

        if (pipeline.reduce) {
            nodes['reduce'] = compileReduceNode(pipeline.reduce, lastNodeId);
            lastNodeId = 'reduce';
        }
    }

    // Top-level fields
    const config: WorkflowConfig = {
        name: pipeline.name,
        nodes,
    };

    // Settings
    const settings: WorkflowSettings = {};
    if (pipeline.workingDirectory) {
        settings.workingDirectory = pipeline.workingDirectory;
    }
    if (pipeline.toolCallCache) {
        settings.toolCallCache = true;
    }
    if (Object.keys(settings).length > 0) {
        config.settings = settings;
    }

    // Parameters: array → record
    const params = mergeParameters(pipeline.parameters, pipeline.input?.parameters);
    if (Object.keys(params).length > 0) {
        config.parameters = params;
    }

    return config;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse YAML string and compile to WorkflowConfig regardless of source format.
 *
 * - Workflow YAML → validate via existing `validate()` → return as-is
 * - Pipeline YAML → compile to WorkflowConfig
 */
export function compileToWorkflow(yaml: string): WorkflowConfig {
    const jsYaml = require('js-yaml');
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    return compileToWorkflowFromObject(parsed);
}

/**
 * Same as compileToWorkflow but accepts an already-parsed object.
 * Useful for callers that have already called js-yaml.
 */
export function compileToWorkflowFromObject(parsed: Record<string, unknown>): WorkflowConfig {
    const format = detectFormat(parsed);

    if (format === 'workflow') {
        const config = parsed as unknown as WorkflowConfig;
        validate(config);
        return config;
    }

    return compilePipelineToWorkflow(parsed);
}
