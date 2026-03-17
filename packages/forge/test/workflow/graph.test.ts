/**
 * Graph module — Unit Tests
 *
 * Tests for buildGraph() and detectCycle().
 */

import { describe, it, expect } from 'vitest';
import { buildGraph, detectCycle } from '../../src/workflow/graph';
import type { NodeConfig } from '../../src/workflow/types';

// =============================================================================
// Helper: minimal node configs for graph construction
// =============================================================================

function load(from?: string[]): NodeConfig {
    return { type: 'load', source: { type: 'inline', items: [] }, from } as NodeConfig;
}

function map(from?: string[]): NodeConfig {
    return { type: 'map', prompt: 'p', from } as NodeConfig;
}

function reduce(from?: string[]): NodeConfig {
    return { type: 'reduce', strategy: 'json', from } as NodeConfig;
}

function merge(from?: string[]): NodeConfig {
    return { type: 'merge', from } as NodeConfig;
}

// =============================================================================
// buildGraph tests
// =============================================================================

describe('buildGraph', () => {
    it('builds correct graph for linear DAG (A → B → C)', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: map(['A']),
            C: reduce(['B']),
        };

        const graph = buildGraph(nodes);

        expect([...graph.edges.get('A')!]).toEqual(['B']);
        expect([...graph.edges.get('B')!]).toEqual(['C']);
        expect([...graph.edges.get('C')!]).toEqual([]);

        expect([...graph.reverseEdges.get('A')!]).toEqual([]);
        expect([...graph.reverseEdges.get('B')!]).toEqual(['A']);
        expect([...graph.reverseEdges.get('C')!]).toEqual(['B']);

        expect(graph.inDegree.get('A')).toBe(0);
        expect(graph.inDegree.get('B')).toBe(1);
        expect(graph.inDegree.get('C')).toBe(1);

        expect(graph.roots).toEqual(['A']);
        expect(graph.leaves).toEqual(['C']);
    });

    it('builds correct graph for fan-out DAG (A → B, A → C)', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: map(['A']),
            C: map(['A']),
        };

        const graph = buildGraph(nodes);

        expect(graph.edges.get('A')).toContain('B');
        expect(graph.edges.get('A')).toContain('C');
        expect(graph.edges.get('A')!.length).toBe(2);

        expect(graph.inDegree.get('A')).toBe(0);
        expect(graph.inDegree.get('B')).toBe(1);
        expect(graph.inDegree.get('C')).toBe(1);

        expect(graph.roots).toEqual(['A']);
        expect(graph.leaves).toContain('B');
        expect(graph.leaves).toContain('C');
    });

    it('builds correct graph for fan-in DAG (A → C, B → C)', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: load(),
            C: merge(['A', 'B']),
        };

        const graph = buildGraph(nodes);

        expect([...graph.edges.get('A')!]).toEqual(['C']);
        expect([...graph.edges.get('B')!]).toEqual(['C']);
        expect(graph.reverseEdges.get('C')).toContain('A');
        expect(graph.reverseEdges.get('C')).toContain('B');
        expect(graph.inDegree.get('C')).toBe(2);

        expect(graph.roots).toContain('A');
        expect(graph.roots).toContain('B');
        expect(graph.leaves).toEqual(['C']);
    });

    it('handles single-node graph', () => {
        const nodes: Record<string, NodeConfig> = {
            only: load(),
        };

        const graph = buildGraph(nodes);

        expect(graph.edges.get('only')).toEqual([]);
        expect(graph.reverseEdges.get('only')).toEqual([]);
        expect(graph.inDegree.get('only')).toBe(0);
        expect(graph.roots).toEqual(['only']);
        expect(graph.leaves).toEqual(['only']);
    });

    it('handles disconnected components', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: load(),
        };

        const graph = buildGraph(nodes);

        expect(graph.roots).toContain('A');
        expect(graph.roots).toContain('B');
        expect(graph.leaves).toContain('A');
        expect(graph.leaves).toContain('B');
    });

    it('tolerates unknown from references by initialising them in maps', () => {
        const nodes: Record<string, NodeConfig> = {
            A: map(['UNKNOWN']),
        };

        const graph = buildGraph(nodes);

        // UNKNOWN gets initialised as a phantom node
        expect(graph.edges.has('UNKNOWN')).toBe(true);
        expect(graph.edges.get('UNKNOWN')).toContain('A');
        expect(graph.inDegree.get('A')).toBe(1);
    });
});

// =============================================================================
// detectCycle tests
// =============================================================================

describe('detectCycle', () => {
    it('returns null for an acyclic linear graph', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: map(['A']),
            C: reduce(['B']),
        };

        const graph = buildGraph(nodes);
        expect(detectCycle(graph)).toBeNull();
    });

    it('returns null for a fan-out acyclic graph', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: map(['A']),
            C: map(['A']),
        };

        const graph = buildGraph(nodes);
        expect(detectCycle(graph)).toBeNull();
    });

    it('returns null for a diamond acyclic graph', () => {
        const nodes: Record<string, NodeConfig> = {
            A: load(),
            B: map(['A']),
            C: map(['A']),
            D: merge(['B', 'C']),
        };

        const graph = buildGraph(nodes);
        expect(detectCycle(graph)).toBeNull();
    });

    it('detects cycle A → B → C → A', () => {
        const nodes: Record<string, NodeConfig> = {
            A: map(['C']),
            B: map(['A']),
            C: map(['B']),
        };

        const graph = buildGraph(nodes);
        const cycle = detectCycle(graph);

        expect(cycle).not.toBeNull();
        // Cycle path starts and ends with the same node
        expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
        // All nodes in the cycle are present
        expect(cycle).toContain('A');
        expect(cycle).toContain('B');
        expect(cycle).toContain('C');
    });

    it('detects self-loop A → A', () => {
        const nodes: Record<string, NodeConfig> = {
            A: map(['A']),
        };

        const graph = buildGraph(nodes);
        const cycle = detectCycle(graph);

        expect(cycle).not.toBeNull();
        expect(cycle).toEqual(['A', 'A']);
    });

    it('detects cycle in graph with disconnected components', () => {
        const nodes: Record<string, NodeConfig> = {
            // Acyclic component
            X: load(),
            Y: map(['X']),
            // Cyclic component
            A: map(['B']),
            B: map(['A']),
        };

        const graph = buildGraph(nodes);
        const cycle = detectCycle(graph);

        expect(cycle).not.toBeNull();
        expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    });
});
