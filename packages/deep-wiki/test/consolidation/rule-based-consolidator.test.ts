/**
 * Tests for rule-based component consolidation.
 */

import { describe, it, expect } from 'vitest';
import { consolidateByDirectory, getComponentDirectory } from '../../src/consolidation/rule-based-consolidator';
import type { ComponentGraph, ComponentInfo } from '../../src/types';

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

function makeGraph(components: ComponentInfo[], overrides?: Partial<ComponentGraph>): ComponentGraph {
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
        ...overrides,
    };
}

// ============================================================================
// getComponentDirectory
// ============================================================================

describe('getComponentDirectory', () => {
    it('returns parent directory for file paths', () => {
        expect(getComponentDirectory('src/auth/login.ts')).toBe('src/auth');
    });

    it('returns directory itself for directory paths', () => {
        expect(getComponentDirectory('src/auth')).toBe('src/auth');
    });

    it('returns directory for paths with trailing slash', () => {
        expect(getComponentDirectory('src/auth/')).toBe('src/auth');
    });

    it('handles root-level files', () => {
        expect(getComponentDirectory('package.json')).toBe('.');
    });

    it('handles deeply nested paths', () => {
        expect(getComponentDirectory('src/shortcuts/tasks-viewer/task-manager.ts')).toBe('src/shortcuts/tasks-viewer');
    });

    it('normalizes Windows-style separators', () => {
        expect(getComponentDirectory('src\\auth\\login.ts')).toBe('src/auth');
    });
});

// ============================================================================
// consolidateByDirectory
// ============================================================================

describe('consolidateByDirectory', () => {
    it('returns graph unchanged when empty', () => {
        const graph = makeGraph([]);
        const result = consolidateByDirectory(graph);
        expect(result.components).toEqual([]);
    });

    it('keeps single components in unique directories unchanged', () => {
        const components = [
            makeComponent({ id: 'auth', path: 'src/auth/' }),
            makeComponent({ id: 'config', path: 'src/config/' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);
        expect(result.components).toHaveLength(2);
        expect(result.components.map(m => m.id).sort()).toEqual(['auth', 'config']);
    });

    it('merges components in same directory', () => {
        const components = [
            makeComponent({ id: 'login', path: 'src/auth/login.ts' }),
            makeComponent({ id: 'logout', path: 'src/auth/logout.ts' }),
            makeComponent({ id: 'session', path: 'src/auth/session.ts' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components).toHaveLength(1);
        expect(result.components[0].id).toBe('src-auth');
        expect(result.components[0].keyFiles).toContain('src/auth/login.ts');
        expect(result.components[0].keyFiles).toContain('src/auth/logout.ts');
        expect(result.components[0].keyFiles).toContain('src/auth/session.ts');
    });

    it('sets mergedFrom on merged components', () => {
        const components = [
            makeComponent({ id: 'mod-a', path: 'src/utils/a.ts' }),
            makeComponent({ id: 'mod-b', path: 'src/utils/b.ts' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components).toHaveLength(1);
        expect(result.components[0].mergedFrom).toEqual(['mod-a', 'mod-b']);
    });

    it('does not set mergedFrom on unmerged components', () => {
        const components = [
            makeComponent({ id: 'standalone', path: 'src/standalone/' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components).toHaveLength(1);
        expect(result.components[0].mergedFrom).toBeUndefined();
    });

    it('fixes up dependency references after merge', () => {
        const components = [
            makeComponent({ id: 'login', path: 'src/auth/login.ts', dependencies: ['db-query'] }),
            makeComponent({ id: 'logout', path: 'src/auth/logout.ts', dependencies: ['db-query'] }),
            makeComponent({ id: 'db-query', path: 'src/db/query.ts', dependents: ['login', 'logout'] }),
            makeComponent({ id: 'db-connect', path: 'src/db/connect.ts', dependents: ['db-query'] }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        // Should have 2 modules: src-auth and src-db
        expect(result.components).toHaveLength(2);

        const authMod = result.components.find(m => m.id === 'src-auth')!;
        const dbMod = result.components.find(m => m.id === 'src-db')!;

        // auth should depend on db (not on old IDs)
        expect(authMod.dependencies).toContain('src-db');
        expect(authMod.dependencies).not.toContain('db-query');

        // db should have auth as dependent (not old IDs)
        expect(dbMod.dependents).toContain('src-auth');
        expect(dbMod.dependents).not.toContain('login');
    });

    it('removes self-references in dependencies', () => {
        // login depends on session, both in src/auth
        const components = [
            makeComponent({ id: 'login', path: 'src/auth/login.ts', dependencies: ['session'] }),
            makeComponent({ id: 'session', path: 'src/auth/session.ts', dependents: ['login'] }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components).toHaveLength(1);
        // Self-reference should be removed
        expect(result.components[0].dependencies).not.toContain('src-auth');
        expect(result.components[0].dependents).not.toContain('src-auth');
    });

    it('picks highest complexity from merged components', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts', complexity: 'low' }),
            makeComponent({ id: 'b', path: 'src/x/b.ts', complexity: 'high' }),
            makeComponent({ id: 'c', path: 'src/x/c.ts', complexity: 'medium' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components[0].complexity).toBe('high');
    });

    it('picks most common category from merged components', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts', category: 'utils' }),
            makeComponent({ id: 'b', path: 'src/x/b.ts', category: 'core' }),
            makeComponent({ id: 'c', path: 'src/x/c.ts', category: 'utils' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components[0].category).toBe('utils');
    });

    it('deduplicates keyFiles in merged components', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts', keyFiles: ['src/x/a.ts', 'src/shared.ts'] }),
            makeComponent({ id: 'b', path: 'src/x/b.ts', keyFiles: ['src/x/b.ts', 'src/shared.ts'] }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        // shared.ts should appear only once
        const sharedCount = result.components[0].keyFiles.filter(f => f === 'src/shared.ts').length;
        expect(sharedCount).toBe(1);
    });

    it('re-derives categories from merged components', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts', category: 'alpha' }),
            makeComponent({ id: 'b', path: 'src/x/b.ts', category: 'alpha' }),
            makeComponent({ id: 'c', path: 'src/y/', category: 'beta' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.categories).toHaveLength(2);
        const catNames = result.categories.map(c => c.name).sort();
        expect(catNames).toEqual(['alpha', 'beta']);
    });

    it('preserves domain when all components share same domain', () => {
        const components = [
            makeComponent({ id: 'a', path: 'pkg/core/a.ts', domain: 'pkg-core' }),
            makeComponent({ id: 'b', path: 'pkg/core/b.ts', domain: 'pkg-core' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components[0].domain).toBe('pkg-core');
    });

    it('clears domain when components have different domains', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/shared/a.ts', domain: 'frontend' }),
            makeComponent({ id: 'b', path: 'src/shared/b.ts', domain: 'backend' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        expect(result.components[0].domain).toBeUndefined();
    });

    it('preserves project info and architectureNotes', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts' }),
            makeComponent({ id: 'b', path: 'src/x/b.ts' }),
        ];
        const graph = makeGraph(components, {
            architectureNotes: 'Important notes',
        });
        const result = consolidateByDirectory(graph);

        expect(result.project.name).toBe('test-project');
        expect(result.architectureNotes).toBe('Important notes');
    });

    it('handles mix of file and directory components', () => {
        const components = [
            makeComponent({ id: 'auth-dir', path: 'src/auth/' }),
            makeComponent({ id: 'auth-login', path: 'src/auth/login.ts' }),
            makeComponent({ id: 'config', path: 'src/config/' }),
        ];
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        // auth-dir (directory) groups with auth path = src/auth
        // auth-login (file) groups with parent = src/auth
        // config stays as-is
        expect(result.components).toHaveLength(2);
    });

    it('reduces a large set of single-file components significantly', () => {
        // Simulate 50 single-file components across 10 directories
        const components: ComponentInfo[] = [];
        for (let dir = 0; dir < 10; dir++) {
            for (let file = 0; file < 5; file++) {
                components.push(makeComponent({
                    id: `mod-d${dir}-f${file}`,
                    path: `src/dir${dir}/file${file}.ts`,
                }));
            }
        }
        const graph = makeGraph(components);
        const result = consolidateByDirectory(graph);

        // 50 components across 10 directories → 10 merged components
        expect(result.components).toHaveLength(10);
    });

    it('preserves domains array on the graph', () => {
        const components = [
            makeComponent({ id: 'a', path: 'src/x/a.ts' }),
        ];
        const graph = makeGraph(components, {
            domains: [{ id: 'core', name: 'Core', path: 'src/', description: 'Core domain', components: ['a'] }],
        });
        const result = consolidateByDirectory(graph);

        expect(result.domains).toBeDefined();
        expect(result.domains![0].id).toBe('core');
    });
});
