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
});
