import { describe, expect, it } from 'vitest';
import {
    // Node config types (workflow)
    type LoadNodeConfig,
    type ScriptNodeConfig,
    type FilterNodeConfig,
    type MapNodeConfig,
    type ReduceNodeConfig,
    type MergeNodeConfig,
    type TransformNodeConfig,
    type AINodeConfig,
    type NodeConfig,
    type WorkflowConfig,
    type WorkflowExecutionOptions,
    // Legacy pipeline config types (pipeline-compat)
    type PipelineConfig,
    type CSVSource,
    type GenerateInputConfig,
    type RuleFilterConfig,
    type AIFilterConfig,
    type JobConfig,
    // Runtime guards (must narrow the compat types above)
    isLoadNode,
    isScriptNode,
    isFilterNode,
    isMapNode,
    isReduceNode,
    isMergeNode,
    isTransformNode,
    isAINode,
    isNodeConfig,
    isCSVSource,
    isGenerateConfig,
} from '../../src';

// Package-consumer compile coverage: a downstream consumer must be able to author values of
// every legacy workflow/pipeline type from Forge's public entry point. Forge's `tsc` build
// gates the re-exports themselves; this suite pins that the type shapes and their runtime
// guards still line up.

describe('legacy workflow node type compilation', () => {
    it('constructs and narrows every concrete node config through Forge exports', () => {
        const load: LoadNodeConfig = { type: 'load', source: { type: 'inline', items: [{ a: 1 }] } };
        const script: ScriptNodeConfig = { type: 'script', run: 'echo hi', from: ['load'] };
        const filter: FilterNodeConfig = {
            type: 'filter',
            from: ['load'],
            rule: { type: 'field', field: 'a', op: 'gt', value: 0 },
        };
        const map: MapNodeConfig = { type: 'map', from: ['load'], prompt: 'Summarize {{a}}' };
        const reduce: ReduceNodeConfig = { type: 'reduce', from: ['map'], strategy: 'list' };
        const merge: MergeNodeConfig = { type: 'merge', from: ['load', 'map'], strategy: 'concat' };
        const transform: TransformNodeConfig = {
            type: 'transform',
            from: ['load'],
            ops: [{ op: 'select', fields: ['a'] }],
        };
        const ai: AINodeConfig = { type: 'ai', from: ['load'], prompt: 'Classify {{ITEMS}}' };

        const nodes: NodeConfig[] = [load, script, filter, map, reduce, merge, transform, ai];
        expect(nodes.every(isNodeConfig)).toBe(true);

        expect(isLoadNode(load)).toBe(true);
        expect(isScriptNode(script)).toBe(true);
        expect(isFilterNode(filter)).toBe(true);
        expect(isMapNode(map)).toBe(true);
        expect(isReduceNode(reduce)).toBe(true);
        expect(isMergeNode(merge)).toBe(true);
        expect(isTransformNode(transform)).toBe(true);
        expect(isAINode(ai)).toBe(true);

        // Cross-checks: a guard only matches its own discriminant.
        expect(isLoadNode(script)).toBe(false);
        expect(isAINode(map)).toBe(false);
    });

    it('constructs a WorkflowConfig and execution options through Forge exports', () => {
        const config: WorkflowConfig = {
            name: 'compile-check',
            nodes: {
                load: { type: 'load', source: { type: 'inline', items: [{ a: 1 }] } },
                map: { type: 'map', from: ['load'], prompt: 'Summarize {{a}}' },
            },
        };
        const options: WorkflowExecutionOptions = { workflowDirectory: '/tmp', concurrency: 2 };

        expect(config.name).toBe('compile-check');
        expect(options.concurrency).toBe(2);
    });
});

describe('legacy pipeline type compilation', () => {
    it('constructs and narrows legacy pipeline compat types through Forge exports', () => {
        const csv: CSVSource = { type: 'csv', path: 'data.csv' };
        const generate: GenerateInputConfig = { prompt: 'Generate 3 items', schema: ['name'] };
        const job: JobConfig = { prompt: 'Do the thing' };
        const ruleFilter: RuleFilterConfig = {
            rules: [{ field: 'score', operator: 'greater_than', value: 0 }],
            mode: 'all',
        };
        const aiFilter: AIFilterConfig = { prompt: 'Keep relevant items' };
        const mapReducePipeline: PipelineConfig = {
            name: 'legacy-map-reduce',
            input: { from: csv },
            map: { prompt: 'Summarize {{name}}' },
            reduce: { type: 'list' },
        };
        const jobPipeline: PipelineConfig = { name: 'legacy-job', job };

        expect(isCSVSource(csv)).toBe(true);
        expect(isCSVSource(generate)).toBe(false);
        expect(isGenerateConfig(generate)).toBe(true);
        expect(isGenerateConfig(csv)).toBe(false);
        expect(mapReducePipeline.input?.from).toBe(csv);
        expect(jobPipeline.job?.prompt).toBe('Do the thing');
        expect(ruleFilter.rules[0].field).toBe('score');
        expect(aiFilter.prompt).toBe('Keep relevant items');
    });
});
