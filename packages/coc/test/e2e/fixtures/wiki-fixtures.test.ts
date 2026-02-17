/**
 * Unit Tests for wiki-fixtures
 *
 * Validates that createWikiFixture and createWikiComponent produce
 * correct ComponentGraph structures and write them to disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWikiFixture, createWikiComponent } from './wiki-fixtures';
import type { ComponentGraph } from './wiki-fixtures';

describe('wiki-fixtures', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-fix-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // createWikiFixture
    // -----------------------------------------------------------------------
    describe('createWikiFixture', () => {
        it('writes component-graph.json to wikiDir', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            createWikiFixture(wikiDir);
            expect(fs.existsSync(path.join(wikiDir, 'component-graph.json'))).toBe(true);
        });

        it('written JSON is valid and matches returned graph', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir);
            const onDisk: ComponentGraph = JSON.parse(
                fs.readFileSync(path.join(wikiDir, 'component-graph.json'), 'utf-8'),
            );
            expect(onDisk).toEqual(graph);
        });

        it('returns ComponentGraph with required fields', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir);

            expect(graph.project).toBeDefined();
            expect(graph.project.name).toBeTruthy();
            expect(graph.project.description).toBeTruthy();
            expect(graph.project.language).toBeTruthy();
            expect(graph.project.buildSystem).toBeTruthy();
            expect(graph.project.entryPoints).toBeInstanceOf(Array);
            expect(graph.components).toBeInstanceOf(Array);
            expect(graph.components.length).toBeGreaterThan(0);
            expect(graph.categories).toBeInstanceOf(Array);
            expect(graph.categories.length).toBeGreaterThan(0);
            expect(graph.architectureNotes).toBeTruthy();
        });

        it('creates components with valid structure', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir);

            for (const comp of graph.components) {
                expect(comp.id).toBeTruthy();
                expect(comp.name).toBeTruthy();
                expect(comp.path).toBeTruthy();
                expect(comp.purpose).toBeTruthy();
                expect(comp.keyFiles).toBeInstanceOf(Array);
                expect(comp.keyFiles.length).toBeGreaterThan(0);
                expect(comp.dependencies).toBeInstanceOf(Array);
                expect(comp.dependents).toBeInstanceOf(Array);
                expect(['low', 'medium', 'high']).toContain(comp.complexity);
                expect(comp.category).toBeTruthy();
            }
        });

        it('default componentCount is 4', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir);
            expect(graph.components.length).toBe(4);
        });

        it('respects componentCount option', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir, { componentCount: 10 });
            expect(graph.components.length).toBe(10);
        });

        it('generates valid dependency references (no dangling)', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir, { componentCount: 6 });
            const ids = new Set(graph.components.map((c) => c.id));

            for (const comp of graph.components) {
                for (const dep of comp.dependencies) {
                    expect(ids.has(dep)).toBe(true);
                }
                for (const dep of comp.dependents) {
                    expect(ids.has(dep)).toBe(true);
                }
            }
        });

        it('generates valid category references', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir);
            const categoryNames = graph.categories.map((c) => c.name);

            for (const comp of graph.components) {
                expect(categoryNames).toContain(comp.category);
            }
        });

        it('respects projectName option', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir, { projectName: 'my-project' });
            expect(graph.project.name).toBe('my-project');
        });

        it('respects language option', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir, { language: 'Rust' });
            expect(graph.project.language).toBe('Rust');
        });

        it('respects custom categories', () => {
            const custom = [
                { name: 'ui', description: 'User interface' },
                { name: 'data', description: 'Data layer' },
            ];
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir, { categories: custom });
            expect(graph.categories).toEqual(custom);

            const categoryNames = custom.map((c) => c.name);
            for (const comp of graph.components) {
                expect(categoryNames).toContain(comp.category);
            }
        });

        it('does not include domains by default', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir);
            expect(graph.domains).toBeUndefined();
        });

        it('adds domains when withDomains: true', () => {
            const wikiDir = path.join(tmpDir, 'wiki-1');
            const graph = createWikiFixture(wikiDir, { withDomains: true });

            expect(graph.domains).toBeDefined();
            expect(graph.domains!.length).toBe(2);

            for (const domain of graph.domains!) {
                expect(domain.id).toBeTruthy();
                expect(domain.name).toBeTruthy();
                expect(domain.path).toBeTruthy();
                expect(domain.description).toBeTruthy();
                expect(domain.components).toBeInstanceOf(Array);
                expect(domain.components.length).toBeGreaterThan(0);
            }

            // Every component must be assigned to exactly one domain
            const allDomainCompIds = graph.domains!.flatMap((d) => d.components);
            const compIds = graph.components.map((c) => c.id);
            expect(allDomainCompIds.sort()).toEqual(compIds.sort());

            // Each component's domain field should match
            for (const comp of graph.components) {
                const owningDomain = graph.domains!.find((d) => d.components.includes(comp.id));
                expect(comp.domain).toBe(owningDomain!.id);
            }
        });

        it('creates wikiDir recursively if it does not exist', () => {
            const wikiDir = path.join(tmpDir, 'nested', 'deep', 'wiki');
            createWikiFixture(wikiDir);
            expect(fs.existsSync(path.join(wikiDir, 'component-graph.json'))).toBe(true);
        });

        it('is deterministic — same inputs produce same output', () => {
            const dir1 = path.join(tmpDir, 'a');
            const dir2 = path.join(tmpDir, 'b');
            const g1 = createWikiFixture(dir1, { componentCount: 3 });
            const g2 = createWikiFixture(dir2, { componentCount: 3 });
            expect(g1).toEqual(g2);
        });
    });

    // -----------------------------------------------------------------------
    // createWikiComponent
    // -----------------------------------------------------------------------
    describe('createWikiComponent', () => {
        it('creates component with default values', () => {
            const comp = createWikiComponent('test-comp');

            expect(comp.id).toBe('test-comp');
            expect(comp.name).toBe('Test Comp');
            expect(comp.path).toContain('test-comp');
            expect(comp.purpose).toBeTruthy();
            expect(comp.keyFiles.length).toBeGreaterThan(0);
            expect(comp.dependencies).toEqual([]);
            expect(comp.dependents).toEqual([]);
            expect(comp.complexity).toBe('medium');
            expect(comp.category).toBe('core');
        });

        it('applies overrides', () => {
            const comp = createWikiComponent('auth', {
                category: 'security',
                complexity: 'high',
                dependencies: ['user-store'],
            });

            expect(comp.id).toBe('auth');
            expect(comp.category).toBe('security');
            expect(comp.complexity).toBe('high');
            expect(comp.dependencies).toEqual(['user-store']);
        });

        it('generates human-readable name from kebab-case id', () => {
            expect(createWikiComponent('api-gateway-service').name).toBe('Api Gateway Service');
        });
    });
});
