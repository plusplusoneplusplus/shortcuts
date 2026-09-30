import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeDatabase, type NativeSqliteRow } from '../src/sqlite';

const directories: string[] = [];
const databases: NativeDatabase[] = [];

afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('batched process reads', () => {
    it('preserves SQLite value types, turn order, empty conversations, and workspace filtering', async () => {
        const directory = fs.mkdtempSync(path.join(process.cwd(), '.native-process-reads-'));
        directories.push(directory);
        const database = new NativeDatabase(path.join(directory, 'processes.db'));
        databases.push(database);
        database.exec(`
            PRAGMA journal_mode=WAL; PRAGMA user_version=38;
            CREATE TABLE processes (
                id TEXT PRIMARY KEY, workspace_id TEXT, last_event_at TEXT,
                result BLOB, token_limit INTEGER, metadata TEXT, current_tokens REAL
            );
            CREATE TABLE conversation_turns (
                id INTEGER PRIMARY KEY, process_id TEXT, turn_index INTEGER, content BLOB
            );
            CREATE INDEX idx_turns_process_id ON conversation_turns(process_id, turn_index);
        `);
        const blob = Buffer.from([0, 127, 255]);
        database.prepare('INSERT INTO processes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            'first', 'ws-a', '2026-01-01', blob, 42, '{"value":null}', 1.25,
        );
        database.prepare('INSERT INTO processes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            'second', 'ws-a', '2026-01-02', null, Number.POSITIVE_INFINITY, null, null,
        );
        database.prepare('INSERT INTO processes VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            'other', 'ws-b', '2026-01-03', null, null, null, null,
        );
        database.prepare('UPDATE processes SET token_limit = 9223372036854775807 WHERE id = ?').run('first');
        const insertTurn = database.prepare('INSERT INTO conversation_turns (process_id, turn_index, content) VALUES (?, ?, ?)');
        insertTurn.run('first', 2, blob);
        insertTurn.run('first', 0, 'Unicode ☃');
        insertTurn.run('other', 0, 'different workspace');

        const entries = await database.getAllProcesses({ workspaceId: 'ws-a' });
        const expected = database.prepare(
            'SELECT * FROM processes WHERE workspace_id = ? ORDER BY last_event_at DESC',
        ).all<NativeSqliteRow>('ws-a');
        expect(entries.map(({ process }) => process)).toEqual(expected);
        expect(entries[0].turns).toEqual([]);
        expect(entries[1].turns).toEqual(database.prepare(
            'SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index',
        ).all<NativeSqliteRow>('first'));
        expect(entries[1].process.token_limit).toBe(9223372036854776000);
        expect(entries[1].process.current_tokens).toBe(1.25);
        expect(Buffer.isBuffer(entries[1].process.result)).toBe(true);
        expect(Buffer.isBuffer(entries[1].turns?.[1].content)).toBe(true);
        expect(entries[0].process.token_limit).toBe(Number.POSITIVE_INFINITY);
        expect((await database.getAllProcesses({ workspaceId: 'ws-a', limit: 1, offset: 1 }))[0])
            .toEqual(entries[1]);
        expect(await database.getAllProcesses({ workspaceId: 'missing' })).toEqual([]);
    });
});
