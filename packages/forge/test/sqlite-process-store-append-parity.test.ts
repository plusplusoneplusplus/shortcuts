import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { SqliteProcessStore } from '../src/sqlite-process-store';

const stores: SqliteProcessStore[] = [];
const dirs: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createStore(): SqliteProcessStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'append-parity-'));
    dirs.push(dir);
    const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
    stores.push(store);
    return store;
}

function originalSql(
    db: NativeDatabase, role: 'user' | 'assistant', content: string,
    filterStreaming: boolean, status?: string,
): number {
    return db.transaction(() => {
        let stableIndex: number | undefined;
        if (filterStreaming) {
            const streaming = db.prepare(
                "SELECT turn_index FROM conversation_turns WHERE process_id = ? AND streaming = 1 AND role = 'assistant'",
            ).get<{ turn_index: number }>('one');
            stableIndex = streaming?.turn_index;
            db.prepare('DELETE FROM conversation_turns WHERE process_id = ? AND streaming = 1').run('one');
            const max = db.prepare(
                'SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM conversation_turns WHERE process_id = ?',
            ).get<{ max_idx: number }>('one')!.max_idx;
            if (stableIndex !== undefined && stableIndex <= max) stableIndex = undefined;
        }
        const nextIndex = db.prepare(
            'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_idx FROM conversation_turns WHERE process_id = ?',
        ).get<{ next_idx: number }>('one')!.next_idx;
        const index = stableIndex ?? nextIndex;
        db.prepare(
            `INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp, timeline)
             VALUES (?, ?, ?, ?, ?, '[]')`,
        ).run('one', index, role, content, new Date().toISOString());
        if (role === 'user') {
            db.prepare('UPDATE processes SET last_event_at = ?, last_message_preview = ? WHERE id = ?')
                .run(new Date().toISOString(), content, 'one');
        } else {
            db.prepare('UPDATE processes SET last_event_at = ? WHERE id = ?')
                .run(new Date().toISOString(), 'one');
        }
        if (status) db.prepare('UPDATE processes SET status = ? WHERE id = ?').run(status, 'one');
        return index;
    })();
}

function persistedRows(db: NativeDatabase): string {
    const rows = (sql: string) => (db.prepare(sql).all() as Array<Record<string, unknown>>)
        .map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
    return JSON.stringify({
        process: rows("SELECT * FROM processes WHERE id = 'one'"),
        turns: rows('SELECT * FROM conversation_turns ORDER BY id'),
        search: rows('SELECT rowid, content FROM conversation_search ORDER BY rowid'),
    });
}

it('matches the original SQL bytes for streaming replacement, follow-up, and process updates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const store = createStore();
    const oracle = createStore();
    for (const candidate of [store, oracle]) {
        await candidate.addProcess({
            id: 'one', type: 'chat', status: 'running', promptPreview: 'prompt',
            startTime: new Date('2026-01-01T00:00:00Z'),
            metadata: { type: 'chat', workspaceId: 'ws-a' },
        });
        await candidate.upsertStreamingTurn('one', 'draft', true);
    }

    const cases = [
        { role: 'assistant' as const, content: 'first answer', filterStreaming: true },
        { role: 'user' as const, content: 'follow up', filterStreaming: false, status: 'completed' },
        { role: 'assistant' as const, content: 'second answer', filterStreaming: false },
    ];
    for (const { role, content, filterStreaming, status } of cases) {
        const result = await store.appendConversationTurn('one', index => ({
            role, content, turnIndex: index, timestamp: new Date(), timeline: [],
        }), { filterStreaming, additionalUpdates: status ? { status: status as 'completed' } : undefined });
        const index = originalSql(oracle.getDatabase(), role, content, filterStreaming, status);
        expect(result?.turn.turnIndex).toBe(index);
        expect(persistedRows(store.getDatabase())).toBe(persistedRows(oracle.getDatabase()));
        expect(await store.getConversationTurns('one')).toEqual(await oracle.getConversationTurns('one'));
    }
});
