/**
 * Reference-only conversation links on Sentinel to-do items: validation,
 * persistence, idempotent duplicates, CAS, preserved status with no derived
 * execution or review, owner/workspace isolation, REST, tool and wipe.
 */
import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import {
    MAX_TODO_REFERENCES, SentinelTodoError, SentinelTodoStore, type SentinelTodoActor,
} from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { registerSentinelTodoRoutes } from '../../../src/server/sentinel-todos/sentinel-todo-routes';
import { createSentinelTodosTool } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import { sentinelTodoDisplayStatus } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import { createRouter } from '../../../src/server/shared/router';
import type { Route } from '../../../src/server/types';
import { createTodoTestDatabase, createTodoTestDirectory } from './test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const PENDING = 'Spec ready; awaiting implementation approval';

function chat(id: string, workspaceId: string, extra: Partial<AIProcess> & { mode?: string } = {}): AIProcess {
    const { mode = 'ask', ...rest } = extra;
    return { id, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: `prompt ${id}`,
        metadata: { workspaceId, mode }, ...rest } as unknown as AIProcess;
}

function expectTodoError(fn: () => unknown, code: string) {
    try { fn(); } catch (error) {
        expect(error).toBeInstanceOf(SentinelTodoError);
        expect((error as SentinelTodoError).code).toBe(code);
        return;
    }
    throw new Error('expected a SentinelTodoError');
}

describe('Sentinel to-do conversation references', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let onChange: ReturnType<typeof vi.fn>;
    const processes = new Map<string, AIProcess>();

    const pendingItem = () => todos.create(owner, {
        title: 'Browser control', completionCondition: 'Feature shipped', notes: 'Design: queue_design',
        status: 'todo', statusReason: PENDING,
    }, { actor: 'user' }).item;

    beforeEach(() => {
        database = createTodoTestDatabase(createTodoTestDirectory());
        processes.clear();
        processes.set(owner.processId, chat(owner.processId, owner.workspaceId, { mode: 'sentinel' }));
        processes.set('queue_other_sentinel', chat('queue_other_sentinel', 'ws-a', { mode: 'sentinel' }));
        processes.set('queue_design', chat('queue_design', 'ws-a', { title: 'Browser design', customTitle: 'Browser control design' }));
        processes.set('queue_remote_repo', chat('queue_remote_repo', 'ws-b', { title: 'UI redesign interview' }));
        todos = new SentinelTodoStore(database.db);
        onChange = vi.fn();
        service = new SentinelTodoService({ todos, onChange, store: { getProcess: async (id: string) => processes.get(id) } });
    });
    afterEach(() => { database.dispose(); });

    describe('store', () => {
        it('persists across handles without changing status, reasons, jobs or user-verdict bookkeeping', () => {
            const item = pendingItem();
            const result = todos.attachReference(owner, item.id, item.revision, {
                processId: 'queue_design', workspaceId: 'ws-a', openLink: '#repos/ws-a/chats/queue_design', title: 'Design',
            }, 'user');
            expect(result.changed).toBe(true);
            expect(result.item).toMatchObject({
                status: 'todo', statusReason: PENDING, notes: 'Design: queue_design', jobs: [], revision: 2, updatedBy: 'user',
            });
            expect(result.item.userEditedAt).toBeUndefined();
            expect(result.item.userVerdictRevision).toBe(item.userVerdictRevision);
            expect(result.item.references).toEqual([expect.objectContaining({
                processId: 'queue_design', workspaceId: 'ws-a', title: 'Design', attachedBy: 'user',
            })]);
            database.close();
            const reopened = createTodoTestDatabase(database.dataDir);
            try {
                expect(new SentinelTodoStore(reopened.db).get(owner).items[0]).toEqual(result.item);
            } finally { reopened.close(); }
        });

        it('treats a duplicate as an idempotent no-op even with a stale revision, and checks CAS otherwise', () => {
            const item = pendingItem();
            const input = { processId: 'queue_design', workspaceId: 'ws-a', openLink: '#x' };
            const first = todos.attachReference(owner, item.id, 1, input, 'user');
            const replay = todos.attachReference(owner, item.id, 1, input, 'sentinel');
            expect(replay).toEqual({ ...first, changed: false });
            expect(todos.get(owner).revision).toBe(first.ledgerRevision);
            expectTodoError(() => todos.attachReference(owner, item.id, 1,
                { ...input, processId: 'queue_remote_repo' }, 'user'), 'conflict');
            expect(todos.get(owner).items[0].references).toHaveLength(1);
        });

        it('distinguishes server and workspace collisions, but replays the same identity before CAS', () => {
            const item = pendingItem();
            const base = { processId: 'same-chat', workspaceId: 'ws-a', openLink: '#exact', title: 'Cached chat' };
            const targets = [base, { ...base, workspaceId: 'ws-b' },
                { ...base, serverIdentity: 'server-a', serverLabel: 'SSH host', workspaceLabel: 'Workspace A', verification: 'unverified' as const },
                { ...base, serverIdentity: 'server-b', serverLabel: 'Tunnel host', verification: 'verified' as const },
                { ...base, serverIdentity: 'server-a', workspaceId: 'ws-b' }];
            let accepted = item;
            for (const target of targets) {
                accepted = todos.attachReference(owner, item.id, accepted.revision, target, 'sentinel').item;
            }
            expect(accepted.references).toHaveLength(5);
            expect(accepted).toMatchObject({ status: item.status, statusReason: item.statusReason, jobs: [] });
            expect(accepted.userVerdictRevision).toBe(item.userVerdictRevision);
            accepted = todos.update(owner, item.id, accepted.revision, { notes: 'Retain all conversation identities' }, 'user').item;
            const ledger = todos.get(owner);
            for (const target of targets) {
                expect(todos.attachReference(owner, item.id, 1, { ...target, title: 'Different cached title' }, 'user'))
                    .toEqual({ item: accepted, ledgerRevision: ledger.revision, changed: false });
            }
            expectTodoError(() => todos.attachReference(owner, item.id, 1,
                { ...base, serverIdentity: 'server-c' }, 'user'), 'conflict');
            database.close();
            const reopened = createTodoTestDatabase(database.dataDir);
            try { expect(new SentinelTodoStore(reopened.db).get(owner)).toEqual(ledger); }
            finally { reopened.close(); }
        });

        it('migrates existing local references without changing their data or shared schema version', () => {
            const item = pendingItem();
            const local = todos.attachReference(owner, item.id, 1,
                { processId: 'same-chat', workspaceId: 'ws-a', openLink: '#local', title: 'Local chat' }, 'user');
            const version = database.db.pragma('user_version', { simple: true });
            database.db.exec(`ALTER TABLE sentinel_todo_references RENAME TO reference_backup;
                CREATE TABLE sentinel_todo_references (
                    workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL, item_id TEXT NOT NULL,
                    process_id TEXT NOT NULL, reference_order INTEGER NOT NULL CHECK (reference_order >= 0),
                    reference_workspace_id TEXT NOT NULL, open_link TEXT NOT NULL, title TEXT,
                    attached_at TEXT NOT NULL, attached_by TEXT NOT NULL CHECK (attached_by IN ('user', 'sentinel')),
                    PRIMARY KEY (workspace_id, parent_process_id, item_id, process_id),
                    UNIQUE (workspace_id, parent_process_id, item_id, reference_order),
                    FOREIGN KEY (workspace_id, parent_process_id, item_id)
                        REFERENCES sentinel_todo_items (workspace_id, parent_process_id, id) ON DELETE CASCADE
                );
                INSERT INTO sentinel_todo_references SELECT workspace_id, parent_process_id, item_id,
                    process_id, reference_order, reference_workspace_id, open_link, title, attached_at, attached_by FROM reference_backup;
                DROP TABLE reference_backup;`);
            const migrated = new SentinelTodoStore(database.db);
            expect(migrated.get(owner)).toEqual({ revision: local.ledgerRevision, items: [local.item] });
            expect(database.db.pragma('user_version', { simple: true })).toBe(version);
            const remote = migrated.attachReference(owner, item.id, 2, { processId: 'same-chat', workspaceId: 'ws-a',
                serverIdentity: 'other-server', openLink: '#remote', verification: 'unverified' }, 'sentinel');
            expect(new SentinelTodoStore(database.db).get(owner).items[0]).toEqual(remote.item);
            expect(remote.item.references).toHaveLength(2);
            expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
            database.db.prepare('DELETE FROM sentinel_todo_items WHERE id = ?').run(item.id);
            expect(database.db.prepare('SELECT COUNT(*) AS count FROM sentinel_todo_references').get()).toEqual({ count: 0 });
        });

        it('rejects invalid stable identities and verification metadata without writing', () => {
            const item = pendingItem();
            const input = { processId: 'chat', workspaceId: 'ws-a', openLink: '#exact' };
            for (const metadata of [{ serverIdentity: '' }, { serverIdentity: 'x'.repeat(201) },
                { verification: 'offline' }, { serverLabel: '' }, { workspaceLabel: 'x'.repeat(201) }]) {
                expectTodoError(() => todos.attachReference(owner, item.id, 1, { ...input, ...metadata } as never, 'user'), 'invalid');
            }
            expect(todos.get(owner).items[0]).toEqual(item);
        });

        it('rejects manual items, system actors, unknown items, unknown fields and the limit', () => {
            const manual = todos.create(owner, { type: 'manual', title: 'Call vendor' }, { actor: 'user' }).item;
            const input = { processId: 'queue_design', workspaceId: 'ws-a', openLink: '#x' };
            expectTodoError(() => todos.attachReference(owner, manual.id, 1, input, 'user'), 'invalid');
            const item = pendingItem();
            expectTodoError(() => todos.attachReference(owner, item.id, 1, input, 'system' as SentinelTodoActor), 'invalid');
            expectTodoError(() => todos.attachReference(owner, 'missing', 1, input, 'user'), 'not_found');
            expectTodoError(() => todos.attachReference(owner, item.id, 1, { ...input, serverId: 'srv' } as never, 'user'), 'invalid');
            let revision = item.revision;
            for (let i = 0; i < MAX_TODO_REFERENCES; i++) {
                revision = todos.attachReference(owner, item.id, revision, { ...input, processId: `queue_${i}` }, 'user').item.revision;
            }
            expectTodoError(() => todos.attachReference(owner, item.id, revision, { ...input, processId: 'queue_more' }, 'user'), 'limit');
        });

        it('keeps references scoped to the owning ledger', () => {
            const item = pendingItem();
            const other = { workspaceId: 'ws-b', processId: owner.processId };
            expectTodoError(() => todos.attachReference(other, item.id, 1,
                { processId: 'queue_design', workspaceId: 'ws-a', openLink: '#x' }, 'user'), 'not_found');
            todos.attachReference(owner, item.id, 1, { processId: 'queue_design', workspaceId: 'ws-a', openLink: '#x' }, 'user');
            expect(todos.get(other).items).toEqual([]);
        });
    });

    describe('service', () => {
        it('derives link and title server-side, emits once, and shows no execution or review', async () => {
            const item = pendingItem();
            const result = await service.attachReference(owner, item.id, 1, { processId: 'queue_remote_repo', workspaceId: 'ws-b' }, 'user');
            expect(result.attached).toBe(true);
            expect(result.item.references[0]).toMatchObject({
                processId: 'queue_remote_repo', workspaceId: 'ws-b', title: 'UI redesign interview',
                openLink: '#repos/ws-b/chats/queue_remote_repo',
            });
            await service.attachReference(owner, item.id, 1, { processId: 'queue_remote_repo', workspaceId: 'ws-b' }, 'user');
            expect(onChange).toHaveBeenCalledTimes(1);
            const titled = await service.attachReference(owner, item.id, 2, { processId: 'queue_design', workspaceId: 'ws-a' }, 'sentinel');
            expect(titled.item.references[1].title).toBe('Browser control design');
            const view = (await service.list(owner)).items[0];
            expect(view).toMatchObject({ status: 'todo', statusReason: PENDING, jobs: [] });
            expect(view.references).toHaveLength(2);
            expect(sentinelTodoDisplayStatus(view as never)).toBe('todo');
        });

        it('validates the conversation exists in the named workspace and is not the owner', async () => {
            const item = pendingItem();
            const attach = (processId: unknown, workspaceId: unknown) =>
                service.attachReference(owner, item.id, 1, { processId, workspaceId } as never, 'user');
            await expect(attach('queue_missing', 'ws-a')).rejects.toMatchObject({ code: 'not_found' });
            await expect(attach('queue_remote_repo', 'ws-a')).rejects.toMatchObject({ code: 'not_found' });
            await expect(attach(owner.processId, 'ws-a')).rejects.toMatchObject({ code: 'invalid' });
            await expect(attach('', 'ws-a')).rejects.toMatchObject({ code: 'invalid' });
            await expect(attach('queue_design', undefined)).rejects.toMatchObject({ code: 'invalid' });
            await expect(service.attachReference({ workspaceId: 'ws-b', processId: owner.processId }, item.id, 1,
                { processId: 'queue_design', workspaceId: 'ws-a' }, 'user')).rejects.toMatchObject({ code: 'not_found' });
            expect(todos.get(owner).items[0]).toEqual(item);
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('sentinel_todos tool', () => {
        const call = (args: Record<string, unknown>, bound = owner) =>
            (createSentinelTodosTool({ service, owner: bound }).tool as any).handler(args, {}) as Promise<any>;

        it('attaches as sentinel, defaulting to the chat workspace, and never touches status', async () => {
            const item = pendingItem();
            const result = await call({ action: 'attach_reference', itemId: item.id, expectedRevision: 1, conversationId: 'queue_design' });
            expect(result).toMatchObject({ attached: true, item: { status: 'todo', statusReason: PENDING, jobs: [] } });
            expect(result.item.references[0]).toMatchObject({ processId: 'queue_design', attachedBy: 'sentinel' });
            const cross = await call({ action: 'attach_reference', itemId: item.id, expectedRevision: 2,
                conversationId: 'queue_remote_repo', conversationWorkspaceId: 'ws-b' });
            expect(cross.item.references.map((ref: { workspaceId: string }) => ref.workspaceId)).toEqual(['ws-a', 'ws-b']);
            expect(await call({ action: 'attach_reference', itemId: item.id, expectedRevision: 3 })).toMatchObject({ code: 'invalid' });
            expect(await call({ action: 'attach_reference', itemId: item.id, expectedRevision: 1, conversationId: 'queue_x' }))
                .toMatchObject({ code: 'not_found' });
        });
    });

    describe('REST', () => {
        let server: http.Server;
        let baseUrl: string;
        beforeEach(async () => {
            const routes: Route[] = [];
            registerSentinelTodoRoutes({ routes, service });
            server = http.createServer(createRouter({ routes, spaHtml: '' }));
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const address = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${address.port}`;
        });
        afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
        const post = async (itemId: string, body: unknown) => {
            const res = await fetch(`${baseUrl}/api/workspaces/ws-a/sentinel-todos/queue_parent/items/${itemId}/references`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            return { status: res.status, body: await res.json() };
        };

        it('attaches through the client, replays idempotently and maps errors', async () => {
            const item = pendingItem();
            const client = new CocClient({ baseUrl });
            const attached = await client.sentinelTodos.attachReference('ws-a', 'queue_parent', item.id,
                { expectedRevision: 1, processId: 'queue_design', workspaceId: 'ws-a' });
            expect(attached).toMatchObject({ attached: true, ledgerRevision: 2, item: { status: 'todo', revision: 2 } });
            expect((await post(item.id, { expectedRevision: 1, processId: 'queue_design', workspaceId: 'ws-a' })).body)
                .toMatchObject({ attached: false, item: { revision: 2 } });
            expect((await post(item.id, { expectedRevision: 1, processId: 'queue_remote_repo', workspaceId: 'ws-b' })))
                .toMatchObject({ status: 409, body: { code: 'conflict', current: { revision: 2 } } });
            expect((await post(item.id, { processId: 'queue_design', workspaceId: 'ws-a' })).status).toBe(400);
            expect((await post(item.id, { expectedRevision: 2, processId: 'queue_design', workspaceId: 'ws-a', jobs: [] })).status).toBe(400);
            expect((await post(item.id, { expectedRevision: 2, processId: 'queue_design', workspaceId: 'ws-a',
                serverIdentity: 'untrusted-server', verification: 'verified' })).status).toBe(400);
            expect((await post(item.id, { expectedRevision: 2, processId: 'queue_nope', workspaceId: 'ws-a' })).status).toBe(404);
            expect((await post(item.id, { expectedRevision: 2, processId: 'queue_remote_repo', workspaceId: 'ws-b' })).status).toBe(200);
            expect(todos.get(owner).items[0].references).toHaveLength(2);
        });
    });

    describe('wipe', () => {
        it('clears references with the ledger, and tolerates databases without the references table', async () => {
            const item = pendingItem();
            todos.attachReference(owner, item.id, 1, { processId: 'queue_design', workspaceId: 'ws-a', openLink: '#x' }, 'user');
            const domain = createSentinelTodosDomain();
            const ctx = { dataDir: database.dataDir, store: undefined, includeWikis: false } as never;
            database.close();
            const result = { errors: [] as string[] };
            await domain.executeWipe(ctx, [], result);
            expect(result.errors).toEqual([]);
            const reopened = createTodoTestDatabase(database.dataDir);
            try {
                expect(reopened.db.prepare('SELECT COUNT(*) AS count FROM sentinel_todo_references').get()).toEqual({ count: 0 });
                reopened.db.exec('DROP TABLE sentinel_todo_references');
                await domain.executeWipe(ctx, [], result);
                expect(result.errors).toEqual([]);
            } finally { reopened.close(); }
        });
    });
});
