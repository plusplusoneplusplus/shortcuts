/**
 * Tests for AI-assisted module consolidation.
 */

import { describe, it, expect } from 'vitest';
import { buildClusteringPrompt, parseClusterResponse, applyClusterMerge } from '../../src/consolidation/ai-consolidator';
import type { ModuleInfo, ModuleGraph, ClusterGroup } from '../../src/types';

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

// ============================================================================
// buildClusteringPrompt
// ============================================================================

describe('buildClusteringPrompt', () => {
    it('includes project name and module count', () => {
        const modules = [
            makeModule({ id: 'auth', path: 'src/auth/' }),
            makeModule({ id: 'db', path: 'src/db/' }),
        ];
        const prompt = buildClusteringPrompt(modules, 'MyProject', 30);

        expect(prompt).toContain('MyProject');
        expect(prompt).toContain('2 modules');
        expect(prompt).toContain('30');
    });

    it('includes module IDs and paths', () => {
        const modules = [
            makeModule({ id: 'auth-service', path: 'src/auth/' }),
        ];
        const prompt = buildClusteringPrompt(modules, 'Test', 10);

        expect(prompt).toContain('auth-service');
        expect(prompt).toContain('src/auth/');
    });

    it('includes module purposes', () => {
        const modules = [
            makeModule({ id: 'auth', path: 'src/auth/', purpose: 'Handles authentication and authorization' }),
        ];
        const prompt = buildClusteringPrompt(modules, 'Test', 10);

        expect(prompt).toContain('Handles authentication and authorization');
    });

    it('requests JSON output format', () => {
        const modules = [makeModule({ id: 'a', path: 'src/a/' })];
        const prompt = buildClusteringPrompt(modules, 'Test', 10);

        expect(prompt).toContain('"clusters"');
        expect(prompt).toContain('"memberIds"');
    });
});

// ============================================================================
// parseClusterResponse
// ============================================================================

describe('parseClusterResponse', () => {
    const modules = [
        makeModule({ id: 'auth', path: 'src/auth/' }),
        makeModule({ id: 'login', path: 'src/login/' }),
        makeModule({ id: 'db', path: 'src/db/' }),
    ];

    it('parses valid JSON response', () => {
        const response = JSON.stringify({
            clusters: [
                { id: 'auth-system', name: 'Auth System', memberIds: ['auth', 'login'], purpose: 'Authentication' },
                { id: 'database', name: 'Database', memberIds: ['db'], purpose: 'Data layer' },
            ],
        });

        const clusters = parseClusterResponse(response, modules);
        expect(clusters).toHaveLength(2);
        expect(clusters[0].id).toBe('auth-system');
        expect(clusters[0].memberIds).toEqual(['auth', 'login']);
        expect(clusters[1].id).toBe('database');
    });

    it('parses JSON wrapped in markdown code fence', () => {
        const response = '```json\n' + JSON.stringify({
            clusters: [
                { id: 'all', name: 'All Modules', memberIds: ['auth', 'login', 'db'], purpose: 'All' },
            ],
        }) + '\n```';

        const clusters = parseClusterResponse(response, modules);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].memberIds).toHaveLength(3);
    });

    it('assigns unassigned modules to singleton clusters', () => {
        const response = JSON.stringify({
            clusters: [
                { id: 'auth-group', name: 'Auth', memberIds: ['auth'], purpose: 'Auth only' },
                // login and db are not assigned
            ],
        });

        const clusters = parseClusterResponse(response, modules);

        // Should have 3 clusters: auth-group + login (singleton) + db (singleton)
        expect(clusters).toHaveLength(3);
        const allMemberIds = clusters.flatMap(c => c.memberIds).sort();
        expect(allMemberIds).toEqual(['auth', 'db', 'login']);
    });

    it('ignores invalid module IDs in clusters', () => {
        const response = JSON.stringify({
            clusters: [
                { id: 'group', name: 'Group', memberIds: ['auth', 'nonexistent'], purpose: 'Test' },
            ],
        });

        const clusters = parseClusterResponse(response, modules);
        const group = clusters.find(c => c.id === 'group')!;
        expect(group.memberIds).toEqual(['auth']);
    });

    it('prevents duplicate assignment of module IDs', () => {
        const response = JSON.stringify({
            clusters: [
                { id: 'group-a', name: 'A', memberIds: ['auth', 'login'], purpose: 'A' },
                { id: 'group-b', name: 'B', memberIds: ['auth', 'db'], purpose: 'B' },
            ],
        });

        const clusters = parseClusterResponse(response, modules);
        // auth should only appear in group-a (first seen)
        const groupA = clusters.find(c => c.id === 'group-a')!;
        const groupB = clusters.find(c => c.id === 'group-b')!;
        expect(groupA.memberIds).toContain('auth');
        expect(groupB.memberIds).not.toContain('auth');
    });

    it('returns empty array for invalid response', () => {
        expect(parseClusterResponse('not json at all', modules)).toHaveLength(0);
    });

    it('returns empty array when response has no clusters field', () => {
        const response = JSON.stringify({ wrong: 'field' });
        const clusters = parseClusterResponse(response, modules);
        expect(clusters).toHaveLength(0);
    });

    it('normalizes cluster IDs', () => {
        const response = JSON.stringify({
            clusters: [
                { id: 'My Cluster Name', name: 'My Cluster', memberIds: ['auth'], purpose: 'Test' },
            ],
        });

        const clusters = parseClusterResponse(response, modules);
        const cluster = clusters.find(c => c.memberIds.includes('auth'))!;
        expect(cluster.id).toBe('my-cluster-name');
    });

    it('skips clusters with empty memberIds', () => {
        const response = JSON.stringify({
            clusters: [
                { id: 'empty', name: 'Empty', memberIds: [], purpose: 'Empty' },
                { id: 'real', name: 'Real', memberIds: ['auth'], purpose: 'Real' },
            ],
        });

        const clusters = parseClusterResponse(response, modules);
        const clusterIds = clusters.map(c => c.id);
        expect(clusterIds).not.toContain('empty');
    });
});

// ============================================================================
// applyClusterMerge
// ============================================================================

describe('applyClusterMerge', () => {
    it('merges multi-member clusters', () => {
        const modules = [
            makeModule({ id: 'auth', path: 'src/auth/', dependencies: ['db'] }),
            makeModule({ id: 'login', path: 'src/login/', dependencies: ['auth'] }),
            makeModule({ id: 'db', path: 'src/db/', dependents: ['auth'] }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'auth-system', name: 'Auth System', memberIds: ['auth', 'login'], purpose: 'Authentication' },
            { id: 'db', name: 'Data', memberIds: ['db'], purpose: 'Database' },
        ];

        const result = applyClusterMerge(graph, clusters);

        expect(result.modules).toHaveLength(2);
        const authSystem = result.modules.find(m => m.id === 'auth-system')!;
        const dbMod = result.modules.find(m => m.id === 'db')!;

        expect(authSystem).toBeDefined();
        expect(dbMod).toBeDefined();

        // Auth system should depend on db (merged from auth → db)
        expect(authSystem.dependencies).toContain('db');
        // Self-references removed (auth → login within same cluster)
        expect(authSystem.dependencies).not.toContain('auth-system');
    });

    it('keeps singletons unchanged', () => {
        const modules = [
            makeModule({ id: 'standalone', path: 'src/standalone/' }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'standalone', name: 'Standalone', memberIds: ['standalone'], purpose: 'Solo' },
        ];

        const result = applyClusterMerge(graph, clusters);
        expect(result.modules).toHaveLength(1);
        expect(result.modules[0].id).toBe('standalone');
        expect(result.modules[0].mergedFrom).toBeUndefined();
    });

    it('unions keyFiles from merged members', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/a.ts', keyFiles: ['src/a.ts', 'src/shared.ts'] }),
            makeModule({ id: 'b', path: 'src/b.ts', keyFiles: ['src/b.ts', 'src/shared.ts'] }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'merged', name: 'Merged', memberIds: ['a', 'b'], purpose: 'Test' },
        ];

        const result = applyClusterMerge(graph, clusters);
        expect(result.modules[0].keyFiles).toContain('src/a.ts');
        expect(result.modules[0].keyFiles).toContain('src/b.ts');
        // Deduplicated
        const sharedCount = result.modules[0].keyFiles.filter(f => f === 'src/shared.ts').length;
        expect(sharedCount).toBe(1);
    });

    it('sets mergedFrom with all original IDs', () => {
        const modules = [
            makeModule({ id: 'x', path: 'src/x.ts', mergedFrom: ['x1', 'x2'] }),
            makeModule({ id: 'y', path: 'src/y.ts' }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'combined', name: 'Combined', memberIds: ['x', 'y'], purpose: 'All' },
        ];

        const result = applyClusterMerge(graph, clusters);
        // Should flatten: x had mergedFrom [x1, x2], y has no mergedFrom so uses [y]
        expect(result.modules[0].mergedFrom).toEqual(expect.arrayContaining(['x1', 'x2', 'y']));
    });

    it('picks highest complexity', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/a.ts', complexity: 'low' }),
            makeModule({ id: 'b', path: 'src/b.ts', complexity: 'high' }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'merged', name: 'Merged', memberIds: ['a', 'b'], purpose: 'Test' },
        ];

        const result = applyClusterMerge(graph, clusters);
        expect(result.modules[0].complexity).toBe('high');
    });

    it('re-derives categories', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/a.ts', category: 'core' }),
            makeModule({ id: 'b', path: 'src/b.ts', category: 'utils' }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'merged', name: 'Merged', memberIds: ['a', 'b'], purpose: 'Test' },
        ];

        const result = applyClusterMerge(graph, clusters);
        expect(result.categories.length).toBeGreaterThan(0);
    });

    it('preserves domain when consistent', () => {
        const modules = [
            makeModule({ id: 'a', path: 'pkg/core/a.ts', domain: 'pkg-core' }),
            makeModule({ id: 'b', path: 'pkg/core/b.ts', domain: 'pkg-core' }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'merged', name: 'Merged', memberIds: ['a', 'b'], purpose: 'Test' },
        ];

        const result = applyClusterMerge(graph, clusters);
        expect(result.modules[0].domain).toBe('pkg-core');
    });

    it('removes dangling dependency references', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/a.ts', dependencies: ['nonexistent'] }),
        ];
        const graph = makeGraph(modules);

        const clusters: ClusterGroup[] = [
            { id: 'a', name: 'A', memberIds: ['a'], purpose: 'Test' },
        ];

        const result = applyClusterMerge(graph, clusters);
        // nonexistent is not a valid module ID in the result
        expect(result.modules[0].dependencies).not.toContain('nonexistent');
    });
});
