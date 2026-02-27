/**
 * Scheduler module — Unit Tests
 *
 * Tests for schedule(), getExecutionOrder(), and getTierIndex().
 */

import { describe, it, expect } from 'vitest';
import { schedule, getExecutionOrder, getTierIndex } from '../../src/workflow/scheduler';
import { buildGraph } from '../../src/workflow/graph';
import type { NodeConfig } from '../../src/workflow/types';

// =============================================================================
// Helper: minimal node configs for graph construction
// =============================================================================

function node(from?: string[]): NodeConfig {
    return { type: 'load', source: { type: 'inline', items: [] }, from } as NodeConfig;
}

// =============================================================================
// schedule() tests
// =============================================================================

describe('schedule', () => {
    it('produces one node per tier for a linear chain', () => {
        const graph = buildGraph({ A: node(), B: node(['A']), C: node(['B']) });
        expect(schedule(graph)).toEqual([['A'], ['B'], ['C']]);
    });

    it('groups independent children into the same tier (fan-out)', () => {
        const graph = buildGraph({ A: node(), B: node(['A']), C: node(['A']) });
        expect(schedule(graph)).toEqual([['A'], ['B', 'C']]);
    });

    it('waits for all parents before a fan-in node (fan-in)', () => {
        const graph = buildGraph({ A: node(), B: node(), C: node(['A', 'B']) });
        expect(schedule(graph)).toEqual([['A', 'B'], ['C']]);
    });

    it('handles a diamond pattern correctly', () => {
        const graph = buildGraph({
            A: node(),
            B: node(['A']),
            C: node(['A']),
            D: node(['B', 'C']),
        });
        expect(schedule(graph)).toEqual([['A'], ['B', 'C'], ['D']]);
    });

    it('returns a single tier with one node for a graph with one node', () => {
        const graph = buildGraph({ A: node() });
        expect(schedule(graph)).toEqual([['A']]);
    });

    it('produces 6 correct tiers for the complex pipeline DAG', () => {
        const graph = buildGraph({
            raw: node(),
            enriched: node(['raw']),
            bugs: node(['enriched']),
            features: node(['enriched']),
            'bug-analysis': node(['bugs']),
            'feature-estimation': node(['features']),
            merged: node(['bug-analysis', 'feature-estimation']),
            report: node(['merged']),
        });
        expect(schedule(graph)).toEqual([
            ['raw'],
            ['enriched'],
            ['bugs', 'features'],
            ['bug-analysis', 'feature-estimation'],
            ['merged'],
            ['report'],
        ]);
    });

    it('sorts nodes alphabetically within each tier', () => {
        const graph = buildGraph({
            root: node(),
            zebra: node(['root']),
            apple: node(['root']),
        });
        expect(schedule(graph)).toEqual([['root'], ['apple', 'zebra']]);
    });

    it('does not mutate the original graph inDegree map', () => {
        const graph = buildGraph({ A: node(), B: node(['A']) });
        const originalDegrees = new Map(graph.inDegree);
        schedule(graph);
        expect(graph.inDegree).toEqual(originalDegrees);
    });

    it('handles multiple roots correctly', () => {
        const graph = buildGraph({
            X: node(),
            Y: node(),
            Z: node(['X', 'Y']),
        });
        expect(schedule(graph)).toEqual([['X', 'Y'], ['Z']]);
    });

    it('handles disconnected components', () => {
        const graph = buildGraph({
            A: node(),
            B: node(['A']),
            C: node(),
            D: node(['C']),
        });
        expect(schedule(graph)).toEqual([['A', 'C'], ['B', 'D']]);
    });
});

// =============================================================================
// getExecutionOrder() tests
// =============================================================================

describe('getExecutionOrder', () => {
    it('flattens tiers into a single ordered array', () => {
        const tiers = [['A'], ['B', 'C'], ['D']];
        expect(getExecutionOrder(tiers)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('returns empty array for empty tiers', () => {
        expect(getExecutionOrder([])).toEqual([]);
    });
});

// =============================================================================
// getTierIndex() tests
// =============================================================================

describe('getTierIndex', () => {
    it('returns the correct 0-based tier index for a node', () => {
        const tiers = [['raw'], ['enriched'], ['bugs', 'features']];
        expect(getTierIndex('raw', tiers)).toBe(0);
        expect(getTierIndex('enriched', tiers)).toBe(1);
        expect(getTierIndex('bugs', tiers)).toBe(2);
        expect(getTierIndex('features', tiers)).toBe(2);
    });

    it('returns -1 for a node not present in any tier', () => {
        const tiers = [['A'], ['B']];
        expect(getTierIndex('unknown', tiers)).toBe(-1);
    });
});
