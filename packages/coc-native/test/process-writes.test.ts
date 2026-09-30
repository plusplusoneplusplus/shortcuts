import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeDatabase } from '../src/sqlite';

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('typed async streaming turn write', () => {
    it('serializes concurrent updates and rejects schema and foreign-key failures', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac07-native-write-'));
        dirs.push(dir);
        const db = new NativeDatabase(path.join(dir, 'processes.db'));
        try {
            db.exec(`
                PRAGMA journal_mode=WAL; PRAGMA user_version=38; PRAGMA foreign_keys=ON;
                CREATE TABLE processes (id TEXT PRIMARY KEY);
                INSERT INTO processes VALUES ('one');
                CREATE TABLE conversation_turns (
                    id INTEGER PRIMARY KEY, process_id TEXT REFERENCES processes(id),
                    turn_index INTEGER, role TEXT, content TEXT, timestamp TEXT, streaming INTEGER,
                    interrupted INTEGER, interruption_reason TEXT, tool_calls TEXT, timeline TEXT,
                    images TEXT, historical INTEGER, suggestions TEXT, token_usage TEXT,
                    paste_externalized INTEGER, model TEXT, mode TEXT, sdk_event_id TEXT,
                    display_only INTEGER, compaction_summary TEXT, repo_group_context TEXT,
                    chat_mode_context TEXT, provider TEXT, segment_id TEXT, relay_request_id TEXT,
                    UNIQUE(process_id, turn_index)
                );
            `);
            const timestamp = '2026-01-01T00:00:00.000Z';
            const first = db.upsertStreamingTurn('one', 'start', true, '[]', timestamp);
            expect(first).toBeInstanceOf(Promise);
            await first;
            await Promise.all(Array.from({ length: 12 }, (_, index) =>
                db.upsertStreamingTurn('one', `chunk-${index}`, true, '[]', timestamp)));
            const turns = await db.getConversationTurns('one');
            expect(turns).toHaveLength(1);
            expect(turns[0].timestamp).toBe(timestamp);
            expect(turns[0].content).toMatch(/^chunk-\d+$/);
            await db.upsertStreamingTurn('one', 'final', false, '[]', timestamp);
            await db.upsertStreamingTurn('one', 'new', true, '[]', timestamp);
            expect((await db.getConversationTurns('one')).map(row => row.content)).toEqual(['final', 'new']);
            await expect(db.upsertStreamingTurn('missing', 'bad', true, '[]', timestamp)).rejects.toThrow();
            expect(await db.getConversationTurns('missing')).toEqual([]);
            db.pragma('user_version = 999');
            await expect(db.upsertStreamingTurn('one', 'bad', true, '[]', timestamp))
                .rejects.toThrow('unsupported process database user_version: 999');
        } finally {
            db.close();
        }
    });
});
