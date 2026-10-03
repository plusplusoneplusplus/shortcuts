import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeDatabase } from '../src/sqlite';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('typed async process search', () => {
    it('returns a promise with highlighted FTS results and enforces schema version', async () => {
        const dir = fs.mkdtempSync(path.join(process.cwd(), '.ac07-native-'));
        dirs.push(dir);
        const db = new NativeDatabase(path.join(dir, 'processes.db'));
        try {
            db.exec(`
                PRAGMA journal_mode=WAL;
                PRAGMA user_version=38;
                CREATE TABLE processes (id TEXT PRIMARY KEY, archived INTEGER, workspace_id TEXT,
                    status TEXT, type TEXT, last_event_at TEXT, title TEXT, prompt_preview TEXT, start_time TEXT);
                CREATE TABLE conversation_turns (id INTEGER PRIMARY KEY, process_id TEXT, turn_index INTEGER,
                    role TEXT, content TEXT, interrupted INTEGER);
                CREATE VIRTUAL TABLE conversation_search USING fts5(content);
                INSERT INTO processes VALUES ('one', 0, 'ws-a', 'completed', 'chat', '2026-01-02',
                    NULL, 'preview', '2026-01-01');
                INSERT INTO conversation_turns VALUES (1, 'one', 0, 'user', 'find native', 0);
                INSERT INTO conversation_search(rowid, content) VALUES (1, 'find native');
            `);
            const pending = db.searchConversations('native*', { workspaceId: 'ws-a' });
            expect(pending).toBeInstanceOf(Promise);
            expect(await pending).toEqual({
                total: 1,
                results: [{
                    processId: 'one', turnIndex: 0, role: 'user',
                    snippet: 'find <mark>native</mark>', rank: expect.any(Number),
                    promptPreview: 'preview', processStatus: 'completed',
                    processType: 'chat', workspaceId: 'ws-a', startTime: '2026-01-01',
                }],
            });
            db.pragma('user_version = 39');
            expect((await db.searchConversations('native')).total).toBe(1);
            db.pragma('user_version = 40');
            await expect(db.searchConversations('native')).rejects.toThrow('unsupported process database user_version: 40');
        } finally {
            db.close();
        }
    });
});
