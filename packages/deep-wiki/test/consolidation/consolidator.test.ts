/**
 * Tests for the consolidation orchestrator.
 */

import { describe, it, expect, vi } from 'vitest';
import { consolidateModules } from '../../src/consolidation/consolidator';
import type { ModuleInfo, ModuleGraph } from '../../src/types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

function makeModule(overrides: Partial<ModuleInfo> & { id: string; path: string }): ModuleInfo {
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

function makeGraph(modules: ModuleInfo[]): ModuleGraph {
    return {
        project: {
            name: 'test-project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules,
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
// consolidateModules
// ============================================================================

describe('consolidateModules', () => {
    it('returns correct stats', async () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts' }),
            makeModule({ id: 'b', path: 'src/x/b.ts' }),
            makeModule({ id: 'c', path: 'src/y/' }),
        ];
        const graph = makeGraph(modules);

        const result = await consolidateModules(graph, null, { skipAI: true });

        expect(result.originalCount).toBe(3);
        expect(result.afterRuleBasedCount).toBe(2);
        expect(result.finalCount).toBe(2);
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('applies rule-based consolidation first', async () => {
        const modules: ModuleInfo[] = [];
        for (let dir = 0; dir < 5; dir++) {
            for (let file = 0; file < 4; file++) {
                modules.push(makeModule({
                    id: `mod-d${dir}-f${file}`,
                    path: `src/dir${dir}/file${file}.ts`,
                }));
            }
        }
        const graph = makeGraph(modules);

        const result = await consolidateModules(graph, null, { skipAI: true });

        expect(result.originalCount).toBe(20);
        expect(result.afterRuleBasedCount).toBe(5);
        expect(result.finalCount).toBe(5);
    });

    it('skips AI when skipAI is true', async () => {
        const mockInvoker = createMockAIInvoker('{}');
        const modules = Array.from({ length: 100 }, (_, i) =>
            makeModule({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(modules);

        await consolidateModules(graph, mockInvoker, { skipAI: true });

        expect(mockInvoker).not.toHaveBeenCalled();
    });

    it('skips AI when aiInvoker is null', async () => {
        const modules = Array.from({ length: 100 }, (_, i) =>
            makeModule({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(modules);

        const result = await consolidateModules(graph, null);

        // Rule-based only — each module is in its own directory, so no merging
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

        const modules = Array.from({ length: 5 }, (_, i) =>
            makeModule({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(modules);

        const result = await consolidateModules(graph, mockInvoker, { targetModuleCount: 3 });

        expect(mockInvoker).toHaveBeenCalled();
        expect(result.finalCount).toBe(2);
    });

    it('skips AI when count is already at target', async () => {
        const mockInvoker = createMockAIInvoker('{}');

        const modules = [
            makeModule({ id: 'a', path: 'src/a/' }),
            makeModule({ id: 'b', path: 'src/b/' }),
        ];
        const graph = makeGraph(modules);

        await consolidateModules(graph, mockInvoker, { targetModuleCount: 5 });

        expect(mockInvoker).not.toHaveBeenCalled();
    });

    it('falls back to rule-based result when AI fails', async () => {
        const failingInvoker = createFailingAIInvoker();

        const modules = Array.from({ length: 100 }, (_, i) =>
            makeModule({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(modules);

        const result = await consolidateModules(graph, failingInvoker, { targetModuleCount: 10 });

        // Should still return a valid result (rule-based only)
        expect(result.finalCount).toBe(result.afterRuleBasedCount);
    });

    it('falls back gracefully when AI throws', async () => {
        const throwingInvoker: AIInvoker = vi.fn().mockRejectedValue(new Error('Network error'));

        const modules = Array.from({ length: 100 }, (_, i) =>
            makeModule({ id: `mod-${i}`, path: `src/mod-${i}/` })
        );
        const graph = makeGraph(modules);

        const result = await consolidateModules(graph, throwingInvoker, { targetModuleCount: 10 });

        expect(result.finalCount).toBe(result.afterRuleBasedCount);
    });

    it('handles empty module graph', async () => {
        const graph = makeGraph([]);
        const result = await consolidateModules(graph, null);

        expect(result.originalCount).toBe(0);
        expect(result.finalCount).toBe(0);
    });

    it('full pipeline: rule-based + AI clustering', async () => {
        // 20 modules in 4 directories (5 each) → rule-based reduces to 4
        // AI then clusters 4 into 2
        const modules: ModuleInfo[] = [];
        for (let dir = 0; dir < 4; dir++) {
            for (let file = 0; file < 5; file++) {
                modules.push(makeModule({
                    id: `mod-d${dir}-f${file}`,
                    path: `src/dir${dir}/file${file}.ts`,
                }));
            }
        }
        const graph = makeGraph(modules);

        // After rule-based: src-dir0, src-dir1, src-dir2, src-dir3
        // AI clusters: group-a (dir0, dir1), group-b (dir2, dir3)
        const clusterResponse = JSON.stringify({
            clusters: [
                { id: 'group-a', name: 'Group A', memberIds: ['src-dir0', 'src-dir1'], purpose: 'A' },
                { id: 'group-b', name: 'Group B', memberIds: ['src-dir2', 'src-dir3'], purpose: 'B' },
            ],
        });
        const mockInvoker = createMockAIInvoker(clusterResponse);

        const result = await consolidateModules(graph, mockInvoker, { targetModuleCount: 2 });

        expect(result.originalCount).toBe(20);
        expect(result.afterRuleBasedCount).toBe(4);
        expect(result.finalCount).toBe(2);
    });
});
