/**
 * Area Tagging Tests
 *
 * Tests for mergeSubGraphs domain tagging in large-repo-handler:
 * - Modules tagged with domain slug
 * - DomainInfo[] populated from TopLevelDomain[]
 * - Backward compat: no domains for empty scan result
 * - Module-to-domain assignment tracking
 */

import { describe, it, expect } from 'vitest';
import { mergeSubGraphs } from '../../src/discovery/large-repo-handler';
import type { ModuleGraph, StructuralScanResult, DomainInfo } from '../../src/types';
import { normalizeModuleId } from '../../src/schemas';

// ============================================================================
// Test Helpers
// ============================================================================

const createMinimalGraph = (
    modulesData: Array<{
        id: string;
        name: string;
        path: string;
        deps?: string[];
        dependents?: string[];
        category?: string;
    }>,
    categories: Array<{ name: string; description: string }> = [],
    projectOverrides: Partial<ModuleGraph['project']> = {},
    architectureNotes = ''
): ModuleGraph => ({
    project: {
        name: 'test',
        description: '',
        language: 'TypeScript',
        buildSystem: 'npm',
        entryPoints: [],
        ...projectOverrides,
    },
    modules: modulesData.map(m => ({
        id: m.id,
        name: m.name,
        path: m.path,
        purpose: '',
        keyFiles: [],
        dependencies: m.deps || [],
        dependents: m.dependents || [],
        complexity: 'medium' as const,
        category: m.category || 'general',
    })),
    categories,
    architectureNotes,
});

// ============================================================================
// Area Tagging in mergeSubGraphs
// ============================================================================

describe('mergeSubGraphs — domain tagging', () => {
    it('should tag modules with domain slug from TopLevelDomain path', () => {
        const graph1 = createMinimalGraph([
            { id: 'core-auth', name: 'Auth', path: 'packages/core/auth/' },
            { id: 'core-db', name: 'DB', path: 'packages/core/db/' },
        ]);
        const graph2 = createMinimalGraph([
            { id: 'api-routes', name: 'Routes', path: 'packages/api/routes/' },
        ]);

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'packages/core', path: 'packages/core', description: 'Core library' },
                { name: 'packages/api', path: 'packages/api', description: 'API layer' },
            ],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1, graph2], scanResult);

        // Check modules are tagged
        const authModule = result.modules.find(m => m.id === 'core-auth')!;
        const dbModule = result.modules.find(m => m.id === 'core-db')!;
        const routesModule = result.modules.find(m => m.id === 'api-routes')!;

        expect(authModule.domain).toBe(normalizeModuleId('packages/core'));
        expect(dbModule.domain).toBe(normalizeModuleId('packages/core'));
        expect(routesModule.domain).toBe(normalizeModuleId('packages/api'));
    });

    it('should populate graph.domains from TopLevelDomain[]', () => {
        const graph1 = createMinimalGraph([
            { id: 'core-auth', name: 'Auth', path: 'core/auth/' },
        ]);
        const graph2 = createMinimalGraph([
            { id: 'api-routes', name: 'Routes', path: 'api/routes/' },
        ]);

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'Core', path: 'core', description: 'Core library' },
                { name: 'API', path: 'api', description: 'API layer' },
            ],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1, graph2], scanResult);

        expect(result.domains).toBeDefined();
        expect(result.domains).toHaveLength(2);

        const coreArea = result.domains!.find(a => a.name === 'Core')!;
        expect(coreArea.id).toBe('core');
        expect(coreArea.path).toBe('core');
        expect(coreArea.description).toBe('Core library');
        expect(coreArea.modules).toContain('core-auth');

        const apiArea = result.domains!.find(a => a.name === 'API')!;
        expect(apiArea.modules).toContain('api-routes');
    });

    it('should correctly assign modules to their respective domains', () => {
        const graph1 = createMinimalGraph([
            { id: 'mod-a', name: 'A', path: 'area1/a/' },
            { id: 'mod-b', name: 'B', path: 'area1/b/' },
        ]);
        const graph2 = createMinimalGraph([
            { id: 'mod-c', name: 'C', path: 'area2/c/' },
        ]);

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'Area 1', path: 'area1', description: '' },
                { name: 'Area 2', path: 'area2', description: '' },
            ],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1, graph2], scanResult);

        const area1 = result.domains!.find(a => a.id === 'area1')!;
        expect(area1.modules).toEqual(['mod-a', 'mod-b']);

        const area2 = result.domains!.find(a => a.id === 'area2')!;
        expect(area2.modules).toEqual(['mod-c']);
    });

    it('should not produce domains when scan result has empty domains array', () => {
        const graph1 = createMinimalGraph([
            { id: 'mod-a', name: 'A', path: 'src/a/' },
        ]);

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1], scanResult);

        expect(result.domains).toBeUndefined();
        // Module should NOT have area tag
        expect(result.modules[0].domain).toBeUndefined();
    });

    it('should handle domain with no modules (empty sub-graph)', () => {
        const graph1 = createMinimalGraph([
            { id: 'core-auth', name: 'Auth', path: 'core/auth/' },
        ]);
        const graph2 = createMinimalGraph([]); // Empty sub-graph

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'Core', path: 'core', description: 'Core' },
                { name: 'Empty', path: 'empty', description: 'Empty domain' },
            ],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1, graph2], scanResult);

        expect(result.domains).toHaveLength(2);
        const emptyArea = result.domains!.find(a => a.id === 'empty')!;
        expect(emptyArea.modules).toEqual([]);
    });

    it('should normalize domain paths with special characters into kebab-case slugs', () => {
        const graph1 = createMinimalGraph([
            { id: 'mod', name: 'Mod', path: 'My Packages/Core.v2/' },
        ]);

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'My Packages/Core.v2', path: 'My Packages/Core.v2', description: '' },
            ],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1], scanResult);

        const domain = result.domains![0];
        // normalizeModuleId converts to lowercase kebab-case
        expect(domain.id).toBe('my-packages-core-v2');
        expect(result.modules[0].domain).toBe('my-packages-core-v2');
    });

    it('should deduplicate modules across domains (first wins)', () => {
        const graph1 = createMinimalGraph([
            { id: 'shared', name: 'Shared V1', path: 'shared/' },
        ]);
        const graph2 = createMinimalGraph([
            { id: 'shared', name: 'Shared V2', path: 'shared/' },
        ]);

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'Area 1', path: 'area1', description: '' },
                { name: 'Area 2', path: 'area2', description: '' },
            ],
            projectInfo: {},
        };

        const result = mergeSubGraphs([graph1, graph2], scanResult);

        expect(result.modules).toHaveLength(1);
        expect(result.modules[0].name).toBe('Shared V1');
        // Should be tagged with first domain
        expect(result.modules[0].domain).toBe('area1');

        // Should appear in first domain's module list
        const area1 = result.domains!.find(a => a.id === 'area1')!;
        expect(area1.modules).toContain('shared');
    });

    it('should preserve existing merge behavior (project info, categories, deps)', () => {
        const graph1 = createMinimalGraph(
            [{ id: 'core-auth', name: 'Auth', path: 'core/auth/', deps: ['api-routes'] }],
            [{ name: 'core', description: 'Core' }],
            { name: 'from-graph' },
            'Core uses DI.'
        );
        const graph2 = createMinimalGraph(
            [{ id: 'api-routes', name: 'Routes', path: 'api/routes/', dependents: ['core-auth'] }],
            [{ name: 'api', description: 'API' }],
            {},
            'API follows REST.'
        );

        const scanResult: StructuralScanResult = {
            fileCount: 5000,
            domains: [
                { name: 'Core', path: 'core', description: 'Core library' },
                { name: 'API', path: 'api', description: 'API layer' },
            ],
            projectInfo: { name: 'from-scan' },
        };

        const result = mergeSubGraphs([graph1, graph2], scanResult);

        // Project info behavior unchanged
        expect(result.project.name).toBe('from-scan');

        // Categories merged
        expect(result.categories).toHaveLength(2);

        // Cross-domain deps preserved
        expect(result.modules.find(m => m.id === 'core-auth')!.dependencies).toEqual(['api-routes']);

        // Architecture notes combined
        expect(result.architectureNotes).toContain('Core uses DI.');
        expect(result.architectureNotes).toContain('API follows REST.');

        // And domains are also present
        expect(result.domains).toBeDefined();
    });
});
