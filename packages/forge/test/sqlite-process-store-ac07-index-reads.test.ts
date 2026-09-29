import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import { SqliteTaskGroupStore, CHAT_FOLDER_GROUP_TYPE } from '../src/task-group-store';
import type { ProcessFilter, ProcessIndexEntry } from '../src/process-store';
import type { AIProcess } from '../src/ai/process-types';

const stores: SqliteProcessStore[] = [];
const dirs: string[] = [];
afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture(): SqliteProcessStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac07-index-'));
    dirs.push(dir);
    const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
    stores.push(store);
    return store;
}

type IndexRow = {
    id: string; workspace_id: string; status: string; type: string | null; start_time: string;
    end_time: string | null; prompt_preview: string | null; error: string | null;
    parent_process_id: string | null; title: string | null; custom_title: string | null;
    last_message_preview: string | null; last_event_at: string | null; pinned_at: string | null;
    archived: number; compaction_json: string | null; pending_ask_user_count?: number | null;
};
const summarySelect = `id, workspace_id, status, type, start_time, end_time, prompt_preview, error,
    parent_process_id, title, custom_title, last_message_preview, last_event_at, pinned_at, archived,
    COALESCE(json_array_length(json_extract(metadata, '$.__pendingAskUser')), 0) AS pending_ask_user_count,
    json_extract(metadata, '$.compaction') AS compaction_json`;
const recentSelect = `id, workspace_id, status, type, start_time, end_time,
    prompt_preview, error, parent_process_id, title, custom_title, last_message_preview,
    last_event_at, pinned_at, archived, json_extract(metadata, '$.compaction') AS compaction_json`;
const bytes = (value: unknown) => JSON.stringify(value);

function originalEntry(row: IndexRow, summary: boolean): ProcessIndexEntry {
    const startMs = new Date(row.start_time).getTime();
    const endMs = row.end_time ? new Date(row.end_time).getTime() : undefined;
    const common: ProcessIndexEntry = {
        id: row.id,
        workspaceId: row.workspace_id,
        status: row.status,
        type: (row.type || 'clarification') as ProcessIndexEntry['type'],
        startTime: new Date(row.start_time).toISOString(),
        endTime: row.end_time ? new Date(row.end_time).toISOString() : undefined,
        promptPreview: row.prompt_preview ?? '',
        error: row.error ?? undefined,
        parentProcessId: row.parent_process_id ?? undefined,
        title: row.title ?? undefined,
        customTitle: row.custom_title ?? undefined,
        lastMessagePreview: row.last_message_preview ?? undefined,
        duration: endMs !== undefined ? endMs - startMs : undefined,
        lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : undefined,
        activityAt: new Date(row.last_event_at ?? row.start_time).toISOString(),
        pinnedAt: row.pinned_at ?? undefined,
        archived: row.archived !== 0 || undefined,
    };
    if (summary) {
        const count = typeof row.pending_ask_user_count === 'number' ? row.pending_ask_user_count : 0;
        common.pendingAskUserCount = count > 0 ? count : undefined;
    }
    common.compaction = row.compaction_json ? JSON.parse(row.compaction_json) : undefined;
    return common;
}

function where(filter: ProcessFilter) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.workspaceId !== undefined) { conditions.push('workspace_id = ?'); params.push(filter.workspaceId); }
    if (filter.parentProcessId !== undefined) { conditions.push('parent_process_id = ?'); params.push(filter.parentProcessId); }
    if (filter.status !== undefined) {
        if (Array.isArray(filter.status)) {
            conditions.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
            params.push(...filter.status);
        } else {
            conditions.push('status = ?');
            params.push(filter.status);
        }
    }
    if (filter.type !== undefined) { conditions.push('type = ?'); params.push(filter.type); }
    if (filter.since !== undefined) { conditions.push('last_event_at >= ?'); params.push(filter.since.toISOString()); }
    if (filter.until !== undefined) { conditions.push('last_event_at < ?'); params.push(filter.until.toISOString()); }
    return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function originalSummaries(store: SqliteProcessStore, filter: ProcessFilter) {
    const { clause, params } = where(filter);
    const db = store.getDatabase();
    const total = (db.prepare(`SELECT COUNT(*) AS cnt FROM processes ${clause}`).get(...params) as { cnt: number }).cnt;
    const rows = db.prepare(`SELECT ${summarySelect} FROM processes ${clause} ORDER BY last_event_at DESC
        ${filter.limit !== undefined ? 'LIMIT ?' : ''} ${filter.offset !== undefined ? 'OFFSET ?' : ''}`)
        .all(...params, ...filter.limit !== undefined ? [filter.limit] : [], ...filter.offset !== undefined ? [filter.offset] : []) as IndexRow[];
    const entries = rows.map(row => originalEntry(row, true));
    for (const entry of entries) {
        const links = db.prepare(`SELECT m.group_id FROM task_group_members m
            JOIN task_groups g ON g.workspace_id = m.workspace_id AND g.group_id = m.group_id
            WHERE g.type = ? AND m.process_id = ? ORDER BY m.linked_at ASC, m.id ASC`)
            .all(CHAT_FOLDER_GROUP_TYPE, entry.id) as Array<{ group_id: string }>;
        if (links.length) entry.folderId = links[links.length - 1].group_id;
    }
    return { entries, total, rows };
}

type RecentOptions = Parameters<SqliteProcessStore['listRecentProcesses']>[0];
function originalRecent(store: SqliteProcessStore, options: RecentOptions) {
    const conditions = ['archived = 0'];
    const params: unknown[] = [];
    if (options.workspaceId) { conditions.push('workspace_id = ?'); params.push(options.workspaceId); }
    if (options.excludeProcessId) { conditions.push('id != ?'); params.push(options.excludeProcessId); }
    if (options.since) { conditions.push('last_event_at >= ?'); params.push(options.since.toISOString()); }
    if (options.until) { conditions.push('last_event_at < ?'); params.push(options.until.toISOString()); }
    const limit = Math.min(Math.max(1, options.limit ?? 10), 100);
    const offset = Math.max(0, options.offset ?? 0);
    const rows = store.getDatabase().prepare(`SELECT ${recentSelect} FROM processes
        WHERE ${conditions.join(' AND ')} ORDER BY last_event_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as IndexRow[];
    return { entries: rows.map(row => originalEntry(row, false)), rows };
}

function compareRows(native: Array<Record<string, unknown>>, original: IndexRow[]) {
    const sorted = (rows: Array<Record<string, unknown>>) =>
        bytes(rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
    expect(sorted(native)).toBe(sorted(original));
}

describe('AC-07 typed summary/recent reads versus original SQL', () => {
    it('preserves byte-identical entries, counts, filters, paging and folder stamps', async () => {
        const store = fixture();
        const db = store.getDatabase();
        for (const [id, workspaceId, status, startTime] of [
            ['one', 'ws-a', 'completed', '2026-01-01T00:00:00Z'],
            ['two', 'ws-a', 'running', '2026-02-01T00:00:00Z'],
            ['three', 'ws-b', 'completed', '2026-03-01T00:00:00Z'],
        ] as const) {
            const process: AIProcess = {
                id, status, type: 'chat', promptPreview: id, startTime: new Date(startTime),
                metadata: { workspaceId, type: 'chat' },
            };
            await store.addProcess(process);
        }
        await store.updateProcess('one', { customTitle: 'A title', pinnedAt: '2026-04-01T00:00:00Z' });
        await store.updateProcess('two', { pendingAskUser: [{ id: 'ask' }] } as Partial<AIProcess>);
        db.prepare(`UPDATE processes SET metadata = json_set(metadata, '$.compaction', json(?)) WHERE id = ?`)
            .run('{"count":2}', 'one');
        const groups = new SqliteTaskGroupStore(db);
        const timestamp = '2026-01-01T00:00:00Z';
        groups.upsertGroup({ groupId: 'folder', workspaceId: 'ws-a', type: CHAT_FOLDER_GROUP_TYPE,
            title: 'Filed', status: 'draft', createdAt: timestamp, updatedAt: timestamp });
        groups.upsertGroup({ groupId: 'folder-later', workspaceId: 'ws-a', type: CHAT_FOLDER_GROUP_TYPE,
            title: 'Moved', status: 'draft', createdAt: timestamp, updatedAt: timestamp });
        groups.linkChild('ws-a', 'folder', { role: 'member', processId: 'one', linkedAt: timestamp });
        groups.linkChild('ws-a', 'folder-later', { role: 'member', processId: 'one', linkedAt: timestamp });
        const filters: ProcessFilter[] = [
            {}, { workspaceId: 'ws-a' }, { parentProcessId: 'missing' }, { status: [] },
            { status: ['completed', 'running'], type: 'chat' },
            { since: new Date('2026-02-01Z'), until: new Date('2026-04-01Z') },
            { limit: 1, offset: 1 }, { workspaceId: 'ws-a', limit: 1, offset: 1 },
        ];
        for (const filter of filters) {
            const oracle = originalSummaries(store, filter);
            expect(bytes(await store.getProcessSummaries(filter))).toBe(bytes({ entries: oracle.entries, total: oracle.total }));
            const native = await db.getProcessSummaries({
                workspaceId: filter.workspaceId, parentProcessId: filter.parentProcessId,
                statuses: filter.status === undefined ? undefined : Array.isArray(filter.status) ? filter.status : [filter.status],
                processType: filter.type, since: filter.since?.toISOString(), until: filter.until?.toISOString(),
                limit: filter.limit, offset: filter.offset,
            });
            expect(native.total).toBe(oracle.total);
            expect(native.rows.map(row => row.folder_id)).toEqual(
                oracle.entries.map(entry => entry.folderId ?? null));
            compareRows(native.rows.map(({ folder_id: _folderId, ...row }) => row), oracle.rows);
        }
        const options: RecentOptions[] = [
            {}, { workspaceId: 'ws-a' }, { excludeProcessId: 'one' },
            { since: new Date('2026-02-01Z'), until: new Date('2026-04-01Z') },
            { limit: 1, offset: 1 }, { limit: 0, offset: -4 }, { limit: 999 },
        ];
        for (const option of options) {
            const oracle = originalRecent(store, option);
            expect(bytes(await store.listRecentProcesses(option))).toBe(bytes(oracle.entries));
            compareRows(await db.listRecentProcesses({
                workspaceId: option.workspaceId, excludeProcessId: option.excludeProcessId,
                since: option.since?.toISOString(), until: option.until?.toISOString(),
                limit: option.limit, offset: option.offset,
            }), oracle.rows);
        }
        expect(originalSummaries(store, { workspaceId: 'ws-a' }).entries.find(entry => entry.id === 'one')?.folderId).toBe('folder-later');
    });

    it('rejects unsupported schema versions for both new reads', async () => {
        const store = fixture();
        store.getDatabase().pragma('user_version = 999');
        await expect(store.getDatabase().getProcessSummaries()).rejects.toThrow('unsupported process database user_version: 999');
        await expect(store.getDatabase().listRecentProcesses()).rejects.toThrow('unsupported process database user_version: 999');
    });
});
