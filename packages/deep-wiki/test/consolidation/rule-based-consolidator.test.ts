/**
 * Tests for rule-based module consolidation.
 */

import { describe, it, expect } from 'vitest';
import { consolidateByDirectory, getModuleDirectory } from '../../src/consolidation/rule-based-consolidator';
import type { ModuleGraph, ModuleInfo } from '../../src/types';

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

function makeGraph(modules: ModuleInfo[], overrides?: Partial<ModuleGraph>): ModuleGraph {
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
        ...overrides,
    };
}

// ============================================================================
// getModuleDirectory
// ============================================================================

describe('getModuleDirectory', () => {
    it('returns parent directory for file paths', () => {
        expect(getModuleDirectory('src/auth/login.ts')).toBe('src/auth');
    });

    it('returns directory itself for directory paths', () => {
        expect(getModuleDirectory('src/auth')).toBe('src/auth');
    });

    it('returns directory for paths with trailing slash', () => {
        expect(getModuleDirectory('src/auth/')).toBe('src/auth');
    });

    it('handles root-level files', () => {
        expect(getModuleDirectory('package.json')).toBe('.');
    });

    it('handles deeply nested paths', () => {
        expect(getModuleDirectory('src/shortcuts/tasks-viewer/task-manager.ts')).toBe('src/shortcuts/tasks-viewer');
    });

    it('normalizes Windows-style separators', () => {
        expect(getModuleDirectory('src\\auth\\login.ts')).toBe('src/auth');
    });
});

// ============================================================================
// consolidateByDirectory
// ============================================================================

describe('consolidateByDirectory', () => {
    it('returns graph unchanged when empty', () => {
        const graph = makeGraph([]);
        const result = consolidateByDirectory(graph);
        expect(result.modules).toEqual([]);
    });

    it('keeps single modules in unique directories unchanged', () => {
        const modules = [
            makeModule({ id: 'auth', path: 'src/auth/' }),
            makeModule({ id: 'config', path: 'src/config/' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);
        expect(result.modules).toHaveLength(2);
        expect(result.modules.map(m => m.id).sort()).toEqual(['auth', 'config']);
    });

    it('merges modules in same directory', () => {
        const modules = [
            makeModule({ id: 'login', path: 'src/auth/login.ts' }),
            makeModule({ id: 'logout', path: 'src/auth/logout.ts' }),
            makeModule({ id: 'session', path: 'src/auth/session.ts' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules).toHaveLength(1);
        expect(result.modules[0].id).toBe('src-auth');
        expect(result.modules[0].keyFiles).toContain('src/auth/login.ts');
        expect(result.modules[0].keyFiles).toContain('src/auth/logout.ts');
        expect(result.modules[0].keyFiles).toContain('src/auth/session.ts');
    });

    it('sets mergedFrom on merged modules', () => {
        const modules = [
            makeModule({ id: 'mod-a', path: 'src/utils/a.ts' }),
            makeModule({ id: 'mod-b', path: 'src/utils/b.ts' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules).toHaveLength(1);
        expect(result.modules[0].mergedFrom).toEqual(['mod-a', 'mod-b']);
    });

    it('does not set mergedFrom on unmerged modules', () => {
        const modules = [
            makeModule({ id: 'standalone', path: 'src/standalone/' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules).toHaveLength(1);
        expect(result.modules[0].mergedFrom).toBeUndefined();
    });

    it('fixes up dependency references after merge', () => {
        const modules = [
            makeModule({ id: 'login', path: 'src/auth/login.ts', dependencies: ['db-query'] }),
            makeModule({ id: 'logout', path: 'src/auth/logout.ts', dependencies: ['db-query'] }),
            makeModule({ id: 'db-query', path: 'src/db/query.ts', dependents: ['login', 'logout'] }),
            makeModule({ id: 'db-connect', path: 'src/db/connect.ts', dependents: ['db-query'] }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        // Should have 2 modules: src-auth and src-db
        expect(result.modules).toHaveLength(2);

        const authMod = result.modules.find(m => m.id === 'src-auth')!;
        const dbMod = result.modules.find(m => m.id === 'src-db')!;

        // auth should depend on db (not on old IDs)
        expect(authMod.dependencies).toContain('src-db');
        expect(authMod.dependencies).not.toContain('db-query');

        // db should have auth as dependent (not old IDs)
        expect(dbMod.dependents).toContain('src-auth');
        expect(dbMod.dependents).not.toContain('login');
    });

    it('removes self-references in dependencies', () => {
        // login depends on session, both in src/auth
        const modules = [
            makeModule({ id: 'login', path: 'src/auth/login.ts', dependencies: ['session'] }),
            makeModule({ id: 'session', path: 'src/auth/session.ts', dependents: ['login'] }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules).toHaveLength(1);
        // Self-reference should be removed
        expect(result.modules[0].dependencies).not.toContain('src-auth');
        expect(result.modules[0].dependents).not.toContain('src-auth');
    });

    it('picks highest complexity from merged modules', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts', complexity: 'low' }),
            makeModule({ id: 'b', path: 'src/x/b.ts', complexity: 'high' }),
            makeModule({ id: 'c', path: 'src/x/c.ts', complexity: 'medium' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules[0].complexity).toBe('high');
    });

    it('picks most common category from merged modules', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts', category: 'utils' }),
            makeModule({ id: 'b', path: 'src/x/b.ts', category: 'core' }),
            makeModule({ id: 'c', path: 'src/x/c.ts', category: 'utils' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules[0].category).toBe('utils');
    });

    it('deduplicates keyFiles in merged modules', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts', keyFiles: ['src/x/a.ts', 'src/shared.ts'] }),
            makeModule({ id: 'b', path: 'src/x/b.ts', keyFiles: ['src/x/b.ts', 'src/shared.ts'] }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        // shared.ts should appear only once
        const sharedCount = result.modules[0].keyFiles.filter(f => f === 'src/shared.ts').length;
        expect(sharedCount).toBe(1);
    });

    it('re-derives categories from merged modules', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts', category: 'alpha' }),
            makeModule({ id: 'b', path: 'src/x/b.ts', category: 'alpha' }),
            makeModule({ id: 'c', path: 'src/y/', category: 'beta' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.categories).toHaveLength(2);
        const catNames = result.categories.map(c => c.name).sort();
        expect(catNames).toEqual(['alpha', 'beta']);
    });

    it('preserves domain when all modules share same domain', () => {
        const modules = [
            makeModule({ id: 'a', path: 'pkg/core/a.ts', domain: 'pkg-core' }),
            makeModule({ id: 'b', path: 'pkg/core/b.ts', domain: 'pkg-core' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules[0].domain).toBe('pkg-core');
    });

    it('clears domain when modules have different domains', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/shared/a.ts', domain: 'frontend' }),
            makeModule({ id: 'b', path: 'src/shared/b.ts', domain: 'backend' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        expect(result.modules[0].domain).toBeUndefined();
    });

    it('preserves project info and architectureNotes', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts' }),
            makeModule({ id: 'b', path: 'src/x/b.ts' }),
        ];
        const graph = makeGraph(modules, {
            architectureNotes: 'Important notes',
        });
        const result = consolidateByDirectory(graph);

        expect(result.project.name).toBe('test-project');
        expect(result.architectureNotes).toBe('Important notes');
    });

    it('handles mix of file and directory modules', () => {
        const modules = [
            makeModule({ id: 'auth-dir', path: 'src/auth/' }),
            makeModule({ id: 'auth-login', path: 'src/auth/login.ts' }),
            makeModule({ id: 'config', path: 'src/config/' }),
        ];
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        // auth-dir (directory) groups with auth path = src/auth
        // auth-login (file) groups with parent = src/auth
        // config stays as-is
        expect(result.modules).toHaveLength(2);
    });

    it('reduces a large set of single-file modules significantly', () => {
        // Simulate 50 single-file modules across 10 directories
        const modules: ModuleInfo[] = [];
        for (let dir = 0; dir < 10; dir++) {
            for (let file = 0; file < 5; file++) {
                modules.push(makeModule({
                    id: `mod-d${dir}-f${file}`,
                    path: `src/dir${dir}/file${file}.ts`,
                }));
            }
        }
        const graph = makeGraph(modules);
        const result = consolidateByDirectory(graph);

        // 50 modules across 10 directories → 10 merged modules
        expect(result.modules).toHaveLength(10);
    });

    it('preserves domains array on the graph', () => {
        const modules = [
            makeModule({ id: 'a', path: 'src/x/a.ts' }),
        ];
        const graph = makeGraph(modules, {
            domains: [{ id: 'core', name: 'Core', path: 'src/', description: 'Core domain', modules: ['a'] }],
        });
        const result = consolidateByDirectory(graph);

        expect(result.domains).toBeDefined();
        expect(result.domains![0].id).toBe('core');
    });
});
