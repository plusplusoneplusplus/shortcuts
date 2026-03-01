import { describe, it, expect } from 'vitest';
import { buildPreviewDAG } from '../../../src/server/spa/client/react/repos/buildPreviewDAG';

describe('buildPreviewDAG', () => {
    describe('returns null for invalid input', () => {
        it('returns null for empty string', () => {
            expect(buildPreviewDAG('')).toBeNull();
        });

        it('returns null for invalid YAML', () => {
            expect(buildPreviewDAG('{{{')).toBeNull();
        });

        it('returns null for scalar YAML', () => {
            expect(buildPreviewDAG('hello')).toBeNull();
        });
    });

    describe('simple job pipeline', () => {
        it('produces a single job node', () => {
            const yaml = `
name: git-fetch
job:
  prompt: "Run git fetch"
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('linear');
            if (result!.type === 'linear') {
                expect(result!.data.nodes).toHaveLength(1);
                expect(result!.data.nodes[0].phase).toBe('job');
                expect(result!.data.nodes[0].state).toBe('waiting');
            }
        });

        it('detects top-level prompt as job', () => {
            const yaml = `
name: simple
prompt: "Do something"
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('linear');
            if (result!.type === 'linear') {
                expect(result!.data.nodes[0].phase).toBe('job');
            }
        });
    });

    describe('map-reduce pipeline', () => {
        it('produces input → map → reduce flow', () => {
            const yaml = `
name: analyze
input:
  source: data.csv
map:
  prompt: "Analyze {{item}}"
reduce:
  type: table
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('linear');
            if (result!.type === 'linear') {
                const phases = result!.data.nodes.map(n => n.phase);
                expect(phases).toEqual(['input', 'map', 'reduce']);
            }
        });

        it('includes filter when present', () => {
            const yaml = `
name: filtered
input:
  source: data.csv
filter:
  type: rule
  rules:
    - field: status
      operator: equals
      value: active
map:
  prompt: "Process {{item}}"
reduce:
  type: list
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('linear');
            if (result!.type === 'linear') {
                const phases = result!.data.nodes.map(n => n.phase);
                expect(phases).toEqual(['input', 'filter', 'map', 'reduce']);
            }
        });

        it('all nodes have waiting state', () => {
            const yaml = `
name: test
input:
  source: data.csv
map:
  prompt: "Test"
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            if (result!.type === 'linear') {
                for (const node of result!.data.nodes) {
                    expect(node.state).toBe('waiting');
                }
            }
        });
    });

    describe('workflow DAG', () => {
        it('detects workflow with nodes record', () => {
            const yaml = `
name: my-workflow
nodes:
  load-data:
    type: load
    source: data.csv
  process:
    type: map
    from: [load-data]
    prompt: "Process {{item}}"
  summarize:
    type: reduce
    from: [process]
    reduceType: ai
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            expect(result!.type).toBe('workflow');
        });

        it('produces correct nodes and edges', () => {
            const yaml = `
name: dag-pipeline
nodes:
  load:
    type: load
    source: data.csv
  transform:
    type: map
    from: [load]
    prompt: "Transform"
  output:
    type: reduce
    from: [transform]
`;
            const result = buildPreviewDAG(yaml);
            expect(result).not.toBeNull();
            if (result!.type === 'workflow') {
                expect(result!.data.nodes).toHaveLength(3);
                expect(result!.data.edges).toHaveLength(2);
                expect(result!.data.edges).toContainEqual({ from: 'load', to: 'transform' });
                expect(result!.data.edges).toContainEqual({ from: 'transform', to: 'output' });
            }
        });

        it('computes layers correctly for linear DAG', () => {
            const yaml = `
name: linear-dag
nodes:
  a:
    type: load
  b:
    type: map
    from: [a]
  c:
    type: reduce
    from: [b]
`;
            const result = buildPreviewDAG(yaml);
            if (result!.type === 'workflow') {
                expect(result!.data.layers.get('a')).toBe(0);
                expect(result!.data.layers.get('b')).toBe(1);
                expect(result!.data.layers.get('c')).toBe(2);
                expect(result!.data.maxLayer).toBe(2);
            }
        });

        it('computes layers for fan-out DAG', () => {
            const yaml = `
name: fan-out
nodes:
  source:
    type: load
  branch-a:
    type: map
    from: [source]
  branch-b:
    type: map
    from: [source]
  merge:
    type: merge
    from: [branch-a, branch-b]
`;
            const result = buildPreviewDAG(yaml);
            if (result!.type === 'workflow') {
                expect(result!.data.layers.get('source')).toBe(0);
                expect(result!.data.layers.get('branch-a')).toBe(1);
                expect(result!.data.layers.get('branch-b')).toBe(1);
                expect(result!.data.layers.get('merge')).toBe(2);
                expect(result!.data.edges).toHaveLength(4);
            }
        });

        it('uses node label when available', () => {
            const yaml = `
name: labeled
nodes:
  my-node:
    type: load
    label: "Load CSV Data"
`;
            const result = buildPreviewDAG(yaml);
            if (result!.type === 'workflow') {
                expect(result!.data.nodes[0].label).toBe('Load CSV Data');
            }
        });

        it('falls back to node id as label', () => {
            const yaml = `
name: no-label
nodes:
  my-node:
    type: load
`;
            const result = buildPreviewDAG(yaml);
            if (result!.type === 'workflow') {
                expect(result!.data.nodes[0].label).toBe('my-node');
            }
        });

        it('ignores edges to unknown nodes', () => {
            const yaml = `
name: dangling
nodes:
  a:
    type: load
  b:
    type: map
    from: [a, nonexistent]
`;
            const result = buildPreviewDAG(yaml);
            if (result!.type === 'workflow') {
                expect(result!.data.edges).toHaveLength(1);
                expect(result!.data.edges[0]).toEqual({ from: 'a', to: 'b' });
            }
        });
    });
});
