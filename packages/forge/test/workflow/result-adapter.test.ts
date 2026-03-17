/**
 * Tests for WorkflowResult → Flat Display Adapter
 */
import { describe, it, expect } from 'vitest';
import { flattenWorkflowResult } from '../../src/workflow/result-adapter';
import type { WorkflowResult, WorkflowConfig, NodeResult, Items } from '../../src/workflow/types';

function makeNodeResult(id: string, items: Items, success = true, durationMs = 100): NodeResult {
    return {
        nodeId: id,
        success,
        items,
        stats: { durationMs, inputCount: items.length, outputCount: items.length },
    };
}

function makeWorkflowResult(nodes: NodeResult[], leafIds: string[], totalDurationMs = 200): WorkflowResult {
    const results = new Map<string, NodeResult>();
    const leaves = new Map<string, NodeResult>();
    for (const nr of nodes) {
        results.set(nr.nodeId, nr);
        if (leafIds.includes(nr.nodeId)) {
            leaves.set(nr.nodeId, nr);
        }
    }
    return { success: true, results, leaves, tiers: [], totalDurationMs };
}

describe('flattenWorkflowResult', () => {
    it('extracts map node items and leaf output', () => {
        const mapItems: Items = [
            { name: 'Alice', result: 'OK' },
            { name: 'Bob', result: 'OK' },
        ];
        const reduceItems: Items = [{ summary: 'All good' }];

        const config: WorkflowConfig = {
            nodes: {
                load: { type: 'load', source: { type: 'inline', items: [] } } as any,
                map: { type: 'map', prompt: 'test', dependsOn: ['load'] } as any,
                reduce: { type: 'reduce', strategy: { type: 'ai', prompt: 'sum' }, dependsOn: ['map'] } as any,
            },
        };

        const result = makeWorkflowResult(
            [
                makeNodeResult('load', [{ name: 'Alice' }, { name: 'Bob' }]),
                makeNodeResult('map', mapItems),
                makeNodeResult('reduce', reduceItems),
            ],
            ['reduce'],
            500,
        );

        const flat = flattenWorkflowResult(result, config);

        expect(flat.success).toBe(true);
        expect(flat.stats.totalItems).toBe(2);
        expect(flat.stats.successfulMaps).toBe(2);
        expect(flat.stats.failedMaps).toBe(0);
        expect(flat.stats.totalDurationMs).toBe(500);
        expect(flat.items).toHaveLength(2);
        expect(flat.leafOutput).toHaveLength(1);
        expect(flat.leafOutput[0]).toEqual({ summary: 'All good' });
    });

    it('counts failed items via __error field', () => {
        const mapItems: Items = [
            { name: 'Alice', result: 'OK' },
            { name: 'Bob', __error: 'timeout' },
        ];

        const config: WorkflowConfig = {
            nodes: {
                load: { type: 'load', source: { type: 'inline', items: [] } } as any,
                map: { type: 'map', prompt: 'test', dependsOn: ['load'] } as any,
            },
        };

        const result = makeWorkflowResult(
            [
                makeNodeResult('load', [{ name: 'Alice' }, { name: 'Bob' }]),
                makeNodeResult('map', mapItems),
            ],
            ['map'],
            300,
        );

        const flat = flattenWorkflowResult(result, config);

        expect(flat.stats.successfulMaps).toBe(1);
        expect(flat.stats.failedMaps).toBe(1);
        expect(flat.items[1].success).toBe(false);
        expect(flat.items[1].error).toBe('timeout');
    });

    it('works without config (fallback heuristic)', () => {
        const result = makeWorkflowResult(
            [
                makeNodeResult('load', [{ a: '1' }]),
                makeNodeResult('process', [{ a: '1', b: '2' }, { a: '3', b: '4' }]),
                makeNodeResult('output', [{ summary: 'done' }]),
            ],
            ['output'],
            100,
        );

        const flat = flattenWorkflowResult(result);

        // 'process' has 2 items and is non-leaf, so it should be picked as map
        expect(flat.items).toHaveLength(2);
        expect(flat.leafOutput).toHaveLength(1);
    });

    it('handles single-job (ai node) as map', () => {
        const config: WorkflowConfig = {
            nodes: {
                job: { type: 'ai', prompt: 'analyze', dependsOn: [] } as any,
            },
        };

        const result = makeWorkflowResult(
            [makeNodeResult('job', [{ answer: 'result' }])],
            ['job'],
            50,
        );

        const flat = flattenWorkflowResult(result, config);

        expect(flat.items).toHaveLength(1);
        expect(flat.stats.successfulMaps).toBe(1);
    });

    it('handles empty workflow result', () => {
        const result: WorkflowResult = {
            success: true,
            results: new Map(),
            leaves: new Map(),
            tiers: [],
            totalDurationMs: 0,
        };

        const flat = flattenWorkflowResult(result);

        expect(flat.success).toBe(true);
        expect(flat.items).toHaveLength(0);
        expect(flat.leafOutput).toHaveLength(0);
        expect(flat.stats.totalItems).toBe(0);
    });

    it('propagates error from failed workflow', () => {
        const result: WorkflowResult = {
            success: false,
            results: new Map(),
            leaves: new Map(),
            tiers: [],
            totalDurationMs: 100,
            error: 'Node "map" failed',
        };

        const flat = flattenWorkflowResult(result);

        expect(flat.success).toBe(false);
        expect(flat.error).toBe('Node "map" failed');
    });
});
