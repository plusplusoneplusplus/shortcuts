/**
 * Tests for the consolidation orchestrator.
 */

import { describe, it, expect, vi } from 'vitest';
import { consolidateComponents } from '../../src/consolidation/consolidator';
import type { ComponentInfo, ComponentGraph } from '../../src/types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

function makeComponent(overrides: Partial<ComponentInfo> & { id: string; path: string }): ComponentInfo {
    return {
        name: overrides.id.replace(/-/g, ' '),
        purpose: `Purpose of ${overrides.id}`,
        keyFiles: [overrides.path],
        dependencies: [],
        dependents: [],
        complexity: 'medium',
        category: 'default',
        ...overrides,
    };
}

function makeGraph(components: ComponentInfo[]): ComponentGraph {
    return {
        project: {
            name: 'test-project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: components,
        categories: [{ name: 'default', description: 'Default category' }],
        architectureNotes: 'Test architecture',
    };
}

function createMockAIInvoker(response: string): AIInvoker {
    return vi.fn().mockResolvedValue({
        success: true,
        response,
        error: undefined,
    });
}

function createFailingAIInvoker(): AIInvoker {
    return vi.fn().mockResolvedValue({
        success: false,
        response: '',
        error: 'AI unavailable',
    });
}

// ============================================================================
// consolidateComponents
// ============================================================================

describe('consolidateComponents', () => {
    it('returns correct stats', async () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts' }),
            makeComponent({ id: 'b', path: 'src/x/b.ts' }),
            makeComponent({ id: 'c', path: 'src/y/' }),
        ];
        const graph = makeGraph(components);

        const result = await consolidateComponents(graph, null, { skipAI: true });

        expect(result.originalCount).toBe(3);
        expect(result.afterRuleBasedCount).toBe(2);
        expect(result.finalCount).toBe(2);
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('applies rule-based consolidation first', async () => {
        const components: ComponentInfo[] = [];
        for (let dir = 0; dir < 5; dir++) {
            for (let file = 0; file < 4; file++) {
                components.push(makeComponent({
                    id: `mod-d${dir}-f${file}`,
                    path: `src/dir${dir}/file${file}.ts`,
                }));
            }
        }
        const graph = makeGraph(components);

        const result = await consolidateComponents(graph, null, { skipAI: true });

        expect(result.originalCount).toBe(20);
        expect(result.afterRuleBasedCount).toBe(5);
        expect(result.finalCount).toBe(5);
    });

    it('skips AI when skipAI is true', async () => {
        const mockInvoker = createMockAIInvoker('{}');
        const components = Array.from({ length: 100 }, (_, i) =>
            makeComponent({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(components);

        await consolidateComponents(graph, mockInvoker, { skipAI: true });

        expect(mockInvoker).not.toHaveBeenCalled();
    });

    it('skips AI when aiInvoker is null', async () => {
        const components = Array.from({ length: 100 }, (_, i) =>
            makeComponent({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(components);

        const result = await consolidateComponents(graph, null);

        // Rule-based only — each component is in its own directory, so no merging
        expect(result.finalCount).toBe(100);
    });

    it('calls AI when count exceeds target', async () => {
        const clusterResponse = JSON.stringify({
            clusters: [
                { id: 'group-a', name: 'Group A', memberIds: ['mod-0', 'mod-1', 'mod-2'], purpose: 'A' },
                { id: 'group-b', name: 'Group B', memberIds: ['mod-3', 'mod-4'], purpose: 'B' },
            ],
        });
        const mockInvoker = createMockAIInvoker(clusterResponse);

        const components = Array.from({ length: 5 }, (_, i) =>
            makeComponent({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(components);

        const result = await consolidateComponents(graph, mockInvoker, { targetComponentCount: 3 });

        expect(mockInvoker).toHaveBeenCalled();
        expect(result.finalCount).toBe(2);
    });

    it('skips AI when count is already at target', async () => {
        const mockInvoker = createMockAIInvoker('{}');

        const components = [
            makeComponent({ id: 'a', path: 'src/a/' }),
            makeComponent({ id: 'b', path: 'src/b/' }),
        ];
        const graph = makeGraph(components);

        await consolidateComponents(graph, mockInvoker, { targetComponentCount: 5 });

        expect(mockInvoker).not.toHaveBeenCalled();
    });

    it('falls back to rule-based result when AI fails', async () => {
        const failingInvoker = createFailingAIInvoker();

        const components = Array.from({ length: 100 }, (_, i) =>
            makeComponent({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(components);

        const result = await consolidateComponents(graph, failingInvoker, { targetComponentCount: 10 });

        // Should still return a valid result (rule-based only)
        expect(result.finalCount).toBe(result.afterRuleBasedCount);
    });

    it('falls back gracefully when AI throws', async () => {
        const throwingInvoker: AIInvoker = vi.fn().mockRejectedValue(new Error('Network error'));

        const components = Array.from({ length: 100 }, (_, i) =>
            makeComponent({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(components);

        const result = await consolidateComponents(graph, throwingInvoker, { targetComponentCount: 10 });

        expect(result.finalCount).toBe(result.afterRuleBasedCount);
    });

    it('handles empty component graph', async () => {
        const graph = makeGraph([]);
        const result = await consolidateComponents(graph, null);

        expect(result.originalCount).toBe(0);
        expect(result.finalCount).toBe(0);
    });

    it('full pipeline: rule-based + AI clustering', async () => {
        // 20 modules in 4 directories (5 each) → rule-based reduces to 4
        // AI then clusters 4 into 2
        const components: ComponentInfo[] = [];
        for (let dir = 0; dir < 4; dir++) {
            for (let file = 0; file < 5; file++) {
                components.push(makeComponent({
                    id: `mod-d${dir}-f${file}`,
                    path: `src/dir${dir}/file${file}.ts`,
                }));
            }
        }
        const graph = makeGraph(components);

        // After rule-based: src-dir0, src-dir1, src-dir2, src-dir3
        // AI clusters: group-a (dir0, dir1), group-b (dir2, dir3)
        const clusterResponse = JSON.stringify({
            clusters: [
                { id: 'group-a', name: 'Group A', memberIds: ['src-dir0', 'src-dir1'], purpose: 'A' },
                { id: 'group-b', name: 'Group B', memberIds: ['src-dir2', 'src-dir3'], purpose: 'B' },
            ],
        });
        const mockInvoker = createMockAIInvoker(clusterResponse);

        const result = await consolidateComponents(graph, mockInvoker, { targetComponentCount: 2 });

        expect(result.originalCount).toBe(20);
        expect(result.afterRuleBasedCount).toBe(4);
        expect(result.finalCount).toBe(2);
    });
});
