import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ModuleGraph, TopicAreaMeta } from '../../src/types';
import {
    updateModuleGraph,
    updateWikiIndex,
    addCrossLinks,
} from '../../src/topic/wiki-integrator';

// ─── Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'topic-wi-'));
}

function makeGraph(overrides: Partial<ModuleGraph> = {}): ModuleGraph {
    return {
        project: { name: 'test', description: 'test project', language: 'TypeScript', rootPath: '/test' } as ModuleGraph['project'],
        modules: [],
        categories: [],
        architectureNotes: '',
        ...overrides,
    };
}

function makeTopicMeta(overrides: Partial<TopicAreaMeta> = {}): TopicAreaMeta {
    return {
        id: 'compaction',
        title: 'Log Compaction',
        description: 'How log compaction works',
        layout: 'area',
        articles: [
            { slug: 'index', title: 'Overview', path: 'topics/compaction/index.md' },
            { slug: 'storage', title: 'Storage', path: 'topics/compaction/storage.md' },
        ],
        involvedModuleIds: ['mod-a', 'mod-b'],
        directoryPath: 'topics/compaction',
        generatedAt: 1700000000000,
        ...overrides,
    };
}

function writeGraph(dir: string, graph: ModuleGraph): void {
    fs.writeFileSync(path.join(dir, 'module-graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
}

function readGraph(dir: string): ModuleGraph {
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
    it('adds topic to existing graph with no topics', () => {
        const graph = makeGraph();
        writeGraph(tmpDir, graph);

        const meta = makeTopicMeta();
        updateModuleGraph(tmpDir, meta);

        const updated = readGraph(tmpDir);
        expect(updated.topics).toHaveLength(1);
        expect(updated.topics![0].id).toBe('compaction');
        expect(updated.topics![0].title).toBe('Log Compaction');
    });

    it('replaces existing topic entry (same id)', () => {
        const graph = makeGraph({
            topics: [makeTopicMeta({ title: 'Old Title' })],
        });
        writeGraph(tmpDir, graph);

        const meta = makeTopicMeta({ title: 'New Title' });
        updateModuleGraph(tmpDir, meta);

        const updated = readGraph(tmpDir);
        expect(updated.topics).toHaveLength(1);
        expect(updated.topics![0].title).toBe('New Title');
    });

    it('preserves other topics when adding new one', () => {
        const graph = makeGraph({
            topics: [makeTopicMeta({ id: 'caching', title: 'Caching' })],
        });
        writeGraph(tmpDir, graph);

        const meta = makeTopicMeta({ id: 'compaction', title: 'Log Compaction' });
        updateModuleGraph(tmpDir, meta);

        const updated = readGraph(tmpDir);
        expect(updated.topics).toHaveLength(2);
        expect(updated.topics!.map(t => t.id)).toEqual(['caching', 'compaction']);
    });

    it('creates graph file if it does not exist', () => {
        const meta = makeTopicMeta();
        updateModuleGraph(tmpDir, meta);

        const created = readGraph(tmpDir);
        expect(created.topics).toHaveLength(1);
        expect(created.topics![0].id).toBe('compaction');
    });

    it('preserves existing graph fields', () => {
        const graph = makeGraph({
            architectureNotes: 'Important notes',
            modules: [{ id: 'mod-x', name: 'Module X' }] as any,
        });
        writeGraph(tmpDir, graph);

        updateModuleGraph(tmpDir, makeTopicMeta());

        const updated = readGraph(tmpDir);
        expect(updated.architectureNotes).toBe('Important notes');
        expect(updated.modules).toHaveLength(1);
    });
});

// ─── updateWikiIndex Tests ─────────────────────────────────────────────

describe('updateWikiIndex', () => {
    it('adds Topics section when index has no Topics section', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n\nWelcome to the wiki.\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');

        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('## Topics');
        expect(content).toContain('- [Log Compaction](./topics/compaction/index.md)');
    });

    it('appends to existing Topics section', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n\n## Topics\n- [Caching](./topics/caching/index.md)\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'area');

        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('- [Log Compaction](./topics/compaction/index.md)');
        expect(content).toContain('- [Caching](./topics/caching/index.md)');
    });

    it('uses single-file link for single layout', () => {
        const indexPath = path.join(tmpDir, 'index.md');
        fs.writeFileSync(indexPath, '# My Wiki\n', 'utf-8');

        updateWikiIndex(tmpDir, 'compaction', 'Log Compaction', 'single');

        const content = fs.readFileSync(indexPath, 'utf-8');
        expect(content).toContain('- [Log Compaction](./topics/compaction.md)');
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
        expect(content).toContain('## Topics');
    });
});

// ─── addCrossLinks Tests ───────────────────────────────────────────────

describe('addCrossLinks', () => {
    it('adds Related Topics section to module article', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(path.join(modulesDir, 'mod-a.md'), '# Module A\n\nContent.\n', 'utf-8');

        const result = addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');

        expect(result.updatedFiles).toHaveLength(1);
        const content = fs.readFileSync(path.join(modulesDir, 'mod-a.md'), 'utf-8');
        expect(content).toContain('## Related Topics');
        expect(content).toContain('- [Log Compaction](../topics/compaction/index.md)');
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
        expect(content).toContain('- [Log Compaction](../topics/compaction.md)');
    });

    it('handles missing modules/ directory gracefully', () => {
        // No modules/ directory exists
        const result = addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');
        expect(result.updatedFiles).toHaveLength(0);
    });

    it('appends to existing Related Topics section', () => {
        const modulesDir = path.join(tmpDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(modulesDir, 'mod-a.md'),
            '# Module A\n\n## Related Topics\n- [Caching](../topics/caching/index.md)\n',
            'utf-8',
        );

        addCrossLinks(tmpDir, 'compaction', 'Log Compaction', ['mod-a'], 'area');

        const content = fs.readFileSync(path.join(modulesDir, 'mod-a.md'), 'utf-8');
        expect(content).toContain('- [Caching](../topics/caching/index.md)');
        expect(content).toContain('- [Log Compaction](../topics/compaction/index.md)');
    });
});
