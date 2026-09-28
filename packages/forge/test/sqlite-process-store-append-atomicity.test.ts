import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SqliteProcessStore } from '../src/sqlite-process-store';

const stores: SqliteProcessStore[] = [];
const dirs: string[] = [];

afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('rolls back turn, FTS, and streaming deletion if the process update fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'append-atomicity-'));
    dirs.push(dir);
    const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
    stores.push(store);
    await store.addProcess({
        id: 'process', type: 'chat', status: 'running', promptPreview: 'prompt',
        startTime: new Date('2026-01-01T00:00:00Z'),
        metadata: { type: 'chat', workspaceId: 'ws-test' },
    });
    await store.upsertStreamingTurn('process', 'originalstreamtoken', true);
    const before = await store.getProcess('process');
    const db = store.getDatabase();
    db.exec(`CREATE TRIGGER reject_process_update BEFORE UPDATE ON processes
        BEGIN SELECT RAISE(ABORT, 'process update failed'); END`);
    let events = 0;
    store.onProcessChange = () => { events++; };
    const makeTurn = (index: number) => ({
        role: 'user' as const,
        content: 'replacementtoken',
        timestamp: new Date('2026-01-02T00:00:00Z'),
        turnIndex: index,
        timeline: [],
    });

    await expect(store.appendConversationTurn('process', makeTurn, { filterStreaming: true }))
        .rejects.toThrow('process update failed');
    expect(await store.getProcess('process')).toEqual(before);
    expect(db.prepare('SELECT content FROM conversation_search WHERE conversation_search MATCH ?')
        .all('originalstreamtoken')).toHaveLength(1);
    expect(db.prepare('SELECT content FROM conversation_search WHERE conversation_search MATCH ?')
        .all('replacementtoken')).toEqual([]);
    expect(events).toBe(0);

    db.exec('DROP TRIGGER reject_process_update');
    const result = await store.appendConversationTurn('process', makeTurn, { filterStreaming: true });
    expect(result?.turn.turnIndex).toBe(0);
    expect(result?.allTurns.map(turn => turn.content)).toEqual(['replacementtoken']);
    expect(events).toBe(1);
});
