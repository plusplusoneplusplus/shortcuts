import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import type { SearchFilter, ConversationSearchResult } from '../src/process-store';

const dirs: string[] = [];
const stores: SqliteProcessStore[] = [];

afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createStore(): SqliteProcessStore {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.ac07-search-'));
    dirs.push(dir);
    const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
    stores.push(store);
    return store;
}

// The original TypeScript SQL implementation is kept as an independent oracle.
// Compare serialized bytes rather than just field equality (including rank/snippet).
function sqlOracle(store: SqliteProcessStore, raw: string, filter: SearchFilter = {}) {
    const sanitized = raw.replace(/[*^:{}()"]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    const empty = { results: [] as ConversationSearchResult[], total: 0 };
    if (!sanitized) return empty;
    const params: unknown[] = [sanitized];
    const conditions = ['conversation_search MATCH ?', 'p.archived = 0'];
    if (filter.workspaceId) { conditions.push('p.workspace_id = ?'); params.push(filter.workspaceId); }
    if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        conditions.push(`p.status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }
    if (filter.type) { conditions.push('p.type = ?'); params.push(filter.type); }
    if (filter.since) { conditions.push('p.last_event_at >= ?'); params.push(filter.since.toISOString()); }
    if (filter.until) { conditions.push('p.last_event_at < ?'); params.push(filter.until.toISOString()); }
    const from = `FROM conversation_search cs JOIN conversation_turns ct ON ct.id = cs.rowid
        JOIN processes p ON ct.process_id = p.id WHERE ${conditions.join(' AND ')}`;
    const total = (store.getDatabase().prepare(`SELECT COUNT(*) AS cnt ${from}`).get(...params) as { cnt: number }).cnt;
    if (!total) return empty;
    const rows = store.getDatabase().prepare(`SELECT ct.process_id, ct.turn_index, ct.role,
        snippet(conversation_search, 0, '<mark>', '</mark>', '…', 48) AS snippet,
        cs.rank, p.title AS process_title, p.prompt_preview, p.status AS process_status,
        p.type AS process_type, p.workspace_id, p.start_time
        ${from} ORDER BY cs.rank LIMIT ? OFFSET ?`
    ).all(...params, filter.limit ?? 50, filter.offset ?? 0) as Array<{
        process_id: string; turn_index: number; role: string; snippet: string; rank: number;
        process_title: string | null; prompt_preview: string | null; process_status: string;
        process_type: string; workspace_id: string; start_time: string;
    }>;
    return {
        results: rows.map(row => ({
            processId: row.process_id,
            turnIndex: row.turn_index,
            role: row.role,
            snippet: row.snippet,
            rank: row.rank,
            processTitle: row.process_title ?? undefined,
            promptPreview: row.prompt_preview ?? '',
            processStatus: row.process_status,
            processType: row.process_type,
            workspaceId: row.workspace_id,
            startTime: row.start_time,
        })),
        total,
    };
}

describe('AC-07 native FTS search parity', () => {
    it('matches original SQL bytes across sanitization, BM25, 48-token snippet, paging and filters', async () => {
        const store = createStore();
        const long = Array.from({ length: 90 }, (_, i) => i === 60 ? 'typescript' : `word${i}`).join(' ');
        for (const [id, workspace, status, content] of [
            ['one', 'ws-a', 'completed', 'typescript typescript typescript ' + long],
            ['two', 'ws-a', 'running', 'typescript rust'],
            ['four', 'ws-b', 'completed', 'typescript archived'],
        ] as const) {
            await store.addProcess({
                id, type: 'chat', status, promptPreview: id, startTime: new Date('2026-01-01T00:00:00Z'),
                metadata: { type: 'chat', workspaceId: workspace },
            });
            await store.appendConversationTurn(id, index => ({
                turnIndex: index, role: 'assistant', content,
                timestamp: new Date('2026-01-02T00:00:00Z'), timeline: [],
            }));
        }
        store.getDatabase().prepare('UPDATE processes SET archived = 1 WHERE id = ?').run('four');
        const cases: Array<[string, SearchFilter]> = [
            ['typescript', {}],
            ['"typescript*" (rust)^:', {}],
            ['\uFEFFtypescript\u00A0\u2028rust\uFEFF', {}],
            ['typescript', { workspaceId: 'ws-a', status: ['completed'], type: 'chat' }],
            ['typescript', { limit: 1, offset: 1 }],
            ['typescript', { since: new Date('2020-01-01Z'), until: new Date('2030-01-01Z') }],
            ['   ', {}],
        ];
        for (const [query, filter] of cases) {
            expect(JSON.stringify(await store.searchConversations(query, filter)))
                .toBe(JSON.stringify(sqlOracle(store, query, filter)));
        }
        expect((await store.searchConversations('\uFEFFtypescript\u00A0\u2028rust\uFEFF'))
            .results.map(hit => hit.processId)).toEqual(['two']);
        const page = await store.searchConversations('typescript');
        expect(page.total).toBe(2);
        expect(page.results.map(result => result.processId).sort()).toEqual(['one', 'two']);
        expect(page.results[0].snippet).toContain('<mark>typescript</mark>');
        expect(page.results.find(result => result.processId === 'one')!.snippet).toContain('…');
        expect(page.results[0].rank).toBeLessThan(page.results[1].rank);
    });

    it('excludes interrupted turns as a deliberate change from original SQL', async () => {
        const store = createStore();
        await store.addProcess({
            id: 'one', type: 'chat', status: 'completed', promptPreview: 'search',
            startTime: new Date('2026-01-01T00:00:00Z'),
            metadata: { type: 'chat', workspaceId: 'ws-a' },
        });
        await store.appendConversationTurn('one', index => ({
            turnIndex: index, role: 'assistant', content: 'typescript finished',
            timestamp: new Date('2026-01-01T00:00:00Z'), timeline: [],
        }));
        await store.appendConversationTurn('one', index => ({
            turnIndex: index, role: 'assistant', content: 'typescript interrupted',
            interrupted: true, timestamp: new Date('2026-01-01T00:00:00Z'), timeline: [],
        }));
        expect(sqlOracle(store, 'typescript').total).toBe(2);
        expect((await store.searchConversations('typescript')).results.map(hit => hit.turnIndex)).toEqual([0]);
        expect((await store.searchConversations('typescript')).total).toBe(1);
    });

    it('returns empty only for malformed FTS syntax and propagates database failures', async () => {
        const store = createStore();
        await store.addProcess({
            id: 'one', type: 'chat', status: 'completed', promptPreview: 'search',
            startTime: new Date('2026-01-01T00:00:00Z'),
            metadata: { type: 'chat', workspaceId: 'ws-a' },
        });
        await store.appendConversationTurn('one', index => ({
            turnIndex: index, role: 'user', content: 'search term',
            timestamp: new Date('2026-01-01T00:00:00Z'), timeline: [],
        }));
        expect(await store.searchConversations('search AND')).toEqual({ results: [], total: 0 });
        store.getDatabase().exec('DROP TABLE conversation_search');
        await expect(store.searchConversations('search')).rejects.toThrow('no such table: conversation_search');
    });

    it('rejects unsupported schema versions without swallowing the error', async () => {
        const store = createStore();
        store.getDatabase().pragma('user_version = 999');
        await expect(store.searchConversations('typescript')).rejects.toThrow('unsupported process database user_version: 999');
    });
});
