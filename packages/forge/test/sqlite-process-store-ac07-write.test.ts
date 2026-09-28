import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import type { AIProcess } from '../src/ai/process-types';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';

const stores: SqliteProcessStore[] = [];
const dirs: string[] = [];
afterEach(() => {
    vi.useRealTimers();
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createStore(): SqliteProcessStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac07-streaming-'));
    dirs.push(dir);
    const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
    stores.push(store);
    return store;
}

async function seed(store: SqliteProcessStore): Promise<void> {
    const process: AIProcess = {
        id: 'one', status: 'running', type: 'chat', promptPreview: 'prompt',
        startTime: new Date('2026-01-01T00:00:00Z'),
        metadata: { type: 'chat', workspaceId: 'ws-a' },
    };
    await store.addProcess(process);
}

// The original TypeScript transaction, kept independently to catch SQL/value drift.
function originalSql(db: NativeDatabase, content: string, streaming: boolean, timeline: string): void {
    db.transaction(() => {
        const result = db.prepare(`UPDATE conversation_turns
            SET content = @content, timeline = @timeline, streaming = @streaming
            WHERE process_id = @process_id AND streaming = 1`).run({
                content, timeline, streaming: Number(streaming), process_id: 'one',
            });
        if (result.changes === 0) {
            const { next_idx } = db.prepare(
                'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_idx FROM conversation_turns WHERE process_id = ?',
            ).get('one') as { next_idx: number };
            db.prepare(`INSERT INTO conversation_turns (
                process_id, turn_index, role, content, timestamp, streaming,
                interrupted, interruption_reason, tool_calls, timeline, images, historical,
                suggestions, token_usage, paste_externalized, model, mode, sdk_event_id,
                display_only, compaction_summary, repo_group_context, chat_mode_context,
                provider, segment_id, relay_request_id
            ) VALUES (
                @process_id, @turn_index, @role, @content, @timestamp, @streaming,
                @interrupted, @interruption_reason, @tool_calls, @timeline, @images, @historical,
                @suggestions, @token_usage, @paste_externalized, @model, @mode, @sdk_event_id,
                @display_only, @compaction_summary, @repo_group_context, @chat_mode_context,
                @provider, @segment_id, @relay_request_id
            )`).run({
                process_id: 'one', turn_index: next_idx, role: 'assistant', content,
                timestamp: new Date().toISOString(), streaming: Number(streaming),
                interrupted: 0, interruption_reason: null, tool_calls: null, timeline,
                images: null, historical: 0, suggestions: null, token_usage: null,
                paste_externalized: 0, model: null, mode: null, sdk_event_id: null,
                display_only: 0, compaction_summary: null, repo_group_context: null,
                chat_mode_context: null, provider: null, segment_id: null, relay_request_id: null,
            });
        }
    })();
}

function databaseBytes(db: NativeDatabase): string {
    const canonical = (row: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify({
        turns: (db.prepare('SELECT * FROM conversation_turns ORDER BY id').all() as Array<Record<string, unknown>>).map(canonical),
        fts: (db.prepare('SELECT rowid, content FROM conversation_search ORDER BY rowid').all() as Array<Record<string, unknown>>).map(canonical),
        process: canonical(db.prepare('SELECT * FROM processes WHERE id = ?').get('one') as Record<string, unknown>),
    });
}

describe('AC-07 original SQL versus native streaming writes', () => {
    it('matches database bytes for insert, update, finalize, and new-turn paths', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
        const store = createStore();
        const oracle = createStore();
        const native = createStore();
        await seed(store);
        await seed(oracle);
        await seed(native);
        const steps = [
            { content: 'partial', streaming: true, timeline: '[]' },
            { content: 'partial 2', streaming: true, timeline: '[{"type":"content","timestamp":"2026-01-01T00:00:00.000Z","content":"partial 2"}]' },
            { content: 'completed', streaming: false, timeline: '[]' },
            { content: 'another', streaming: true, timeline: '[]' },
        ];
        for (const step of steps) {
            const parsed = JSON.parse(step.timeline) as Array<{ type: 'content'; content: string; timestamp: string }>;
            await store.upsertStreamingTurn('one', step.content, step.streaming,
                parsed.map(item => ({ type: item.type, timestamp: new Date(item.timestamp), content: item.content })));
            originalSql(oracle.getDatabase(), step.content, step.streaming, step.timeline);
            await native.getDatabase().upsertStreamingTurn(
                'one', step.content, step.streaming, step.timeline, new Date().toISOString(),
            );
            expect(databaseBytes(store.getDatabase())).toBe(databaseBytes(oracle.getDatabase()));
            expect(databaseBytes(native.getDatabase())).toBe(databaseBytes(oracle.getDatabase()));
        }
    });

    it('emits after successful writes and not after failures or missing processes', async () => {
        const store = createStore();
        await seed(store);
        const observed: string[] = [];
        store.onProcessChange = event => {
            expect(event.type).toBe('process-updated');
            observed.push(String(store.getDatabase().prepare(
                'SELECT content FROM conversation_turns WHERE process_id = ? ORDER BY id DESC LIMIT 1',
            ).get('one')?.content));
        };
        store.getDatabase().exec(`CREATE TRIGGER fail_streaming_insert
            BEFORE INSERT ON conversation_turns BEGIN SELECT RAISE(FAIL, 'injected insert failure'); END`);
        await expect(store.upsertStreamingTurn('one', 'rejected', true)).rejects.toThrow('injected insert failure');
        expect(observed).toEqual([]);
        expect(await store.getConversationTurns('one')).toEqual([]);
        store.getDatabase().exec('DROP TRIGGER fail_streaming_insert');
        await store.upsertStreamingTurn('one', 'live', true);
        store.getDatabase().exec(`CREATE TRIGGER fail_streaming_update
            AFTER UPDATE ON conversation_turns BEGIN SELECT RAISE(FAIL, 'injected update failure'); END`);
        await expect(store.upsertStreamingTurn('one', 'rejected', true)).rejects.toThrow('injected update failure');
        expect((await store.getConversationTurns('one'))[0].content).toBe('live');
        expect(observed).toEqual(['live']);
        store.getDatabase().exec('DROP TRIGGER fail_streaming_update');
        await store.upsertStreamingTurn('one', 'done', false);
        expect(observed).toEqual(['live', 'done']);
        expect((await store.getProcess('one'))?.status).toBe('running');
        await expect(store.upsertStreamingTurn('missing', 'no turn', true)).rejects.toThrow();
        expect(observed).toHaveLength(2);
        store.getDatabase().pragma('user_version = 999');
        await expect(store.upsertStreamingTurn('one', 'invalid', true))
            .rejects.toThrow('unsupported process database user_version: 999');
        expect(observed).toHaveLength(2);
    });
});
