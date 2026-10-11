import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    FileProcessStore, SqliteProcessStore, PAGE_TURNS, HistoryAwareProcessMap,
    type AIProcess, type ConversationTurn, type ProcessStore,
} from '../src/index';
import { initializeDatabase } from '../src/sqlite-schema';

const directories: string[] = [];
const stores: SqliteProcessStore[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    stores.splice(0).forEach(store => store.close());
    await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

function processFixture(count = 200): AIProcess {
    return {
        id: 'history', type: 'ai', status: 'completed', promptPreview: 'prompt',
        fullPrompt: 'prompt', startTime: new Date('2026-01-01'),
        metadata: { type: 'ai', workspaceId: 'ws-a' },
        conversationTurns: Array.from({ length: count }, (_, turnIndex): ConversationTurn => ({
            turnIndex, role: turnIndex % 2 ? 'assistant' : 'user',
            content: `turn ${turnIndex}`, timestamp: new Date('2026-01-01'),
        })),
    };
}

async function createStore(kind: 'sqlite' | 'file'): Promise<ProcessStore> {
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.history-test-'));
    directories.push(directory);
    if (kind === 'file') return new FileProcessStore({ dataDir: directory });
    const store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
    stores.push(store);
    return store;
}

describe.each(['sqlite', 'file'] as const)('%s history pages', kind => {
    it('pages 200 turns without duplicates and preserves the full response shape', async () => {
        const store = await createStore(kind);
        await store.addProcess(processFixture());
        const full = await store.getProcess('history');
        const page = (await store.getProcessHistory('history', 'ws-a'))!;
        expect(PAGE_TURNS).toBe(30);
        expect(page.page).toMatchObject({ oldestTurnIndex: 170, totalTurns: 200, historyRevision: 0, hasMore: true });
        expect(page.page.turns).toEqual(full!.conversationTurns!.slice(170));
        expect(page.process).toEqual({ ...full, conversationTurns: page.page.turns });
        expect(full).not.toHaveProperty('historyRevision');
        expect(full!.metadata).not.toHaveProperty('historyRevision');
        const indices: number[] = [];
        let cursor: number | undefined;
        for (;;) {
            const { page } = (await store.getProcessHistory('history', undefined, { beforeTurnIndex: cursor }))!;
            indices.unshift(...page.turns.map(turn => turn.turnIndex));
            if (!page.hasMore) break;
            cursor = page.oldestTurnIndex!;
        }
        expect(indices).toEqual(Array.from({ length: 200 }, (_, index) => index));
    });

    it('extends an assistant boundary by its immediate user, including the maximum limit', async () => {
        const store = await createStore(kind);
        await store.addProcess(processFixture(202));
        const page = (await store.getProcessHistory('history', 'ws-a', { limit: 30, beforeTurnIndex: 201 }))!.page;
        expect(page.turns).toHaveLength(31);
        expect(page.oldestTurnIndex).toBe(170);
        expect(page.turns[0].role).toBe('user');
        expect(page.turns.at(-1)!.turnIndex).toBe(200);
        const maximum = (await store.getProcessHistory('history', undefined, { limit: 200, beforeTurnIndex: 201 }))!.page;
        expect(maximum.turns).toHaveLength(201);
        expect(maximum.hasMore).toBe(false);
    });

    it.each([0, 1, 5])('handles short history of %s turns and empty cursors', async count => {
        const store = await createStore(kind);
        await store.addProcess(processFixture(count));
        const latest = (await store.getProcessHistory('history'))!.page;
        expect(latest.turns).toHaveLength(count);
        expect(latest.hasMore).toBe(false);
        expect(latest.oldestTurnIndex).toBe(count ? 0 : null);
        expect((await store.getProcessHistory('history', undefined, { beforeTurnIndex: 0 }))!.page)
            .toEqual({ turns: [], oldestTurnIndex: null, hasMore: false, totalTurns: count, historyRevision: 0 });
    });

    it('uses exact owners including the empty workspace and rejects unknown processes', async () => {
        const store = await createStore(kind);
        await store.addProcess(processFixture(2));
        expect(await store.getProcessHistory('history', 'ws-b')).toBeUndefined();
        expect(await store.getProcessHistory('history', '')).toBeUndefined();
        expect(await store.getProcessHistory('missing')).toBeUndefined();
        expect(await store.getProcessHistory('history')).toBeDefined();
    });

    it.each([
        { limit: 0 }, { limit: -1 }, { limit: 201 }, { limit: 1.5 }, { limit: NaN }, { limit: Infinity },
        { beforeTurnIndex: -1 }, { beforeTurnIndex: 0.5 }, { beforeTurnIndex: Number.MAX_SAFE_INTEGER + 1 },
    ])('validates options %j', async options => {
        const store = await createStore(kind);
        await expect(store.getProcessHistory('history', undefined, options)).rejects.toThrow(RangeError);
    });

    it('keeps appends, streaming writes and finalization stable; edits, truncation and compaction invalidate', async () => {
        const store = await createStore(kind);
        await store.addProcess(processFixture(2));
        const revision = async () => (await store.getProcessHistory('history'))!.page.historyRevision;
        await store.appendConversationTurn('history', turnIndex => ({
            turnIndex, role: 'user', content: 'follow-up', timestamp: new Date(),
        }));
        await store.upsertStreamingTurn('history', 'partial', true);
        await store.upsertStreamingTurn('history', 'more', true);
        expect(await revision()).toBe(0);
        await store.appendConversationTurn('history', turnIndex => ({
            turnIndex, role: 'assistant', content: 'final', timestamp: new Date(),
        }), { filterStreaming: true });
        expect(await revision()).toBe(0);
        await store.upsertStreamingTurn('history', 'partial', true);
        await store.upsertStreamingTurn('history', 'finalized', false);
        expect(await revision()).toBe(0);
        await store.updateTurnContent('history', 0, 'edited');
        const edited = await revision();
        expect(edited).toBeGreaterThan(0);
        await store.updateTurnContent('history', 0, 'edited');
        expect(await revision()).toBe(edited);
        await store.truncateConversationTurns('history', 2);
        expect(await revision()).toBeGreaterThan(edited);
        const truncated = await revision();
        const metadata = (await store.getProcess('history'))!.metadata!;
        await store.updateProcess('history', { metadata: { ...metadata, compaction: { state: 'running', priorStatus: 'completed' } } });
        expect(await revision()).toBe(truncated);
        await store.updateProcess('history', { metadata: { ...metadata, compaction: { state: 'completed', priorStatus: 'completed', completedAt: '2026-01-01' } } });
        expect(await revision()).toBeGreaterThan(truncated);
        if (kind === 'file') {
            const reopened = new FileProcessStore({ dataDir: directories.at(-1)! });
            expect((await reopened.getProcessHistory('history'))!.page.historyRevision).toBe(await revision());
        }
    });

    it('distinguishes an explicit live-turn edit from ordinary streaming and rolls back failed replacement', async () => {
        const store = await createStore(kind);
        await store.addProcess(processFixture(2));
        await store.upsertStreamingTurn('history', 'draft', true);
        await store.updateTurnContent('history', 2, 'edited draft');
        expect((await store.getProcessHistory('history'))!.page.historyRevision).toBe(1);
        await expect(store.appendConversationTurn('history', () => {
            throw new Error('failed finalization');
        }, { filterStreaming: true })).rejects.toThrow('failed finalization');
        const page = (await store.getProcessHistory('history'))!.page;
        expect(page.historyRevision).toBe(1);
        expect(page.turns.at(-1)).toMatchObject({ content: 'edited draft', streaming: true });
    });
});

describe('SQLite history isolation', () => {
    it('reads process, count, page and revision from one snapshot during another writer commit', async () => {
        const store = await createStore('sqlite') as SqliteProcessStore;
        await store.addProcess(processFixture());
        const writer = new SqliteProcessStore({ dbPath: path.join(directories.at(-1)!, 'processes.db') });
        stores.push(writer);
        const statement = (store as unknown as { getProcessStmt: { get: (id: string) => unknown } }).getProcessStmt;
        const read = statement.get.bind(statement);
        vi.spyOn(statement, 'get').mockImplementationOnce(id => {
            const row = read(id);
            writer.getDatabase().transaction(() => {
                writer.getDatabase().prepare('DELETE FROM conversation_turns WHERE process_id = ? AND turn_index >= 100').run(id);
                writer.getDatabase().prepare("UPDATE processes SET title = 'concurrent' WHERE id = ?").run(id);
            })();
            return row;
        });
        const snapshot = (await store.getProcessHistory('history'))!;
        expect(snapshot.process.title).toBeUndefined();
        expect(snapshot.page).toMatchObject({ totalTurns: 200, historyRevision: 0, oldestTurnIndex: 170 });
        expect(snapshot.page.turns.at(-1)!.turnIndex).toBe(199);
        const fresh = (await store.getProcessHistory('history'))!;
        expect(fresh.process.title).toBe('concurrent');
        expect(fresh.page.totalTurns).toBe(100);
        expect(fresh.page.historyRevision).toBeGreaterThan(0);
    });

    it('never calls full history readers and bounds row hydration', async () => {
        const store = await createStore('sqlite') as SqliteProcessStore;
        await store.addProcess(processFixture());
        vi.spyOn(store, 'getProcess').mockRejectedValue(new Error('full hydration'));
        vi.spyOn(store, 'getConversationTurns').mockRejectedValue(new Error('native full hydration'));
        const fullStatement = (store as unknown as { getTurnsStmt: { all: () => unknown } }).getTurnsStmt;
        vi.spyOn(fullStatement, 'all').mockImplementation(() => { throw new Error('full statement'); });
        const prepare = vi.spyOn(store.getDatabase(), 'prepare');
        expect((await store.getProcessHistory('history'))!.page.turns).toHaveLength(30);
        expect(prepare.mock.calls.some(([sql]) => sql.includes('ORDER BY turn_index DESC LIMIT ?'))).toBe(true);
    });

    it('retains tombstones and archives, counts index gaps, and invalidates every direct writer', async () => {
        const store = await createStore('sqlite') as SqliteProcessStore;
        await store.addProcess(processFixture(8));
        const revision = async () => (await store.getProcessHistory('history'))!.page.historyRevision;
        let last = await revision();
        for (const mutate of [
            () => store.softDeleteTurn('history', 0),
            () => store.restoreTurn('history', 0),
            () => store.archiveTurn('history', 1),
            () => store.unarchiveTurn('history', 1),
            () => store.getDatabase().prepare("UPDATE conversation_turns SET compaction_summary = 'summary' WHERE process_id = ? AND turn_index = 2").run('history'),
        ]) {
            mutate();
            expect(await revision()).toBeGreaterThan(last);
            last = await revision();
        }
        store.softDeleteTurn('history', 0);
        store.archiveTurn('history', 1);
        expect((await store.getProcessHistory('history'))!.page.turns).toEqual((await store.getProcess('history'))!.conversationTurns);
        store.hardDeleteTurn('history', 0);
        const page = (await store.getProcessHistory('history', undefined, { limit: 1, beforeTurnIndex: 3 }))!.page;
        expect(page.turns.map(turn => turn.turnIndex)).toEqual([2]);
        expect(page.totalTurns).toBe(7);
        expect(page.hasMore).toBe(true);
        const db = store.getDatabase();
        const before = await revision();
        expect(() => db.transaction(() => {
            db.prepare("DELETE FROM conversation_turns WHERE process_id = ?").run('history');
            throw new Error('rollback');
        })()).toThrow('rollback');
        expect(await revision()).toBe(before);
        expect((await store.getProcessHistory('history'))!.page.totalTurns).toBe(7);
        db.transaction(() => {
            db.prepare('DELETE FROM conversation_turns WHERE process_id = ?').run('history');
            db.prepare("INSERT INTO conversation_turns (process_id,turn_index,role,content,timestamp) VALUES (?,0,'user','replacement','2026-01-01')").run('history');
        })();
        expect(await revision()).toBeGreaterThan(before);
        const replaced = await revision();
        db.prepare("INSERT OR REPLACE INTO conversation_turns (process_id,turn_index,role,content,timestamp) VALUES (?,0,'user','changed replacement','2026-01-01')").run('history');
        expect(await revision()).toBeGreaterThan(replaced);
    });

    it('migrates v41 in place, preserves data and keeps private revision out of native full reads', async () => {
        const store = await createStore('sqlite') as SqliteProcessStore;
        await store.addProcess(processFixture(2));
        const db = store.getDatabase();
        db.exec(`
            DROP TRIGGER history_turn_update; DROP TRIGGER history_turn_delete;
            DROP TRIGGER history_turn_insert; DROP TRIGGER history_turn_replace; DROP TRIGGER history_compaction_complete;
            ALTER TABLE processes DROP COLUMN history_revision; PRAGMA user_version = 41;
        `);
        initializeDatabase(db);
        expect(db.pragma('user_version', { simple: true })).toBe(42);
        expect((await store.getProcessHistory('history'))!.page.historyRevision).toBe(0);
        expect((await store.getAllProcesses())[0]).not.toHaveProperty('historyRevision');
        expect((await store.getConversationTurns('history'))).toHaveLength(2);
        await store.updateTurnContent('history', 0, 'updated');
        expect((await store.getProcessHistory('history'))!.page.historyRevision).toBe(1);
    });
});

it('in-memory revision tracking preserves shapes and detects history replacement', () => {
    const processes = new HistoryAwareProcessMap();
    processes.set('history', processFixture(4));
    processes.set('history', processFixture(2));
    expect(processes.getProcessHistory('history')!.page.historyRevision).toBe(1);
    expect(processes.get('history')).not.toHaveProperty('historyRevision');
    expect(processes.getProcessHistory('history', 'ws-b')).toBeUndefined();
});
