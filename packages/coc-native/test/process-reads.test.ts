import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeDatabase } from '../src/sqlite';

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('pooled native process reads', () => {
    it('exposes typed asynchronous turn and process reads with filters and version guards', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac07-native-reads-'));
        dirs.push(dir);
        const db = new NativeDatabase(path.join(dir, 'processes.db'));
        try {
            db.exec(`
                PRAGMA journal_mode=WAL; PRAGMA user_version=38;
                CREATE TABLE processes (
                    id TEXT, workspace_id TEXT, parent_process_id TEXT, status TEXT,
                    type TEXT, start_time TEXT, last_event_at TEXT
                );
                CREATE TABLE conversation_turns (
                    id INTEGER, process_id TEXT, turn_index INTEGER, content TEXT
                );
                INSERT INTO processes VALUES ('one', 'ws-a', NULL, 'completed', 'chat', '2026-01-01', '2026-01-02');
                INSERT INTO conversation_turns VALUES (1, 'one', 1, 'later'), (2, 'one', 0, 'first');
            `);
            const pending = db.getConversationTurns('one');
            expect(pending).toBeInstanceOf(Promise);
            expect((await pending).map(row => row.content)).toEqual(['first', 'later']);
            expect(await db.getConversationTurns('missing')).toEqual([]);
            const processes = db.getAllProcesses({ workspaceId: 'ws-a', statuses: ['completed'] });
            expect(processes).toBeInstanceOf(Promise);
            expect(await processes).toEqual([{
                process: {
                    id: 'one', workspace_id: 'ws-a', parent_process_id: null,
                    status: 'completed', type: 'chat', start_time: '2026-01-01',
                    last_event_at: '2026-01-02',
                },
                turns: [
                    { id: 2, process_id: 'one', turn_index: 0, content: 'first' },
                    { id: 1, process_id: 'one', turn_index: 1, content: 'later' },
                ],
            }]);
            expect(await db.getAllProcesses({ statuses: [] })).toEqual([]);
            db.pragma('user_version = 99');
            await expect(db.getConversationTurns('one')).rejects.toThrow('unsupported process database user_version: 99');
            await expect(db.getAllProcesses()).rejects.toThrow('unsupported process database user_version: 99');
        } finally {
            db.close();
        }
    });

    it('returns summary counts, recent rows, and rejects unsupported schema on both paths', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac07-native-index-'));
        dirs.push(dir);
        const db = new NativeDatabase(path.join(dir, 'processes.db'));
        try {
            db.exec(`
                PRAGMA journal_mode=WAL; PRAGMA user_version=38;
                CREATE TABLE processes (
                    id TEXT, workspace_id TEXT, parent_process_id TEXT, status TEXT, type TEXT,
                    start_time TEXT, end_time TEXT, prompt_preview TEXT, error TEXT,
                    title TEXT, custom_title TEXT, last_message_preview TEXT, last_event_at TEXT,
                    pinned_at TEXT, archived INTEGER, metadata TEXT
                );
                INSERT INTO processes VALUES (
                    'one', 'ws-a', NULL, 'completed', 'chat',
                    '2026-01-01', NULL, 'prompt', NULL, NULL, NULL, NULL, '2026-01-02',
                    NULL, 0, '{"__pendingAskUser":[{"id":"ask"}],"compaction":{"count":2}}'
                );
                INSERT INTO processes VALUES (
                    'two', 'ws-b', NULL, 'running', 'chat',
                    '2026-02-01', NULL, 'prompt', NULL, NULL, NULL, NULL, '2026-02-02',
                    NULL, 1, NULL
                );
            `);
            const pending = db.getProcessSummaries({ workspaceId: 'ws-a' });
            expect(pending).toBeInstanceOf(Promise);
            const page = await pending;
            expect(page.total).toBe(1);
            expect(page.rows[0]).toMatchObject({
                id: 'one', pending_ask_user_count: 1, compaction_json: '{"count":2}',
            });
            expect((await db.getProcessSummaries({ limit: 1 })).total).toBe(2);
            expect((await db.listRecentProcesses()).map(row => row.id)).toEqual(['one']);
            expect((await db.listRecentProcesses({ limit: 0, excludeProcessId: 'one' }))).toEqual([]);
            db.pragma('user_version = 999');
            await expect(db.getProcessSummaries()).rejects.toThrow('unsupported process database user_version: 999');
            await expect(db.listRecentProcesses()).rejects.toThrow('unsupported process database user_version: 999');
        } finally {
            db.close();
        }
    });
});
