import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadWikiGraph, listThemeAreas, checkThemeCoverage, tokenize } from '../../src/theme/coverage-checker';
import { ComponentGraph, ThemeRequest } from '../../src/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-checker-'));
}

function rmDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

function makeGraph(overrides: Partial<ComponentGraph> = {}): ComponentGraph {
    return {
        project: {
            name: 'test-project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts']
        },
        components: [],
        categories: [{ name: 'core', description: 'Core modules' }],
        architectureNotes: 'Test architecture',
        ...overrides
    };
}

function writeGraph(wikiDir: string, graph: ComponentGraph): void {
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
        path.join(wikiDir, 'module-graph.json'),
        JSON.stringify(graph, null, 2),
        'utf-8'
    );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('coverage-checker', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
    });

    afterEach(() => {
        rmDir(tmpDir);
    });

    // ─── loadWikiGraph ───────────────────────────────────────────────────

    describe('loadWikiGraph', () => {
        it('returns null when wiki directory does not exist', () => {
            const result = loadWikiGraph(path.join(tmpDir, 'nonexistent'));
            expect(result).toBeNull();
        });

        it('returns null when module-graph.json is missing', () => {
            fs.mkdirSync(path.join(tmpDir, 'wiki'), { recursive: true });
            const result = loadWikiGraph(path.join(tmpDir, 'wiki'));
            expect(result).toBeNull();
        });

        it('returns null for malformed JSON', () => {
            const wikiDir = path.join(tmpDir, 'wiki');
            fs.mkdirSync(wikiDir, { recursive: true });
            fs.writeFileSync(path.join(wikiDir, 'module-graph.json'), '{ invalid json', 'utf-8');
            const result = loadWikiGraph(wikiDir);
            expect(result).toBeNull();
        });

        it('loads a valid module-graph.json', () => {
            const wikiDir = path.join(tmpDir, 'wiki');
            const graph = makeGraph({ architectureNotes: 'loaded' });
            writeGraph(wikiDir, graph);

            const result = loadWikiGraph(wikiDir);
            expect(result).not.toBeNull();
            expect(result!.architectureNotes).toBe('loaded');
            expect(result!.components).toEqual([]);
        });
    });

    // ─── listThemeAreas ──────────────────────────────────────────────────

    describe('listThemeAreas', () => {
        it('returns empty array when wiki does not exist', () => {
            const result = listThemeAreas(path.join(tmpDir, 'nonexistent'));
            expect(result).toEqual([]);
        });

        it('reads themes from module-graph.json', () => {
            const wikiDir = path.join(tmpDir, 'wiki');
            const graph = makeGraph({
                themes: [{
                    id: 'compaction',
                    title: 'Compaction',
                    description: 'LSM compaction',
                    layout: 'area',
                    articles: [{ slug: 'index', title: 'compaction', path: 'themes/compaction/index.md' }],
                    involvedComponentIds: ['compaction-picker'],
                    directoryPath: 'themes/compaction',
                    generatedAt: 1000
                }]
            });
            writeGraph(wikiDir, graph);

            const result = listThemeAreas(wikiDir);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('compaction');
            expect(result[0].generatedAt).toBe(1000);
        });

        it('reads themes from filesystem themes/ directory', () => {
            const wikiDir = path.join(tmpDir, 'wiki');
            writeGraph(wikiDir, makeGraph());

            // Single-article theme
            const themesDir = path.join(wikiDir, 'themes');
            fs.mkdirSync(themesDir, { recursive: true });
            fs.writeFileSync(path.join(themesDir, 'auth.md'), '# Auth theme', 'utf-8');

            // Multi-article theme area
            const compactionDir = path.join(themesDir, 'compaction');
            fs.mkdirSync(compactionDir, { recursive: true });
            fs.writeFileSync(path.join(compactionDir, 'index.md'), '# Compaction', 'utf-8');
            fs.writeFileSync(path.join(compactionDir, 'leveled.md'), '# Leveled', 'utf-8');

            const result = listThemeAreas(wikiDir);
            expect(result).toHaveLength(2);

            const auth = result.find(t => t.id === 'auth');
            expect(auth).toBeDefined();
            expect(auth!.layout).toBe('single');
            expect(auth!.articles).toHaveLength(1);

            const compaction = result.find(t => t.id === 'compaction');
            expect(compaction).toBeDefined();
            expect(compaction!.layout).toBe('area');
            expect(compaction!.articles).toHaveLength(2);
        });

        it('merges graph and filesystem, graph takes precedence', () => {
            const wikiDir = path.join(tmpDir, 'wiki');
            const graph = makeGraph({
                themes: [{
                    id: 'compaction',
                    title: 'Compaction (from graph)',
                    description: 'From graph',
                    layout: 'area',
                    articles: [],
                    involvedComponentIds: [],
                    directoryPath: 'themes/compaction',
                    generatedAt: 2000
                }]
            });
            writeGraph(wikiDir, graph);

            // Also exists on filesystem
            const compactionDir = path.join(wikiDir, 'themes', 'compaction');
            fs.mkdirSync(compactionDir, { recursive: true });
            fs.writeFileSync(path.join(compactionDir, 'index.md'), '# Compaction', 'utf-8');

            // And a filesystem-only theme
            fs.writeFileSync(path.join(wikiDir, 'themes', 'bloom.md'), '# Bloom', 'utf-8');

            const result = listThemeAreas(wikiDir);
            expect(result).toHaveLength(2);

            const compaction = result.find(t => t.id === 'compaction');
            expect(compaction!.title).toBe('Compaction (from graph)');
            expect(compaction!.generatedAt).toBe(2000);

            const bloom = result.find(t => t.id === 'bloom');
            expect(bloom).toBeDefined();
        });
    });

    // ─── checkThemeCoverage ──────────────────────────────────────────────

    describe('checkThemeCoverage', () => {
        it('returns "exists" when theme ID exactly matches', () => {
            const graph = makeGraph({
                themes: [{
                    id: 'compaction',
                    title: 'Compaction',
                    description: 'LSM compaction',
                    layout: 'area',
                    articles: [{ slug: 'index', title: 'Compaction', path: 'themes/compaction/index.md' }],
                    involvedComponentIds: ['compaction-picker', 'compaction-job'],
                    directoryPath: 'themes/compaction',
                    generatedAt: 1000
                }],
                components: [
                    { id: 'compaction-picker', name: 'Compaction Picker', path: 'src/compaction/', purpose: 'Picks compaction candidates', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
                    { id: 'compaction-job', name: 'Compaction Job', path: 'src/compaction/', purpose: 'Runs compaction jobs', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' }
                ]
            });
            const theme: ThemeRequest = { theme: 'compaction' };

            const result = checkThemeCoverage(theme, graph, tmpDir);
            expect(result.status).toBe('exists');
            expect(result.existingArticlePath).toBe('themes/compaction/index.md');
            expect(result.relatedComponents).toHaveLength(2);
            expect(result.relatedComponents.every(m => m.relevance === 'high')).toBe(true);
        });

        it('returns "partial" when multiple modules match by name', () => {
            const graph = makeGraph({
                components: [
                    { id: 'compaction-picker', name: 'Compaction Picker', path: 'src/compaction/', purpose: 'Picks compaction candidates', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
                    { id: 'compaction-job', name: 'Compaction Job', path: 'src/compaction/', purpose: 'Runs compaction jobs', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
                    { id: 'storage-engine', name: 'Storage Engine', path: 'src/storage/', purpose: 'Core storage engine', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' }
                ]
            });
            const theme: ThemeRequest = { theme: 'compaction' };

            const result = checkThemeCoverage(theme, graph, tmpDir);
            expect(result.status).toBe('partial');
            expect(result.relatedComponents.length).toBeGreaterThanOrEqual(2);
            const compactionModules = result.relatedComponents.filter(m => m.componentId.includes('compaction'));
            expect(compactionModules.length).toBe(2);
        });

        it('returns "new" when no modules match', () => {
            const graph = makeGraph({
                components: [
                    { id: 'auth', name: 'Authentication', path: 'src/auth/', purpose: 'User authentication', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
                    { id: 'database', name: 'Database', path: 'src/db/', purpose: 'Database layer', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' }
                ]
            });
            const theme: ThemeRequest = { theme: 'bloom-filters' };

            const result = checkThemeCoverage(theme, graph, tmpDir);
            expect(result.status).toBe('new');
            expect(result.relatedComponents).toHaveLength(0);
        });

        it('returns "new" when wiki directory does not exist', () => {
            const graph = makeGraph();
            const theme: ThemeRequest = { theme: 'anything' };

            const result = checkThemeCoverage(theme, graph, path.join(tmpDir, 'nonexistent'));
            expect(result.status).toBe('new');
            expect(result.relatedComponents).toEqual([]);
        });

        it('considers article content for low-relevance matching', () => {
            const wikiDir = path.join(tmpDir, 'wiki');
            const graph = makeGraph({
                components: [
                    { id: 'storage', name: 'Storage', path: 'src/storage/', purpose: 'Core storage engine', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' }
                ]
            });
            writeGraph(wikiDir, graph);

            // Write article content mentioning bloom filters
            const modulesDir = path.join(wikiDir, 'modules');
            fs.mkdirSync(modulesDir, { recursive: true });
            fs.writeFileSync(
                path.join(modulesDir, 'storage.md'),
                '# Storage Engine\n\nUses bloom filters for fast lookups.',
                'utf-8'
            );

            const theme: ThemeRequest = { theme: 'bloom-filters' };
            const result = checkThemeCoverage(theme, graph, wikiDir);

            // Should find the storage module as related (low relevance from article content)
            const storageMatch = result.relatedComponents.find(m => m.componentId === 'storage');
            expect(storageMatch).toBeDefined();
        });

        it('uses description and hints for broader matching', () => {
            const graph = makeGraph({
                components: [
                    { id: 'wal', name: 'Write Ahead Log', path: 'src/wal/', purpose: 'Write-ahead logging for crash recovery', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' },
                    { id: 'recovery', name: 'Recovery Manager', path: 'src/recovery/', purpose: 'Handles crash recovery using WAL', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' }
                ]
            });
            const theme: ThemeRequest = {
                theme: 'crash-safety',
                description: 'How the system recovers from crashes using write-ahead logging',
                hints: ['wal', 'recovery']
            };

            const result = checkThemeCoverage(theme, graph, tmpDir);
            expect(result.relatedComponents.length).toBeGreaterThanOrEqual(2);

            const walMatch = result.relatedComponents.find(m => m.componentId === 'wal');
            const recoveryMatch = result.relatedComponents.find(m => m.componentId === 'recovery');
            expect(walMatch).toBeDefined();
            expect(recoveryMatch).toBeDefined();
        });

        it('handles graph with no themes field', () => {
            const graph = makeGraph({
                components: [
                    { id: 'auth', name: 'Auth', path: 'src/auth/', purpose: 'Authentication', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' }
                ]
            });
            // Explicitly no themes
            delete (graph as any).themes;

            const theme: ThemeRequest = { theme: 'auth' };
            const result = checkThemeCoverage(theme, graph, tmpDir);
            // Should match module by name, not find existing theme
            expect(result.status).not.toBe('exists');
            expect(result.relatedComponents.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ─── tokenize ────────────────────────────────────────────────────────

    describe('tokenize', () => {
        it('splits kebab-case theme names', () => {
            const tokens = tokenize('bloom-filters', undefined, undefined);
            expect(tokens).toContain('bloom');
            expect(tokens).toContain('filters');
        });

        it('includes description keywords', () => {
            const tokens = tokenize('compaction', 'LSM tree compaction strategy', undefined);
            expect(tokens).toContain('compaction');
            expect(tokens).toContain('lsm');
            expect(tokens).toContain('tree');
            expect(tokens).toContain('strategy');
        });

        it('includes hints', () => {
            const tokens = tokenize('safety', undefined, ['wal', 'crash-recovery']);
            expect(tokens).toContain('wal');
            expect(tokens).toContain('crash');
            expect(tokens).toContain('recovery');
        });

        it('removes stopwords', () => {
            const tokens = tokenize('the-big-module', 'a module for the system', undefined);
            expect(tokens).not.toContain('the');
            expect(tokens).not.toContain('a');
            expect(tokens).not.toContain('for');
            expect(tokens).toContain('big');
            expect(tokens).toContain('module');
            expect(tokens).toContain('system');
        });

        it('deduplicates tokens', () => {
            const tokens = tokenize('bloom', 'bloom filter using bloom', undefined);
            const bloomCount = tokens.filter(t => t === 'bloom').length;
            expect(bloomCount).toBe(1);
        });
    });
});
