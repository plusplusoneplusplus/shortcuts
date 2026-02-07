/**
 * Large Repo Handler Tests
 *
 * Tests for multi-round discovery logic: file count threshold,
 * structural scanning, per-area drill-down, and sub-graph merging.
 */

import { describe, it, expect } from 'vitest';
import { LARGE_REPO_THRESHOLD, mergeSubGraphs } from '../../src/discovery/large-repo-handler';
import type { ModuleGraph, StructuralScanResult } from '../../src/types';

describe('Large Repo Handler', () => {
    // ========================================================================
    // Threshold Constant
    // ========================================================================

    describe('LARGE_REPO_THRESHOLD', () => {
        it('should be 3000', () => {
            expect(LARGE_REPO_THRESHOLD).toBe(3000);
        });

        it('should be a positive number', () => {
            expect(LARGE_REPO_THRESHOLD).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Sub-Graph Merging
    // ========================================================================

    describe('mergeSubGraphs', () => {
        const createMinimalGraph = (
            modulesData: Array<{ id: string; name: string; path: string; deps?: string[]; dependents?: string[]; category?: string }>,
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

        const defaultScanResult: StructuralScanResult = {
            fileCount: 5000,
            areas: [],
            projectInfo: {},
        };

        it('should merge modules from multiple sub-graphs', () => {
            const graph1 = createMinimalGraph([
                { id: 'core-auth', name: 'Auth', path: 'core/auth/' },
            ]);
            const graph2 = createMinimalGraph([
                { id: 'api-routes', name: 'Routes', path: 'api/routes/' },
            ]);

            const result = mergeSubGraphs([graph1, graph2], defaultScanResult);
            expect(result.modules).toHaveLength(2);
            expect(result.modules.map(m => m.id)).toContain('core-auth');
            expect(result.modules.map(m => m.id)).toContain('api-routes');
        });

        it('should deduplicate modules by ID', () => {
            const graph1 = createMinimalGraph([
                { id: 'shared', name: 'Shared V1', path: 'shared/' },
            ]);
            const graph2 = createMinimalGraph([
                { id: 'shared', name: 'Shared V2', path: 'shared/' },
            ]);

            const result = mergeSubGraphs([graph1, graph2], defaultScanResult);
            expect(result.modules).toHaveLength(1);
            expect(result.modules[0].name).toBe('Shared V1'); // First occurrence wins
        });

        it('should deduplicate categories by name', () => {
            const graph1 = createMinimalGraph([], [
                { name: 'core', description: 'Core modules' },
                { name: 'util', description: 'Utilities' },
            ]);
            const graph2 = createMinimalGraph([], [
                { name: 'core', description: 'Core modules from graph2' },
                { name: 'api', description: 'API layer' },
            ]);

            const result = mergeSubGraphs([graph1, graph2], defaultScanResult);
            expect(result.categories).toHaveLength(3);
            expect(result.categories.map(c => c.name)).toContain('core');
            expect(result.categories.map(c => c.name)).toContain('util');
            expect(result.categories.map(c => c.name)).toContain('api');
        });

        it('should remove cross-area dependencies to non-existent modules', () => {
            const graph1 = createMinimalGraph([
                { id: 'core-auth', name: 'Auth', path: 'core/auth/', deps: ['database-main'] },
            ]);
            // database-main doesn't exist in any sub-graph

            const result = mergeSubGraphs([graph1], defaultScanResult);
            expect(result.modules[0].dependencies).toEqual([]);
        });

        it('should keep valid cross-area dependencies', () => {
            const graph1 = createMinimalGraph([
                { id: 'core-auth', name: 'Auth', path: 'core/auth/', deps: ['infra-db'] },
            ]);
            const graph2 = createMinimalGraph([
                { id: 'infra-db', name: 'Database', path: 'infra/db/', dependents: ['core-auth'] },
            ]);

            const result = mergeSubGraphs([graph1, graph2], defaultScanResult);
            expect(result.modules.find(m => m.id === 'core-auth')!.dependencies).toEqual(['infra-db']);
            expect(result.modules.find(m => m.id === 'infra-db')!.dependents).toEqual(['core-auth']);
        });

        it('should use scan result project info when available', () => {
            const graph1 = createMinimalGraph([], [], { name: 'from-graph' });

            const scanWithInfo: StructuralScanResult = {
                fileCount: 5000,
                areas: [],
                projectInfo: {
                    name: 'from-scan',
                    language: 'Rust',
                },
            };

            const result = mergeSubGraphs([graph1], scanWithInfo);
            expect(result.project.name).toBe('from-scan');
            expect(result.project.language).toBe('Rust');
        });

        it('should fall back to first graph project info when scan is partial', () => {
            const graph1 = createMinimalGraph([], [], {
                name: 'from-graph',
                buildSystem: 'cargo',
            });

            const scanPartial: StructuralScanResult = {
                fileCount: 5000,
                areas: [],
                projectInfo: { name: 'from-scan' },
            };

            const result = mergeSubGraphs([graph1], scanPartial);
            expect(result.project.name).toBe('from-scan');
            expect(result.project.buildSystem).toBe('cargo'); // Falls back to graph
        });

        it('should combine architecture notes from all sub-graphs', () => {
            const graph1 = createMinimalGraph([], [], {}, 'Core uses DI.');
            const graph2 = createMinimalGraph([], [], {}, 'API follows REST.');

            const result = mergeSubGraphs([graph1, graph2], defaultScanResult);
            expect(result.architectureNotes).toContain('Core uses DI.');
            expect(result.architectureNotes).toContain('API follows REST.');
        });

        it('should skip empty architecture notes', () => {
            const graph1 = createMinimalGraph([], [], {}, 'Has notes.');
            const graph2 = createMinimalGraph([], [], {}, '');

            const result = mergeSubGraphs([graph1, graph2], defaultScanResult);
            expect(result.architectureNotes).toBe('Has notes.');
        });

        it('should handle single sub-graph', () => {
            const graph1 = createMinimalGraph([
                { id: 'only-module', name: 'Only', path: 'src/' },
            ]);

            const result = mergeSubGraphs([graph1], defaultScanResult);
            expect(result.modules).toHaveLength(1);
        });

        it('should handle many sub-graphs', () => {
            const graphs: ModuleGraph[] = [];
            for (let i = 0; i < 10; i++) {
                graphs.push(createMinimalGraph([
                    { id: `mod-${i}`, name: `Module ${i}`, path: `area-${i}/` },
                ]));
            }

            const result = mergeSubGraphs(graphs, defaultScanResult);
            expect(result.modules).toHaveLength(10);
        });
    });
});
