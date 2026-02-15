import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ComponentGraph, ThemeMeta } from '../../src/types';
import {
    updateModuleGraph,
    updateWikiIndex,
    addCrossLinks,
} from '../../src/theme/wiki-integrator';

// ─── Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'theme-wi-'));
}

function makeGraph(overrides: Partial<ComponentGraph> = {}): ComponentGraph {
    return {
        project: { name: 'test', description: 'test project', language: 'TypeScript', rootPath: '/test' } as ComponentGraph['project'],
        components: [],
        categories: [],
        architectureNotes: '',
        ...overrides,
    };
}

function makeThemeMeta(overrides: Partial<ThemeMeta> = {}): ThemeMeta {
    return {
        id: 'compaction',
        title: 'Log Compaction',
        description: 'How log compaction works',
        layout: 'area',
        articles: [
            { slug: 'index', title: 'Overview', path: 'themes/compaction/index.md' },
            { slug: 'storage', title: 'Storage', path: 'themes/compaction/storage.md' },
        ],
        involvedComponentIds: ['mod-a', 'mod-b'],
        directoryPath: 'themes/compaction',
        generatedAt: 1700000000000,
        ...overrides,
    };
}

function writeGraph(dir: string, graph: ComponentGraph): void {
    fs.writeFileSync(path.join(dir, 'module-graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
}

function readGraph(dir: string): ComponentGraph {
    return JSON.parse(fs.readFileSync(path.join(dir, 'module-graph.json'), 'utf-8'));
}

beforeEach(() => {
    tmpDir = makeTmpDir();
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── updateModuleGraph Tests ───────────────────────────────────────────

describe('updateModuleGraph', () => {
    it('adds theme to existing graph with no themes', () => {
        const graph = makeGraph();
        writeGraph(tmpDir, graph);

        const meta = makeThemeMeta();
        updateModuleGraph(tmpDir, meta);

        const updated = readGraph(tmpDir);
        expect(updated.themes).toHaveLength(1);
        expect(updated.themes![0].id).toBe('compaction');
        expect(updated.themes![0].title).toBe('Log Compaction');
    });

    it('replaces existing theme entry (same id)', () => {
        const graph = makeGraph({
            themes: [makeThemeMeta({ title: 'Old Title' })],
        });
        writeGraph(tmpDir, graph);

        const meta = makeThemeMeta({ title: 'New Title' });
        updateModuleGraph(tmpDir, meta);

        const updated = readGraph(tmpDir);
        expect(updated.themes).toHaveLength(1);
        expect(updated.themes![0].title).toBe('New Title');
    });

    it('preserves other themes when adding new one', () => {
        const graph = makeGraph({
            themes: [makeThemeMeta({ id: 'caching', title: 'Caching' })],
        });
        writeGraph(tmpDir, graph);

        const meta = makeThemeMeta({ id: 'compaction', title: 'Log Compaction' });
        updateModuleGraph(tmpDir, meta);

        const updated = readGraph(tmpDir);
        expect(updated.themes).toHaveLength(2);
        expect(updated.themes!.map(t => t.id)).toEqual(['caching', 'compaction']);
    });

    it('creates graph file if it does not exist', () => {
        const meta = makeThemeMeta();
        updateModuleGraph(tmpDir, meta);

        const created = readGraph(tmpDir);
        expect(created.themes).toHaveLength(1);
        expect(created.themes![0].id).toBe('compaction');
    });

    it('preserves existing graph fields', () => {
        const graph = makeGraph({
            architectureNotes: 'Important notes',
            components: [{ id: 'mod-x', name: 'Module X' }] as any,
        });
        writeGraph(tmpDir, graph);

        updateModuleGraph(tmpDir, makeThemeMeta());

        const updated = readGraph(tmpDir);
        expect(updated.architectureNotes).toBe('Important notes');
        expect(updated.components).toHaveLength(1);
    });
});

// ─── updateWikiIndex Tests ─────────────────────────────────────────────

describe('updateWikiIndex', () => {
    it('adds Themes section when index has no Themes section', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n\nWelcome to the wiki.\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');

        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('## Themes');
        expect(content).toContain('- [Log Compaction](./themes/compaction/index.md)');
    });

    it('appends to existing Themes section', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n\n## Themes\n- [Caching](./themes/caching/index.md)\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');

        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('- [Log Compaction](./themes/compaction/index.md)');
        expect(content).toContain('- [Caching](./themes/caching/index.md)');
    });

    it('uses single-file link for single layout', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'single');

        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('- [Log Compaction](./themes/compaction.md)');
    });

    it('is idempotent — does not add duplicate links', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');
        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');

        const content = fs.readFileSync(indexPath, 'utf-8');
        const matches = content.match(/Log Compaction/g) || [];
        expect(matches).toHaveLength(1);
    });

    it('creates index.md if it does not exist', () => {
        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');

        const indexPath = path.join(tmpDir, 'index.md');
        expect(fs.existsSync(indexPath)).toBe(true);
        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('## Themes');
    });
});

// ─── addCrossLinks Tests ───────────────────────────────────────────────

describe('addCrossLinks', () => {
    it('adds Related Themes section to module article', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(path.join(modulesDir, 'mod-a.md'), '# Module A\n\nContent.\n', 'utf-8');

        const result = addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');

        expect(result.updatedFiles).toHaveLength(1);
        const content = fs.readFileSync(path.join(modulesDir, 'mod-a.md'), 'utf-8');
        expect(content).toContain('## Related Themes');
        expect(content).toContain('- [Log Compaction](../themes/compaction/index.md)');
    });

    it('is idempotent — no duplicate links', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(path.join(modulesDir, 'mod-a.md'), '# Module A\n\nContent.\n', 'utf-8');

        addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');
        const result2 = addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');

        // Second call should not update anything
        expect(result2.updatedFiles).toHaveLength(0);

        const content = fs.readFileSync(path.join(modulesDir, 'mod-a.md'), 'utf-8');
        const matches = content.match(/Log Compaction/g) || [];
        expect(matches).toHaveLength(1);
    });

    it('skips missing module articles gracefully', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        // mod-a exists, mod-b does not
        fs.writeFileSync(path.join(modulesDir, 'mod-a.md'), '# Module A\n', 'utf-8');

        const result = addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a', 'mod-b'], 'area');

        expect(result.updatedFiles).toHaveLength(1);
    });

    it('uses correct relative paths for single layout', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(path.join(modulesDir, 'mod-a.md'), '# Module A\n', 'utf-8');

        addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'single');

        const content = fs.readFileSync(path.join(modulesDir, 'mod-a.md'), 'utf-8');
        expect(content).toContain('- [Log Compaction](../themes/compaction.md)');
    });

    it('handles missing modules/ directory gracefully', () => {
        // No modules/ directory exists
        const result = addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');
        expect(result.updatedFiles).toHaveLength(0);
    });

    it('appends to existing Related Themes section', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(modulesDir, 'mod-a.md'),
            '# Module A\n\n## Related Themes\n- [Caching](../themes/caching/index.md)\n',
            'utf-8',
        );

        addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');

        const content = fs.readFileSync(path.join(modulesDir, 'mod-a.md'), 'utf-8');
        expect(content).toContain('- [Caching](../themes/caching/index.md)');
        expect(content).toContain('- [Log Compaction](../themes/compaction/index.md)');
    });
});
