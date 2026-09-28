import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import type { AIProcess, ConversationTurn } from '../src/ai/process-types';
import type { ProcessFilter } from '../src/process-store';

const stores: SqliteProcessStore[] = [];
const dirs: string[] = [];

afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function storeWithSample(): SqliteProcessStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac07-reads-'));
    dirs.push(dir);
    const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
    stores.push(store);
    return store;
}

function bytes(value: unknown): string {
    return JSON.stringify(value);
}

function canonicalRows(rows: Array<Record<string, unknown>>): string {
    return bytes(rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
}

async function seed(store: SqliteProcessStore): Promise<void> {
    const first: AIProcess = {
        id: 'first', type: 'chat', status: 'completed', promptPreview: 'first',
        fullPrompt: 'long full prompt', result: 'answer', startTime: new Date('2026-01-01T00:00:00Z'),
        endTime: new Date('2026-01-02T00:00:00Z'),
        metadata: { workspaceId: 'ws-a', type: 'chat', model: 'model-a' },
        conversationTurns: [{
            role: 'user', turnIndex: 0, content: 'hello', timestamp: new Date('2026-01-01T00:00:00Z'),
            timeline: [], toolCalls: [{ id: 'tool-one', name: 'bash', status: 'completed', startTime: new Date('2026-01-01T00:00:00Z'), args: { command: 'pwd' }, result: 'ok' }],
        }],
    };
    const second: AIProcess = {
        id: 'second', type: 'chat', status: 'running', promptPreview: 'second',
        startTime: new Date('2026-01-03T00:00:00Z'),
        metadata: { workspaceId: 'ws-b', type: 'chat' },
    };
    await store.addProcess(first);
    await store.addProcess(second);
    await store.appendConversationTurn('first', index => ({
        role: 'assistant', turnIndex: index, content: 'reply',
        timestamp: new Date('2026-01-01T00:01:00Z'), timeline: [],
        interrupted: true, provider: 'copilot',
    } as ConversationTurn));
}

describe('AC-07 original SQL versus pooled native reads', () => {
    it('matches raw turn rows and preserves converted JSON/Date output, including missing IDs', async () => {
        const store = storeWithSample();
        await seed(store);
        const db = store.getDatabase();
        for (const id of ['first', 'second', 'missing']) {
            const original = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index')
                .all(id) as Array<Record<string, unknown>>;
            expect(canonicalRows(await db.getConversationTurns(id))).toBe(canonicalRows(original));
            expect(bytes(await store.getConversationTurns(id)))
                .toBe(bytes((await store.getProcess(id))?.conversationTurns ?? []));
        }
    });

    it('matches original SQL rows and ProcessStore API for filters, paging, and exclusions', async () => {
        const store = storeWithSample();
        await seed(store);
        const db = store.getDatabase();
        const cases: ProcessFilter[] = [
            {}, { workspaceId: 'ws-a' }, { status: ['completed', 'running'] },
            { status: [] }, { status: 'completed', type: 'chat' },
            { parentProcessId: 'missing' }, { since: new Date('2026-01-02Z') },
            { until: new Date('2026-01-02Z') },
            { limit: 1, offset: 1 }, { exclude: ['conversation'] }, { exclude: ['toolCalls'] },
        ];
        for (const filter of cases) {
            const statuses = filter.status === undefined ? undefined :
                Array.isArray(filter.status) ? filter.status : [filter.status];
            const native = await db.getAllProcesses({
                workspaceId: filter.workspaceId,
                parentProcessId: filter.parentProcessId,
                statuses,
                processType: filter.type,
                since: filter.since?.toISOString(),
                until: filter.until?.toISOString(),
                limit: filter.limit,
                offset: filter.offset,
                excludeConversation: filter.exclude?.includes('conversation'),
            });
            const conditions: string[] = [];
            const params: unknown[] = [];
            if (filter.workspaceId !== undefined) { conditions.push('workspace_id = ?'); params.push(filter.workspaceId); }
            if (filter.parentProcessId !== undefined) { conditions.push('parent_process_id = ?'); params.push(filter.parentProcessId); }
            if (filter.status !== undefined) {
                conditions.push(Array.isArray(filter.status)
                    ? `status IN (${filter.status.map(() => '?').join(', ')})`
                    : 'status = ?');
                params.push(...statuses!);
            }
            if (filter.type !== undefined) { conditions.push('type = ?'); params.push(filter.type); }
            if (filter.since !== undefined) { conditions.push('start_time >= ?'); params.push(filter.since.toISOString()); }
            if (filter.until !== undefined) { conditions.push('start_time < ?'); params.push(filter.until.toISOString()); }
            const select = filter.exclude?.includes('conversation')
                ? `id, workspace_id, type, prompt_preview, NULL AS full_prompt, status,
                    start_time, end_time, error, NULL AS result, result_file_path,
                    raw_stdout_file_path, metadata, group_metadata, NULL AS structured_result,
                    parent_process_id, sdk_session_id, active_provider_session, backend, working_directory,
                    title, custom_title, last_message_preview, token_limit, current_tokens,
                    cumulative_token_usage, stale, data_file_path, archived, pinned_at,
                    seen_at, last_event_at`
                : '*';
            const sql = `SELECT ${select} FROM processes ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
                ORDER BY last_event_at DESC${filter.limit !== undefined ? ' LIMIT ?' : ''}
                ${filter.offset !== undefined ? ' OFFSET ?' : ''}`;
            if (filter.limit !== undefined) params.push(filter.limit);
            if (filter.offset !== undefined) params.push(filter.offset);
            const oldRows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
            expect(canonicalRows(native.map(entry => entry.process))).toBe(canonicalRows(oldRows));
            const original = await store.getAllProcesses(filter);
            expect(native.map(row => row.process.id)).toEqual(original.map(process => process.id));
            for (const row of native) {
                if (!filter.exclude?.includes('conversation')) {
                    const oldTurns = db.prepare('SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index')
                        .all(row.process.id) as Array<Record<string, unknown>>;
                    expect(canonicalRows(row.turns ?? [])).toBe(canonicalRows(oldTurns));
                } else {
                    expect(row.turns).toBeUndefined();
                }
            }
            if (!filter.exclude?.includes('conversation') && !filter.exclude?.includes('toolCalls')) {
                const expected = await Promise.all(original.map(async process => store.getProcess(process.id)));
                expect(bytes(original)).toBe(bytes(expected));
            }
        }
    });

    it('rejects unsupported schema and surfaces database errors on both reads', async () => {
        const store = storeWithSample();
        store.getDatabase().pragma('user_version = 999');
        await expect(store.getConversationTurns('missing')).rejects.toThrow('unsupported process database user_version: 999');
        await expect(store.getAllProcesses()).rejects.toThrow('unsupported process database user_version: 999');
    });
});
