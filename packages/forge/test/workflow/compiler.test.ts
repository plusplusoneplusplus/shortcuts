/**
 * Tests for the Pipeline → Workflow Compiler
 */

import { describe, it, expect } from 'vitest';
import {
    detectFormat,
    compileToWorkflow,
    compileToWorkflowFromObject,
    compileLoadNode,
    compileFilterNode,
    compileMapNode,
    compileJobNode,
    compileReduceNode,
    CompilerError,
} from '../../src/workflow/compiler';
import type {
    LoadNodeConfig,
    FilterNodeConfig,
    MapNodeConfig,
    ReduceNodeConfig,
    AINodeConfig,
    WorkflowConfig,
} from '../../src/workflow/types';
import type {
    InputConfig,
    FilterConfig,
    MapConfig,
    ReduceConfig,
    JobConfig,
} from '../../src/workflow/pipeline-compat';
import { isCSVSource, isGenerateConfig } from '../../src/workflow/pipeline-compat';

// =============================================================================
// detectFormat
// =============================================================================

describe('detectFormat', () => {
    it('detects workflow format when nodes: key is present', () => {
        expect(detectFormat({ name: 'test', nodes: { a: { type: 'load' } } })).toBe('workflow');
    });

    it('detects pipeline format when input: + map: keys are present', () => {
        expect(detectFormat({ name: 'test', input: {}, map: {} })).toBe('pipeline');
    });

    it('detects pipeline format when job: key is present', () => {
        expect(detectFormat({ name: 'test', job: {} })).toBe('pipeline');
    });

    it('detects pipeline format when filter: key is present', () => {
        expect(detectFormat({ name: 'test', filter: {}, map: {} })).toBe('pipeline');
    });

    it('detects pipeline format when reduce: key is present', () => {
        expect(detectFormat({ name: 'test', reduce: {} })).toBe('pipeline');
    });

    it('throws on unrecognizable structure (no nodes, no input/map/job)', () => {
        expect(() => detectFormat({ name: 'test' })).toThrow(CompilerError);
        expect(() => detectFormat({ name: 'test' })).toThrow('Cannot detect format');
    });

    it('prefers workflow when both nodes: and map: are present', () => {
        expect(detectFormat({ nodes: { a: {} }, map: {} })).toBe('workflow');
    });
});

// =============================================================================
// compileToWorkflow — workflow passthrough
// =============================================================================

describe('compileToWorkflow — workflow passthrough', () => {
    it('returns valid WorkflowConfig unchanged', () => {
        const yaml = `
name: test-workflow
nodes:
  load:
    type: load
    source:
      type: inline
      items:
        - name: alice
  map:
    type: map
    from: [load]
    prompt: "Hello {{name}}"
`;
        const config = compileToWorkflow(yaml);
        expect(config.name).toBe('test-workflow');
        expect(Object.keys(config.nodes)).toEqual(['load', 'map']);
    });

    it('throws WorkflowValidationError on invalid workflow YAML', () => {
        const yaml = `
name: bad-workflow
nodes: {}
`;
        expect(() => compileToWorkflow(yaml)).toThrow('at least one node');
    });
});

// =============================================================================
// compileLoadNode
// =============================================================================

describe('compileLoadNode', () => {
    it('CSV from → load with csv source', () => {
        const input: InputConfig = { from: { type: 'csv', path: 'data.csv' } };
        const node = compileLoadNode(input);
        expect(node.type).toBe('load');
        expect(node.source).toEqual({ type: 'csv', path: 'data.csv' });
    });

    it('CSV from with delimiter → preserves delimiter', () => {
        const input: InputConfig = { from: { type: 'csv', path: 'data.tsv', delimiter: '\t' } };
        const node = compileLoadNode(input);
        expect(node.source).toEqual({ type: 'csv', path: 'data.tsv', delimiter: '\t' });
    });

    it('inline items → load with inline source', () => {
        const items = [{ name: 'alice' }, { name: 'bob' }];
        const input: InputConfig = { items };
        const node = compileLoadNode(input);
        expect(node.source).toEqual({ type: 'inline', items });
    });

    it('inline from (array) → load with inline source', () => {
        const items = [{ model: 'gpt-4' }, { model: 'claude' }];
        const input: InputConfig = { from: items };
        const node = compileLoadNode(input);
        expect(node.source).toEqual({ type: 'inline', items });
    });

    it('generate → load with ai source', () => {
        const input: InputConfig = {
            generate: { prompt: 'Generate test cases', schema: ['name', 'input'] },
        };
        const node = compileLoadNode(input);
        expect(node.source).toEqual({
            type: 'ai',
            prompt: 'Generate test cases',
            schema: ['name', 'input'],
        });
    });

    it('generate with model → preserves model on ai source', () => {
        const input: InputConfig = {
            generate: { prompt: 'Generate', schema: ['a'], model: 'gpt-4' },
        };
        const node = compileLoadNode(input);
        expect((node.source as { type: 'ai'; model?: string }).model).toBe('gpt-4');
    });

    it('limit → copied to load node', () => {
        const input: InputConfig = { items: [{ a: '1' }], limit: 5 };
        const node = compileLoadNode(input);
        expect(node.limit).toBe(5);
    });

    it('throws on empty input (no items/from/generate)', () => {
        expect(() => compileLoadNode({} as InputConfig)).toThrow(CompilerError);
        expect(() => compileLoadNode({} as InputConfig)).toThrow('input must have one of');
    });

    it('throws when from is an unsupported object type (not CSVSource, not array)', () => {
        const input = { from: { type: 'sftp', path: 'remote.csv' } } as unknown as InputConfig;
        expect(() => compileLoadNode(input)).toThrow(CompilerError);
        expect(() => compileLoadNode(input)).toThrow('input must have one of');
    });

    it('compiled generate node has type load (not ai-generate)', () => {
        const input: InputConfig = {
            generate: { prompt: 'Generate items', schema: ['name'] },
        };
        const node = compileLoadNode(input);
        expect(node.type).toBe('load');
        expect(node.source.type).toBe('ai');
    });
});

// =============================================================================
// compileFilterNode
// =============================================================================

describe('compileFilterNode', () => {
    it('rule filter with single rule → flat field rule', () => {
        const filter: FilterConfig = {
            type: 'rule',
            rule: { rules: [{ field: 'status', operator: 'equals', value: 'open' }] },
        };
        const node = compileFilterNode(filter, 'load');
        expect(node.type).toBe('filter');
        expect(node.from).toEqual(['load']);
        expect(node.rule).toEqual({ type: 'field', field: 'status', op: 'eq', value: 'open' });
    });

    it('rule filter with multiple rules, mode=all → and group', () => {
        const filter: FilterConfig = {
            type: 'rule',
            rule: {
                mode: 'all',
                rules: [
                    { field: 'status', operator: 'equals', value: 'open' },
                    { field: 'priority', operator: 'greater_than', value: 3 },
                ],
            },
        };
        const node = compileFilterNode(filter, 'load');
        expect(node.rule).toEqual({
            type: 'and',
            rules: [
                { type: 'field', field: 'status', op: 'eq', value: 'open' },
                { type: 'field', field: 'priority', op: 'gt', value: 3 },
            ],
        });
    });

    it('rule filter with multiple rules, mode=any → or group', () => {
        const filter: FilterConfig = {
            type: 'rule',
            rule: {
                mode: 'any',
                rules: [
                    { field: 'status', operator: 'equals', value: 'open' },
                    { field: 'status', operator: 'equals', value: 'in_progress' },
                ],
            },
        };
        const node = compileFilterNode(filter, 'load');
        expect(node.rule).toEqual({
            type: 'or',
            rules: [
                { type: 'field', field: 'status', op: 'eq', value: 'open' },
                { type: 'field', field: 'status', op: 'eq', value: 'in_progress' },
            ],
        });
    });

    it('maps all pipeline operators to workflow operators', () => {
        const operators = [
            ['equals', 'eq'],
            ['not_equals', 'neq'],
            ['in', 'in'],
            ['not_in', 'nin'],
            ['contains', 'contains'],
            ['not_contains', 'not_contains'],
            ['greater_than', 'gt'],
            ['less_than', 'lt'],
            ['gte', 'gte'],
            ['lte', 'lte'],
            ['matches', 'matches'],
        ] as const;

        for (const [pipelineOp, workflowOp] of operators) {
            const filter: FilterConfig = {
                type: 'rule',
                rule: { rules: [{ field: 'x', operator: pipelineOp, value: 'v' }] },
            };
            const node = compileFilterNode(filter, 'load');
            const rule = node.rule as { type: 'field'; op: string };
            expect(rule.op).toBe(workflowOp);
        }
    });

    it('ai filter → ai rule with prompt/model/concurrency', () => {
        const filter: FilterConfig = {
            type: 'ai',
            ai: { prompt: 'Is this relevant?', model: 'gpt-4', parallel: 3, timeoutMs: 5000 },
        };
        const node = compileFilterNode(filter, 'load');
        expect(node.rule).toEqual({
            type: 'ai',
            prompt: 'Is this relevant?',
            model: 'gpt-4',
            concurrency: 3,
            timeoutMs: 5000,
        });
    });

    it('hybrid filter, combineMode=and → and([rule, ai])', () => {
        const filter: FilterConfig = {
            type: 'hybrid',
            combineMode: 'and',
            rule: { rules: [{ field: 'status', operator: 'equals', value: 'open' }] },
            ai: { prompt: 'Is relevant?' },
        };
        const node = compileFilterNode(filter, 'load');
        expect(node.rule).toEqual({
            type: 'and',
            rules: [
                { type: 'field', field: 'status', op: 'eq', value: 'open' },
                { type: 'ai', prompt: 'Is relevant?' },
            ],
        });
    });

    it('hybrid filter, combineMode=or → or([rule, ai])', () => {
        const filter: FilterConfig = {
            type: 'hybrid',
            combineMode: 'or',
            rule: { rules: [{ field: 'status', operator: 'equals', value: 'open' }] },
            ai: { prompt: 'Is relevant?' },
        };
        const node = compileFilterNode(filter, 'load');
        expect(node.rule).toEqual({
            type: 'or',
            rules: [
                { type: 'field', field: 'status', op: 'eq', value: 'open' },
                { type: 'ai', prompt: 'Is relevant?' },
            ],
        });
    });

    it('preserves value and values on field rules', () => {
        const filter: FilterConfig = {
            type: 'rule',
            rule: { rules: [{ field: 'tag', operator: 'in', values: ['a', 'b', 'c'] }] },
        };
        const node = compileFilterNode(filter, 'load');
        const rule = node.rule as { type: 'field'; values: string[] };
        expect(rule.values).toEqual(['a', 'b', 'c']);
    });

    it('throws on invalid filter config', () => {
        const filter = { type: 'rule' } as FilterConfig; // missing rule
        expect(() => compileFilterNode(filter, 'load')).toThrow(CompilerError);
    });
});

// =============================================================================
// compileMapNode
// =============================================================================

describe('compileMapNode', () => {
    it('copies prompt, output, model, timeoutMs, batchSize', () => {
        const map: MapConfig = {
            prompt: 'Classify: {{title}}',
            output: ['severity'],
            model: 'gpt-4',
            timeoutMs: 30000,
            batchSize: 10,
        };
        const node = compileMapNode(map, 'load');
        expect(node.prompt).toBe('Classify: {{title}}');
        expect(node.output).toEqual(['severity']);
        expect(node.model).toBe('gpt-4');
        expect(node.timeoutMs).toBe(30000);
        expect(node.batchSize).toBe(10);
    });

    it('renames parallel → concurrency', () => {
        const map: MapConfig = { prompt: 'test', parallel: 5 };
        const node = compileMapNode(map, 'load');
        expect(node.concurrency).toBe(5);
        expect((node as any).parallel).toBeUndefined();
    });

    it('copies promptFile when used instead of prompt', () => {
        const map: MapConfig = { promptFile: 'analyze.prompt.md' };
        const node = compileMapNode(map, 'load');
        expect(node.promptFile).toBe('analyze.prompt.md');
        expect(node.prompt).toBeUndefined();
    });

    it('copies skill field', () => {
        const map: MapConfig = { prompt: 'test', skill: 'go-deep' };
        const node = compileMapNode(map, 'load');
        expect(node.skill).toBe('go-deep');
    });

    it('sets from to the upstream node id', () => {
        const node = compileMapNode({ prompt: 'test' }, 'filter');
        expect(node.from).toEqual(['filter']);
    });

    it('omits undefined optional fields', () => {
        const node = compileMapNode({ prompt: 'test' }, 'load');
        expect(node.promptFile).toBeUndefined();
        expect(node.skill).toBeUndefined();
        expect(node.output).toBeUndefined();
        expect(node.model).toBeUndefined();
        expect(node.concurrency).toBeUndefined();
        expect(node.timeoutMs).toBeUndefined();
        expect(node.batchSize).toBeUndefined();
    });
});

// =============================================================================
// compileJobNode
// =============================================================================

describe('compileJobNode', () => {
    it('compiles job with prompt to ai node', () => {
        const job: JobConfig = { prompt: 'Analyze the codebase' };
        const node = compileJobNode(job);
        expect(node.type).toBe('ai');
        expect(node.prompt).toBe('Analyze the codebase');
    });

    it('compiles job with promptFile to ai node', () => {
        const job: JobConfig = { promptFile: 'analyze.prompt.md' };
        const node = compileJobNode(job);
        expect(node.promptFile).toBe('analyze.prompt.md');
        expect(node.prompt).toBeUndefined();
    });

    it('copies skill, output, model, timeoutMs', () => {
        const job: JobConfig = {
            prompt: 'test',
            skill: 'go-deep',
            output: ['summary', 'risks'],
            model: 'gpt-4',
            timeoutMs: 60000,
        };
        const node = compileJobNode(job);
        expect(node.skill).toBe('go-deep');
        expect(node.output).toEqual(['summary', 'risks']);
        expect(node.model).toBe('gpt-4');
        expect(node.timeoutMs).toBe(60000);
    });

    it('produces a root node (no from)', () => {
        const node = compileJobNode({ prompt: 'test' });
        expect(node.from).toBeUndefined();
    });
});

// =============================================================================
// compileReduceNode
// =============================================================================

describe('compileReduceNode', () => {
    it('maps type=list → strategy=list', () => {
        const reduce: ReduceConfig = { type: 'list' };
        const node = compileReduceNode(reduce, 'map');
        expect(node.strategy).toBe('list');
    });

    it('maps type=text → strategy=concat', () => {
        const reduce: ReduceConfig = { type: 'text' };
        const node = compileReduceNode(reduce, 'map');
        expect(node.strategy).toBe('concat');
    });

    it('maps type=ai → strategy=ai, preserves prompt/model/output', () => {
        const reduce: ReduceConfig = {
            type: 'ai',
            prompt: 'Summarize {{RESULTS}}',
            output: ['summary'],
            model: 'gpt-4',
        };
        const node = compileReduceNode(reduce, 'map');
        expect(node.strategy).toBe('ai');
        expect(node.prompt).toBe('Summarize {{RESULTS}}');
        expect(node.output).toEqual(['summary']);
        expect(node.model).toBe('gpt-4');
    });

    it('copies promptFile when used instead of prompt', () => {
        const reduce: ReduceConfig = { type: 'ai', promptFile: 'reduce.prompt.md' };
        const node = compileReduceNode(reduce, 'map');
        expect(node.promptFile).toBe('reduce.prompt.md');
    });

    it('copies skill field', () => {
        const reduce: ReduceConfig = { type: 'ai', prompt: 'test', skill: 'summarizer' };
        const node = compileReduceNode(reduce, 'map');
        expect(node.skill).toBe('summarizer');
    });

    it('sets from to the upstream node id', () => {
        const node = compileReduceNode({ type: 'list' }, 'map');
        expect(node.from).toEqual(['map']);
    });

    it('throws on unknown reduce type', () => {
        expect(() => compileReduceNode({ type: 'unknown' as any }, 'map')).toThrow(CompilerError);
        expect(() => compileReduceNode({ type: 'unknown' as any }, 'map')).toThrow('Unsupported reduce type');
    });
});

// =============================================================================
// compileToWorkflow — full pipeline compilation
// =============================================================================

describe('compileToWorkflow — full pipeline compilation', () => {

    describe('Pattern 1: Map-Reduce (CSV input)', () => {
        it('compiles input→map→reduce into load→map→reduce DAG', () => {
            const yaml = `
name: "Bug Classification"
input:
  from:
    type: csv
    path: bugs.csv
map:
  prompt: "Classify: {{title}}"
  output: [severity, category]
  parallel: 5
  model: gpt-4
reduce:
  type: ai
  prompt: "Summarize {{COUNT}} results: {{RESULTS}}"
  output: [summary]
`;
            const config = compileToWorkflow(yaml);
            expect(config.name).toBe('Bug Classification');
            expect(Object.keys(config.nodes)).toEqual(['load', 'map', 'reduce']);

            const load = config.nodes['load'] as LoadNodeConfig;
            expect(load.source).toEqual({ type: 'csv', path: 'bugs.csv' });

            const map = config.nodes['map'] as MapNodeConfig;
            expect(map.from).toEqual(['load']);
            expect(map.concurrency).toBe(5);

            const reduce = config.nodes['reduce'] as ReduceNodeConfig;
            expect(reduce.from).toEqual(['map']);
            expect(reduce.strategy).toBe('ai');
        });
    });

    describe('Pattern 2: AI Decomposition (generate input)', () => {
        it('compiles generate input into load with ai source', () => {
            const yaml = `
name: "Research"
input:
  generate:
    prompt: "Decompose the topic"
    schema: [focus_area, complexity]
    model: claude-opus-4
    autoApprove: true
map:
  prompt: "Research: {{focus_area}}"
  output: [findings]
reduce:
  type: ai
  prompt: "Synthesize {{RESULTS}}"
`;
            const config = compileToWorkflow(yaml);
            const load = config.nodes['load'] as LoadNodeConfig;
            expect(load.source).toEqual({
                type: 'ai',
                prompt: 'Decompose the topic',
                schema: ['focus_area', 'complexity'],
                model: 'claude-opus-4',
            });
        });
    });

    describe('Pattern 3: Parameters', () => {
        it('merges top-level and input-level parameters into Record', () => {
            const yaml = `
name: "Review"
parameters:
  - name: focus
    value: security
input:
  items:
    - file: a.ts
  parameters:
    - name: threshold
      value: high
map:
  prompt: "Review {{file}} for {{focus}} at {{threshold}}"
  output: [issues]
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            expect(config.parameters).toEqual({ focus: 'security', threshold: 'high' });
        });
    });

    describe('Pattern 4: Single Job', () => {
        it('compiles job: into a single ai node (root)', () => {
            const yaml = `
name: "Analysis"
job:
  prompt: "Analyze the codebase"
  output: [summary, risks]
  model: gpt-4
`;
            const config = compileToWorkflow(yaml);
            expect(Object.keys(config.nodes)).toEqual(['job']);

            const job = config.nodes['job'] as AINodeConfig;
            expect(job.type).toBe('ai');
            expect(job.prompt).toBe('Analyze the codebase');
            expect(job.from).toBeUndefined();
        });
    });

    describe('Pattern: With filter', () => {
        it('compiles input→filter→map→reduce into load→filter→map→reduce', () => {
            const yaml = `
name: "Filtered Pipeline"
input:
  from:
    type: csv
    path: data.csv
filter:
  type: rule
  rule:
    rules:
      - field: status
        operator: equals
        value: open
    mode: all
map:
  prompt: "Process {{title}}"
  output: [result]
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            expect(Object.keys(config.nodes)).toEqual(['load', 'filter', 'map', 'reduce']);

            const filter = config.nodes['filter'] as FilterNodeConfig;
            expect(filter.from).toEqual(['load']);
            expect(filter.rule).toEqual({
                type: 'field', field: 'status', op: 'eq', value: 'open',
            });

            expect((config.nodes['map'] as MapNodeConfig).from).toEqual(['filter']);
        });
    });

    describe('Settings mapping', () => {
        it('maps workingDirectory to settings.workingDirectory', () => {
            const yaml = `
name: test
workingDirectory: /my/dir
job:
  prompt: test
`;
            const config = compileToWorkflow(yaml);
            expect(config.settings?.workingDirectory).toBe('/my/dir');
        });
    });

    describe('Edge cases', () => {
        it('input with inline items and no from → load with inline source', () => {
            const yaml = `
name: test
input:
  items:
    - name: alice
    - name: bob
map:
  prompt: "Hello {{name}}"
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            const load = config.nodes['load'] as LoadNodeConfig;
            expect(load.source).toEqual({
                type: 'inline',
                items: [{ name: 'alice' }, { name: 'bob' }],
            });
        });

        it('reduce type=text → strategy=concat', () => {
            const yaml = `
name: test
input:
  items:
    - x: a
map:
  prompt: "test"
reduce:
  type: text
`;
            const config = compileToWorkflow(yaml);
            const reduce = config.nodes['reduce'] as ReduceNodeConfig;
            expect(reduce.strategy).toBe('concat');
        });

        it('map with promptFile instead of prompt', () => {
            const yaml = `
name: test
input:
  items:
    - x: a
map:
  promptFile: analyze.prompt.md
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            const map = config.nodes['map'] as MapNodeConfig;
            expect(map.promptFile).toBe('analyze.prompt.md');
            expect(map.prompt).toBeUndefined();
        });

        it('filter type=ai compiles to ai rule', () => {
            const yaml = `
name: test
input:
  items:
    - x: a
filter:
  type: ai
  ai:
    prompt: "Is relevant?"
    model: gpt-4
map:
  prompt: "test"
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            const filter = config.nodes['filter'] as FilterNodeConfig;
            expect(filter.rule).toEqual({
                type: 'ai',
                prompt: 'Is relevant?',
                model: 'gpt-4',
            });
        });

        it('filter type=hybrid compiles to compound rule', () => {
            const yaml = `
name: test
input:
  items:
    - x: a
filter:
  type: hybrid
  combineMode: and
  rule:
    rules:
      - field: status
        operator: equals
        value: open
  ai:
    prompt: "Is relevant?"
map:
  prompt: "test"
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            const filter = config.nodes['filter'] as FilterNodeConfig;
            expect(filter.rule).toEqual({
                type: 'and',
                rules: [
                    { type: 'field', field: 'status', op: 'eq', value: 'open' },
                    { type: 'ai', prompt: 'Is relevant?' },
                ],
            });
        });

        it('empty parameters array → no parameters on WorkflowConfig', () => {
            const yaml = `
name: test
parameters: []
job:
  prompt: test
`;
            const config = compileToWorkflow(yaml);
            expect(config.parameters).toBeUndefined();
        });

        it('map with skill → skill on map node', () => {
            const yaml = `
name: test
input:
  items:
    - x: a
map:
  prompt: "test"
  skill: go-deep
reduce:
  type: list
`;
            const config = compileToWorkflow(yaml);
            const map = config.nodes['map'] as MapNodeConfig;
            expect(map.skill).toBe('go-deep');
        });
    });

    describe('Validation', () => {
        it('throws on missing name', () => {
            const yaml = `
map:
  prompt: test
reduce:
  type: list
`;
            expect(() => compileToWorkflow(yaml)).toThrow('missing "name"');
        });

        it('throws when both job and map are present', () => {
            const yaml = `
name: test
job:
  prompt: test
map:
  prompt: test
`;
            expect(() => compileToWorkflow(yaml)).toThrow('Cannot use `job` and `map`');
        });

        it('throws when neither job nor map is present', () => {
            const yaml = `
name: test
input:
  items:
    - x: a
`;
            expect(() => compileToWorkflow(yaml)).toThrow('must have either `job` or `map`');
        });
    });
});

// =============================================================================
// Additional legacy YAML edge cases
// =============================================================================

describe('compileToWorkflow — legacy YAML edge cases', () => {
    it('all reduce types are mapped correctly', () => {
        const types = [
            ['list', 'list'],
            ['table', 'table'],
            ['json', 'json'],
            ['csv', 'csv'],
            ['ai', 'ai'],
            ['text', 'concat'],
        ] as const;

        for (const [pipelineType, strategy] of types) {
            const yaml = `
name: test
input:
  items:
    - x: a
map:
  prompt: test
reduce:
  type: ${pipelineType}
  ${pipelineType === 'ai' ? 'prompt: "summarize"' : ''}
`;
            const config = compileToWorkflow(yaml);
            const reduce = config.nodes['reduce'] as ReduceNodeConfig;
            expect(reduce.strategy).toBe(strategy);
        }
    });

    it('compileToWorkflowFromObject works with pipeline format', () => {
        const parsed = {
            name: 'test',
            job: { prompt: 'Hello' },
        };
        const config = compileToWorkflowFromObject(parsed);
        expect(config.name).toBe('test');
        expect(Object.keys(config.nodes)).toEqual(['job']);
    });

    it('compileToWorkflowFromObject works with workflow format', () => {
        const parsed = {
            name: 'test',
            nodes: {
                ai: { type: 'ai', prompt: 'Hello' },
            },
        };
        const config = compileToWorkflowFromObject(parsed);
        expect(config.name).toBe('test');
        expect(config.nodes['ai']).toBeDefined();
    });

    it('input-level parameters override top-level', () => {
        const yaml = `
name: test
parameters:
  - name: focus
    value: general
input:
  items:
    - x: a
  parameters:
    - name: focus
      value: security
map:
  prompt: "test"
reduce:
  type: list
`;
        const config = compileToWorkflow(yaml);
        expect(config.parameters?.focus).toBe('security');
    });

    it('input-level parameters without top-level', () => {
        const yaml = `
name: test
input:
  items:
    - x: a
  parameters:
    - name: threshold
      value: "5"
map:
  prompt: "test"
reduce:
  type: list
`;
        const config = compileToWorkflow(yaml);
        expect(config.parameters).toEqual({ threshold: '5' });
    });

    it('map with dynamic model template', () => {
        const yaml = `
name: test
input:
  from:
    - model: gpt-4
    - model: claude-sonnet
map:
  prompt: "test"
  model: "{{model}}"
reduce:
  type: list
`;
        const config = compileToWorkflow(yaml);
        const map = config.nodes['map'] as MapNodeConfig;
        expect(map.model).toBe('{{model}}');
    });

    it('no settings omitted from output', () => {
        const yaml = `
name: test
job:
  prompt: test
`;
        const config = compileToWorkflow(yaml);
        expect(config.settings).toBeUndefined();
    });

    it('reduce with promptFile and skill', () => {
        const yaml = `
name: test
input:
  items:
    - x: a
map:
  prompt: "test"
reduce:
  type: ai
  promptFile: summarize.prompt.md
  skill: summarizer
  model: gpt-4
  output: [summary]
`;
        const config = compileToWorkflow(yaml);
        const reduce = config.nodes['reduce'] as ReduceNodeConfig;
        expect(reduce.promptFile).toBe('summarize.prompt.md');
        expect(reduce.skill).toBe('summarizer');
        expect(reduce.model).toBe('gpt-4');
        expect(reduce.output).toEqual(['summary']);
    });

    it('full pipeline with all optional fields', () => {
        const yaml = `
name: "Full Pipeline"
workingDirectory: /workspace
parameters:
  - name: lang
    value: en
input:
  from:
    type: csv
    path: data.csv
    delimiter: ";"
  limit: 100
  parameters:
    - name: mode
      value: strict
filter:
  type: hybrid
  combineMode: or
  rule:
    mode: any
    rules:
      - field: status
        operator: in
        values: [open, pending]
      - field: priority
        operator: gte
        value: 3
  ai:
    prompt: "Is {{title}} relevant?"
    model: gpt-4
    parallel: 3
    timeoutMs: 5000
map:
  promptFile: analyze.prompt.md
  skill: go-deep
  output: [analysis, confidence]
  parallel: 10
  model: gpt-4
  timeoutMs: 60000
  batchSize: 5
reduce:
  type: ai
  promptFile: summarize.prompt.md
  skill: summarizer
  output: [summary]
  model: claude-opus-4
`;
        const config = compileToWorkflow(yaml);

        expect(config.name).toBe('Full Pipeline');
        expect(config.settings?.workingDirectory).toBe('/workspace');
        expect(config.parameters).toEqual({ lang: 'en', mode: 'strict' });
        expect(Object.keys(config.nodes)).toEqual(['load', 'filter', 'map', 'reduce']);

        const load = config.nodes['load'] as LoadNodeConfig;
        expect(load.source).toEqual({ type: 'csv', path: 'data.csv', delimiter: ';' });
        expect(load.limit).toBe(100);

        const filter = config.nodes['filter'] as FilterNodeConfig;
        expect(filter.from).toEqual(['load']);

        const map = config.nodes['map'] as MapNodeConfig;
        expect(map.from).toEqual(['filter']);
        expect(map.concurrency).toBe(10);
        expect(map.batchSize).toBe(5);

        const reduce = config.nodes['reduce'] as ReduceNodeConfig;
        expect(reduce.from).toEqual(['map']);
        expect(reduce.strategy).toBe('ai');
    });
});

// =============================================================================
// isCSVSource type guard
// =============================================================================

describe('isCSVSource type guard', () => {
    it('returns true for a valid CSV source', () => {
        expect(isCSVSource({ type: 'csv', path: 'data.csv' })).toBe(true);
    });

    it('returns true for CSV source with optional delimiter', () => {
        expect(isCSVSource({ type: 'csv', path: 'data.tsv', delimiter: '\t' })).toBe(true);
    });

    it('returns false for a non-csv type value', () => {
        expect(isCSVSource({ type: 'sftp', path: 'data.csv' })).toBe(false);
    });

    it('returns false when path is missing', () => {
        expect(isCSVSource({ type: 'csv' })).toBe(false);
    });

    it('returns false for a generate config', () => {
        expect(isCSVSource({ prompt: 'List 10 items', schema: ['name'] })).toBe(false);
    });

    it('returns false for an array', () => {
        expect(isCSVSource([{ name: 'alice' }])).toBe(false);
    });

    it('returns false for null', () => {
        expect(isCSVSource(null)).toBe(false);
    });

    it('returns false for a primitive', () => {
        expect(isCSVSource('data.csv')).toBe(false);
    });
});

// =============================================================================
// isGenerateConfig type guard
// =============================================================================

describe('isGenerateConfig type guard', () => {
    it('returns true for a valid generate config', () => {
        expect(isGenerateConfig({ prompt: 'List 10 items', schema: ['name', 'value'] })).toBe(true);
    });

    it('returns true for generate config with optional model', () => {
        expect(isGenerateConfig({ prompt: 'List items', schema: ['a'], model: 'gpt-4' })).toBe(true);
    });

    it('returns false for a CSV source', () => {
        expect(isGenerateConfig({ type: 'csv', path: 'data.csv' })).toBe(false);
    });

    it('returns false when schema is missing', () => {
        expect(isGenerateConfig({ prompt: 'Generate items' })).toBe(false);
    });

    it('returns false when prompt is missing', () => {
        expect(isGenerateConfig({ schema: ['a', 'b'] })).toBe(false);
    });

    it('returns false when prompt is not a string', () => {
        expect(isGenerateConfig({ prompt: 42, schema: ['a'] })).toBe(false);
    });

    it('returns false when schema is not an array', () => {
        expect(isGenerateConfig({ prompt: 'test', schema: 'not-array' })).toBe(false);
    });

    it('returns false for null', () => {
        expect(isGenerateConfig(null)).toBe(false);
    });

    it('returns false for a primitive', () => {
        expect(isGenerateConfig('generate items')).toBe(false);
    });
});

// =============================================================================
// Barrel exports
// =============================================================================

describe('barrel exports', () => {
    it('compileToWorkflow is importable from workflow index', async () => {
        const mod = await import('../../src/workflow/index');
        expect(typeof mod.compileToWorkflow).toBe('function');
    });

    it('compileToWorkflowFromObject is importable from workflow index', async () => {
        const mod = await import('../../src/workflow/index');
        expect(typeof mod.compileToWorkflowFromObject).toBe('function');
    });

    it('detectFormat is importable from workflow index', async () => {
        const mod = await import('../../src/workflow/index');
        expect(typeof mod.detectFormat).toBe('function');
    });

    it('CompilerError is importable from workflow index', async () => {
        const mod = await import('../../src/workflow/index');
        expect(mod.CompilerError).toBeDefined();
    });

    it('compileToWorkflow is importable from pipeline-core index', async () => {
        const mod = await import('../../src/index');
        expect(typeof mod.compileToWorkflow).toBe('function');
    });

    it('detectFormat is importable from pipeline-core index', async () => {
        const mod = await import('../../src/index');
        expect(typeof mod.detectFormat).toBe('function');
    });

    it('CompilerError is importable from pipeline-core index', async () => {
        const mod = await import('../../src/index');
        expect(mod.CompilerError).toBeDefined();
    });
});
