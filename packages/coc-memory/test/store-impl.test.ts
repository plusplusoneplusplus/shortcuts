/**
 * AC-02 Tests: Facts, Episodes, and Scope Model
 *
 * Covers:
 * 1. Create a global fact → visible from workspace in global mode.
 * 2. Isolated workspace creates a fact → global search cannot see it;
 *    isolated workspace cannot see global facts.
 * 3. Episode linked to a process → link can be resolved.
 * 4. Mode toggle → no automatic migration or copy.
 * 5. CRUD operations (update, delete, recordRecall, wipe, export).
 * 6. BM25 search returns relevant results, vectorScore is null in v1.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMemoryStores } from '../src/store-impl/store-factory';
import { MemoryScopeResolver } from '../src/scope-resolver';
import type { MemoryEpisodeInput, MemoryFactInput } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
    return mkdtempSync(join(tmpdir(), 'coc-memory-ac02-'));
}

const GLOBAL_FACT: MemoryFactInput = {
    scope: 'global',
    content: 'TypeScript strict mode is always enabled in this project',
    importance: 0.8,
    confidence: 0.9,
    status: 'active',
    tags: ['typescript', 'config'],
    source: 'explicit',
};

const WS_FACT = (workspaceId: string): MemoryFactInput => ({
    scope: 'workspace',
    workspaceId,
    content: 'Workspace-specific deployment target is Kubernetes',
    importance: 0.7,
    confidence: 0.85,
    status: 'active',
    tags: ['deploy', 'k8s'],
    source: 'explicit',
});

const EPISODE_INPUT: MemoryEpisodeInput = {
    scope: 'global',
    processId: 'proc-abc-123',
    sessionId: 'sess-456',
    summary: 'Discussed TypeScript migration strategy and agreed on strict mode',
    eventType: 'chat-turn',
    provenance: { createdBy: 'ai', model: 'claude-3-5-sonnet', version: 1 },
};

// ---------------------------------------------------------------------------
// SqliteFactStore unit tests
// ---------------------------------------------------------------------------

describe('SqliteFactStore — CRUD', () => {
    let tmpDir: string;
    let stores: ReturnType<typeof createMemoryStores>;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        stores = createMemoryStores(tmpDir);
    });

    afterEach(() => {
        stores.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('adds a fact and returns it with generated id and timestamps', async () => {
        const fact = await stores.facts.addFact(GLOBAL_FACT);
        expect(fact.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(fact.content).toBe(GLOBAL_FACT.content);
        expect(fact.scope).toBe('global');
        expect(fact.recalledCount).toBe(0);
        expect(fact.createdAt).toBeTruthy();
        expect(fact.updatedAt).toBe(fact.createdAt);
        expect(fact.tags).toEqual(['typescript', 'config']);
    });

    it('retrieves a fact by id', async () => {
        const added = await stores.facts.addFact(GLOBAL_FACT);
        const retrieved = await stores.facts.getFact(added.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(added.id);
        expect(retrieved!.content).toBe(GLOBAL_FACT.content);
    });

    it('returns null for unknown id', async () => {
        const result = await stores.facts.getFact('nonexistent-id');
        expect(result).toBeNull();
    });

    it('updates a fact and bumps updatedAt', async () => {
        const fact = await stores.facts.addFact(GLOBAL_FACT);
        // Ensure at least 1ms passes so updatedAt differs
        await new Promise(r => setTimeout(r, 5));
        const updated = await stores.facts.updateFact(fact.id, {
            content: 'Updated content',
            importance: 0.95,
            tags: ['typescript', 'config', 'updated'],
        });
        expect(updated).not.toBeNull();
        expect(updated!.content).toBe('Updated content');
        expect(updated!.importance).toBe(0.95);
        expect(updated!.tags).toContain('updated');
        expect(updated!.updatedAt > fact.updatedAt).toBe(true);
    });

    it('returns null when updating a non-existent fact', async () => {
        const result = await stores.facts.updateFact('no-such-id', { content: 'x' });
        expect(result).toBeNull();
    });

    it('deletes a fact and returns true', async () => {
        const fact = await stores.facts.addFact(GLOBAL_FACT);
        const deleted = await stores.facts.deleteFact(fact.id);
        expect(deleted).toBe(true);
        expect(await stores.facts.getFact(fact.id)).toBeNull();
    });

    it('returns false when deleting a non-existent fact', async () => {
        expect(await stores.facts.deleteFact('ghost')).toBe(false);
    });

    it('records recall: increments count and sets lastRecalledAt', async () => {
        const fact = await stores.facts.addFact(GLOBAL_FACT);
        expect(fact.recalledCount).toBe(0);
        await stores.facts.recordRecall([fact.id]);
        const updated = await stores.facts.getFact(fact.id);
        expect(updated!.recalledCount).toBe(1);
        expect(updated!.lastRecalledAt).toBeTruthy();
        // Second recall
        await stores.facts.recordRecall([fact.id]);
        const updated2 = await stores.facts.getFact(fact.id);
        expect(updated2!.recalledCount).toBe(2);
    });

    it('recordRecall handles empty id list gracefully', async () => {
        await expect(stores.facts.recordRecall([])).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// List / filter
// ---------------------------------------------------------------------------

describe('SqliteFactStore — list & filter', () => {
    let tmpDir: string;
    let stores: ReturnType<typeof createMemoryStores>;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        stores = createMemoryStores(tmpDir);
    });

    afterEach(() => {
        stores.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('lists facts filtered by scope=global', async () => {
        await stores.facts.addFact(GLOBAL_FACT);
        await stores.facts.addFact(WS_FACT('ws-1'));

        const globalFacts = await stores.facts.listFacts({ scope: 'global' });
        expect(globalFacts).toHaveLength(1);
        expect(globalFacts[0].scope).toBe('global');
    });

    it('lists facts filtered by scope=workspace + workspaceId', async () => {
        await stores.facts.addFact(WS_FACT('ws-A'));
        await stores.facts.addFact(WS_FACT('ws-B'));
        await stores.facts.addFact(GLOBAL_FACT);

        const wsA = await stores.facts.listFacts({ scope: 'workspace', workspaceId: 'ws-A' });
        expect(wsA).toHaveLength(1);
        expect(wsA[0].workspaceId).toBe('ws-A');
    });

    it('lists facts filtered by status', async () => {
        await stores.facts.addFact({ ...GLOBAL_FACT, status: 'active' });
        await stores.facts.addFact({ ...GLOBAL_FACT, status: 'review' });
        await stores.facts.addFact({ ...GLOBAL_FACT, status: 'archived' });

        const active = await stores.facts.listFacts({ statuses: ['active'] });
        expect(active).toHaveLength(1);

        const reviewAndActive = await stores.facts.listFacts({ statuses: ['active', 'review'] });
        expect(reviewAndActive).toHaveLength(2);
    });

    it('filters facts by tags post-query', async () => {
        await stores.facts.addFact({ ...GLOBAL_FACT, tags: ['typescript', 'config'] });
        await stores.facts.addFact({ ...GLOBAL_FACT, tags: ['python'] });

        const tsOnly = await stores.facts.listFacts({ tags: ['typescript'] });
        expect(tsOnly).toHaveLength(1);
        expect(tsOnly[0].tags).toContain('typescript');
    });

    it('respects limit and offset', async () => {
        for (let i = 0; i < 5; i++) {
            await stores.facts.addFact({ ...GLOBAL_FACT, content: `Fact ${i}` });
        }
        const first3 = await stores.facts.listFacts({ limit: 3 });
        expect(first3).toHaveLength(3);

        const next2 = await stores.facts.listFacts({ limit: 3, offset: 3 });
        expect(next2).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// BM25 search (AC-03 vector part is added later; this covers BM25-only path)
// ---------------------------------------------------------------------------

describe('SqliteFactStore — BM25 search', () => {
    let tmpDir: string;
    let stores: ReturnType<typeof createMemoryStores>;

    beforeEach(async () => {
        tmpDir = makeTmpDir();
        stores = createMemoryStores(tmpDir);
        await stores.facts.addFact({
            scope: 'global',
            content: 'TypeScript strict mode enables better type safety',
            importance: 0.8,
            confidence: 0.9,
            status: 'active',
            tags: ['typescript'],
            source: 'explicit',
        });
        await stores.facts.addFact({
            scope: 'global',
            content: 'Python is a dynamically typed language',
            importance: 0.5,
            confidence: 0.8,
            status: 'active',
            tags: ['python'],
            source: 'explicit',
        });
        await stores.facts.addFact({
            scope: 'global',
            content: 'SQL databases use structured query language',
            importance: 0.4,
            confidence: 0.9,
            status: 'review',
            tags: ['database'],
            source: 'auto-extracted',
        });
    });

    afterEach(() => {
        stores.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns relevant results for BM25 query', async () => {
        const results = await stores.facts.searchFacts({ text: 'TypeScript', scope: 'global' });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].fact.content).toContain('TypeScript');
        expect(results[0].bm25Score).toBeGreaterThan(0);
    });

    it('vectorScore is null (BM25-only mode)', async () => {
        const results = await stores.facts.searchFacts({ text: 'TypeScript' });
        for (const r of results) {
            expect(r.vectorScore).toBeNull();
        }
    });

    it('defaults to status=active and excludes review items', async () => {
        const results = await stores.facts.searchFacts({ text: 'SQL' });
        expect(results.every(r => r.fact.status === 'active')).toBe(true);
    });

    it('includes review items when explicitly requested', async () => {
        const results = await stores.facts.searchFacts({
            text: 'SQL',
            statuses: ['active', 'review'],
        });
        expect(results.some(r => r.fact.status === 'review')).toBe(true);
    });

    it('returns empty array for bad FTS5 query syntax', async () => {
        const results = await stores.facts.searchFacts({ text: '"unclosed' });
        expect(results).toEqual([]);
    });

    it('respects the limit parameter', async () => {
        const results = await stores.facts.searchFacts({ text: 'language OR mode OR type', limit: 1 });
        expect(results.length).toBeLessThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// Wipe & export
// ---------------------------------------------------------------------------

describe('SqliteFactStore — wipe & export', () => {
    let tmpDir: string;
    let stores: ReturnType<typeof createMemoryStores>;

    beforeEach(async () => {
        tmpDir = makeTmpDir();
        stores = createMemoryStores(tmpDir);
        await stores.facts.addFact(GLOBAL_FACT);
        await stores.facts.addFact(WS_FACT('ws-wipe'));
    });

    afterEach(() => {
        stores.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('wipe(global) removes only global facts', async () => {
        await stores.facts.wipe('global');
        expect(await stores.facts.listFacts({ scope: 'global' })).toHaveLength(0);
        // workspace fact is untouched
        expect(await stores.facts.listFacts({ scope: 'workspace', workspaceId: 'ws-wipe' })).toHaveLength(1);
    });

    it('wipe(workspace) removes only the specified workspace facts', async () => {
        await stores.facts.addFact(WS_FACT('ws-other'));
        await stores.facts.wipe('workspace', 'ws-wipe');

        expect(await stores.facts.listFacts({ scope: 'workspace', workspaceId: 'ws-wipe' })).toHaveLength(0);
        expect(await stores.facts.listFacts({ scope: 'workspace', workspaceId: 'ws-other' })).toHaveLength(1);
        expect(await stores.facts.listFacts({ scope: 'global' })).toHaveLength(1);
    });

    it('exportFacts returns all global facts with full metadata', async () => {
        const exported = await stores.facts.exportFacts('global');
        expect(exported).toHaveLength(1);
        expect(exported[0].content).toBe(GLOBAL_FACT.content);
        expect(exported[0].tags).toEqual(GLOBAL_FACT.tags);
        expect(exported[0].provenance).toBeUndefined(); // facts don't have provenance field
    });

    it('exportFacts returns only the specified workspace facts', async () => {
        await stores.facts.addFact(WS_FACT('ws-other'));
        const exported = await stores.facts.exportFacts('workspace', 'ws-wipe');
        expect(exported).toHaveLength(1);
        expect(exported[0].workspaceId).toBe('ws-wipe');
    });
});

// ---------------------------------------------------------------------------
// SqliteEpisodeStore
// ---------------------------------------------------------------------------

describe('SqliteEpisodeStore', () => {
    let tmpDir: string;
    let stores: ReturnType<typeof createMemoryStores>;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        stores = createMemoryStores(tmpDir);
    });

    afterEach(() => {
        stores.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('adds an episode with generated id and createdAt', async () => {
        const ep = await stores.episodes.addEpisode(EPISODE_INPUT);
        expect(ep.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(ep.processId).toBe('proc-abc-123');
        expect(ep.createdAt).toBeTruthy();
        expect(ep.provenance.model).toBe('claude-3-5-sonnet');
    });

    it('retrieves an episode by id', async () => {
        const ep = await stores.episodes.addEpisode(EPISODE_INPUT);
        const retrieved = await stores.episodes.getEpisode(ep.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.summary).toBe(EPISODE_INPUT.summary);
        expect(retrieved!.provenance.createdBy).toBe('ai');
    });

    it('returns null for unknown episode id', async () => {
        expect(await stores.episodes.getEpisode('no-such-id')).toBeNull();
    });

    it('lists episodes by processId', async () => {
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, processId: 'proc-1' });
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, processId: 'proc-2' });

        const proc1Eps = await stores.episodes.listEpisodes({ processId: 'proc-1' });
        expect(proc1Eps).toHaveLength(1);
        expect(proc1Eps[0].processId).toBe('proc-1');
    });

    it('lists episodes filtered by scope', async () => {
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, scope: 'global' });
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, scope: 'workspace', workspaceId: 'ws-ep' });

        const globalEps = await stores.episodes.listEpisodes({ scope: 'global' });
        expect(globalEps).toHaveLength(1);
        expect(globalEps[0].scope).toBe('global');
    });

    it('lists episodes filtered by eventType', async () => {
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, eventType: 'chat-turn' });
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, eventType: 'ralph-iteration' });

        const chatEps = await stores.episodes.listEpisodes({ eventTypes: ['chat-turn'] });
        expect(chatEps).toHaveLength(1);
        expect(chatEps[0].eventType).toBe('chat-turn');
    });

    it('preserves optional fields: ralphId, turnIndex, iterationIndex', async () => {
        const ep = await stores.episodes.addEpisode({
            ...EPISODE_INPUT,
            ralphId: 'ralph-session-42',
            turnIndex: 3,
            iterationIndex: 7,
            eventType: 'ralph-iteration',
        });
        const retrieved = await stores.episodes.getEpisode(ep.id);
        expect(retrieved!.ralphId).toBe('ralph-session-42');
        expect(retrieved!.turnIndex).toBe(3);
        expect(retrieved!.iterationIndex).toBe(7);
    });

    it('wipe(global) removes only global episodes', async () => {
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, scope: 'global' });
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, scope: 'workspace', workspaceId: 'ws-ep' });

        await stores.episodes.wipe('global');

        expect(await stores.episodes.listEpisodes({ scope: 'global' })).toHaveLength(0);
        expect(await stores.episodes.listEpisodes({ scope: 'workspace', workspaceId: 'ws-ep' })).toHaveLength(1);
    });

    it('exportEpisodes returns all for the given scope', async () => {
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, scope: 'global' });
        await stores.episodes.addEpisode({ ...EPISODE_INPUT, scope: 'workspace', workspaceId: 'ws-ep' });

        const exported = await stores.episodes.exportEpisodes('global');
        expect(exported).toHaveLength(1);
        expect(exported[0].scope).toBe('global');
    });
});

// ---------------------------------------------------------------------------
// MemoryScopeResolver — AC-02 Definition of Done scenarios
// ---------------------------------------------------------------------------

describe('MemoryScopeResolver — scope isolation', () => {
    let tmpDir: string;
    let resolver: MemoryScopeResolver;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        resolver = new MemoryScopeResolver();
    });

    afterEach(() => {
        resolver.closeAll();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    // AC-02 DoD #1: global fact visible from workspace in global mode
    it('global fact is visible from a workspace using global mode', async () => {
        const storeWsA = resolver.resolve({ dataDir: tmpDir, workspaceId: 'ws-A', isolated: false });
        await storeWsA.facts.addFact(GLOBAL_FACT);

        // ws-B in global mode shares the same store
        const storeWsB = resolver.resolve({ dataDir: tmpDir, workspaceId: 'ws-B', isolated: false });
        const facts = await storeWsB.facts.listFacts({ scope: 'global' });
        expect(facts).toHaveLength(1);
        expect(facts[0].content).toBe(GLOBAL_FACT.content);
    });

    // AC-02 DoD #2a: isolated workspace fact is NOT visible to global search
    it('isolated workspace fact is invisible to global search', async () => {
        const isolatedStore = resolver.resolve({ dataDir: tmpDir, workspaceId: 'ws-isolated', isolated: true });
        await isolatedStore.facts.addFact(WS_FACT('ws-isolated'));

        const globalStore = resolver.resolveGlobal(tmpDir);
        const globalFacts = await globalStore.facts.listFacts();
        expect(globalFacts.every(f => f.workspaceId !== 'ws-isolated')).toBe(true);
    });

    // AC-02 DoD #2b: isolated workspace cannot see global facts (different DB file)
    it('isolated workspace cannot see global facts (separate store)', async () => {
        const globalStore = resolver.resolveGlobal(tmpDir);
        await globalStore.facts.addFact(GLOBAL_FACT);

        const isolatedStore = resolver.resolve({ dataDir: tmpDir, workspaceId: 'ws-isolated', isolated: true });
        const wsFacts = await isolatedStore.facts.listFacts();
        expect(wsFacts).toHaveLength(0);
    });

    // AC-02 DoD #3: episode linked to a process can be resolved
    it('episode linked to a process can be retrieved by processId', async () => {
        const store = resolver.resolveGlobal(tmpDir);
        const ep = await store.episodes.addEpisode({
            ...EPISODE_INPUT,
            processId: 'unique-proc-xyz',
        });

        const found = await store.episodes.listEpisodes({ processId: 'unique-proc-xyz' });
        expect(found).toHaveLength(1);
        expect(found[0].id).toBe(ep.id);
        expect(found[0].summary).toBe(EPISODE_INPUT.summary);
    });

    // AC-02 DoD #4: toggling modes does NOT migrate memory
    it('no automatic migration when switching from isolated to global mode', async () => {
        // Create an isolated workspace fact
        const isolatedStore = resolver.resolve({ dataDir: tmpDir, workspaceId: 'ws-C', isolated: true });
        await isolatedStore.facts.addFact(WS_FACT('ws-C'));

        // Simulate switching to global mode (different resolver call — no migration code)
        const globalStore = resolver.resolve({ dataDir: tmpDir, workspaceId: 'ws-C', isolated: false });
        const globalFacts = await globalStore.facts.listFacts({ scope: 'global' });

        // The fact must NOT have been migrated
        expect(globalFacts.every(f => f.content !== WS_FACT('ws-C').content)).toBe(true);
    });

    it('resolveDir returns expected paths', () => {
        const globalDir = resolver.resolveDir({ dataDir: '/data', workspaceId: 'ws-X', isolated: false });
        expect(globalDir).toMatch(/memory[/\\]global$/);

        const isolatedDir = resolver.resolveDir({ dataDir: '/data', workspaceId: 'ws-X', isolated: true });
        expect(isolatedDir).toMatch(/repos[/\\]ws-X[/\\]memory$/);
    });
});
