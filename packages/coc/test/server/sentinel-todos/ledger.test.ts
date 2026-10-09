import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepoDataPath } from '../../../src/server/paths';
import { atomicWriteJsonUnique } from '../../../src/server/shared/fs-utils';
import {
    MAX_TODO_ITEMS, SENTINEL_TODOS_FILE, SentinelTodoError, SentinelTodoStore,
} from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import { createSnapshotDomains } from '../../../src/server/storage/snapshot/registry';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };

function expectTodoError(fn: () => unknown, code: string): SentinelTodoError {
    try {
        fn();
    } catch (error) {
        expect(error).toBeInstanceOf(SentinelTodoError);
        expect((error as SentinelTodoError).code).toBe(code);
        return error as SentinelTodoError;
    }
    throw new Error('expected a SentinelTodoError');
}

describe('SentinelTodoStore', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todos-')); });
    afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

    it('returns an empty ledger before anything is saved', () => {
        expect(new SentinelTodoStore(dataDir).get(owner)).toEqual({ revision: 0, items: [] });
    });

    it('persists created and edited items across store instances (server restart)', () => {
        const created = new SentinelTodoStore(dataDir).create(owner, {
            title: 'Fix login', completionCondition: 'Login test passes', targetRepo: { workspaceId: 'ws-b', label: 'web' },
        }, { actor: 'user' });
        expect(created.created).toBe(true);
        expect(created.item).toMatchObject({
            title: 'Fix login', status: 'todo', archived: false, revision: 1, notes: '', createdBy: 'user',
        });
        new SentinelTodoStore(dataDir).update(owner, created.item.id, 1, { notes: 'see PR', status: 'in_progress' }, 'sentinel');

        const reloaded = new SentinelTodoStore(dataDir).get(owner);
        expect(reloaded.revision).toBe(2);
        expect(reloaded.items).toHaveLength(1);
        expect(reloaded.items[0]).toMatchObject({
            notes: 'see PR', status: 'in_progress', revision: 2, updatedBy: 'sentinel', targetRepo: { workspaceId: 'ws-b' },
        });
        expect(fs.existsSync(getRepoDataPath(dataDir, 'ws-a', SENTINEL_TODOS_FILE))).toBe(true);
    });

    it('isolates ledgers by parent chat and by workspace', () => {
        const store = new SentinelTodoStore(dataDir);
        store.create(owner, { title: 'A' }, { actor: 'user' });
        store.create({ ...owner, processId: 'queue_other' }, { title: 'B' }, { actor: 'user' });
        store.create({ workspaceId: 'group-team', processId: owner.processId }, { title: 'C' }, { actor: 'user' });
        expect(store.get(owner).items.map(item => item.title)).toEqual(['A']);
        expect(store.get({ ...owner, processId: 'queue_other' }).items.map(item => item.title)).toEqual(['B']);
        expect(store.get({ workspaceId: 'group-team', processId: owner.processId }).items.map(item => item.title)).toEqual(['C']);
    });

    it('replays a retried create with the same idempotency key', () => {
        const store = new SentinelTodoStore(dataDir);
        const first = store.create(owner, { title: 'Ship it' }, { actor: 'sentinel', idempotencyKey: 'k1' });
        const retry = store.create(owner, { title: 'Ship it' }, { actor: 'sentinel', idempotencyKey: 'k1' });
        expect(retry.created).toBe(false);
        expect(retry.item.id).toBe(first.item.id);
        expect(store.get(owner).items).toHaveLength(1);
        expect(store.get(owner).revision).toBe(1);
    });

    it('rejects the second of two edits from the same revision without changing the accepted version', () => {
        const store = new SentinelTodoStore(dataDir);
        const { item } = store.create(owner, { title: 'Draft' }, { actor: 'user' });
        store.update(owner, item.id, 1, { title: 'User title' }, 'user');
        const error = expectTodoError(() => store.update(owner, item.id, 1, { title: 'Stale AI title' }, 'sentinel'), 'conflict');
        expect(error.current).toMatchObject({ title: 'User title', revision: 2 });
        expect(store.get(owner).items[0]).toMatchObject({ title: 'User title', revision: 2, updatedBy: 'user' });
    });

    it('archives and restores without deleting notes or outcomes', () => {
        const store = new SentinelTodoStore(dataDir);
        const { item } = store.create(owner, { title: 'T', notes: 'keep me' }, { actor: 'user' });
        const done = store.update(owner, item.id, 1, { status: 'done', statusReason: 'Tests pass', outcome: 'All green' }, 'sentinel');
        expect(done.item.outcome).toMatchObject({ summary: 'All green', recordedBy: 'sentinel' });
        const archived = store.update(owner, item.id, 2, { archived: true }, 'user');
        expect(archived.item).toMatchObject({ archived: true, status: 'done', notes: 'keep me', statusReason: 'Tests pass' });
        const restored = store.update(owner, item.id, 3, { archived: false }, 'user');
        expect(restored.item).toMatchObject({ archived: false, notes: 'keep me', outcome: { summary: 'All green' } });
    });

    it('clears a stale status reason on status change and clears nullable fields', () => {
        const store = new SentinelTodoStore(dataDir);
        const { item } = store.create(owner, {
            title: 'T', status: 'needs_attention', statusReason: 'Job failed', targetRepo: { workspaceId: 'ws-b' },
        }, { actor: 'sentinel' });
        const reopened = store.update(owner, item.id, 1, { status: 'in_progress', targetRepo: null }, 'user');
        expect(reopened.item.statusReason).toBeUndefined();
        expect(reopened.item.targetRepo).toBeUndefined();
    });

    it('validates input and reports unknown items', () => {
        const store = new SentinelTodoStore(dataDir);
        expectTodoError(() => store.create(owner, { title: '  ' }, { actor: 'user' }), 'invalid');
        expectTodoError(() => store.create(owner, { title: 'x', status: 'closed' } as never, { actor: 'user' }), 'invalid');
        expectTodoError(() => store.create(owner, { title: 'x', extra: 1 } as never, { actor: 'user' }), 'invalid');
        expectTodoError(() => store.update(owner, 'missing', 1, { title: 'y' }, 'user'), 'not_found');
        const { item } = store.create(owner, { title: 'x' }, { actor: 'user' });
        expectTodoError(() => store.update(owner, item.id, 1, { archived: 'yes' } as never, 'user'), 'invalid');
        expect(store.get(owner).items[0].revision).toBe(1);
    });

    it('caps the ledger size', () => {
        const file = getRepoDataPath(dataDir, owner.workspaceId, SENTINEL_TODOS_FILE);
        const now = new Date().toISOString();
        const items = Array.from({ length: MAX_TODO_ITEMS }, (_, i) => ({
            id: `i${i}`, title: `t${i}`, completionCondition: '', notes: '', status: 'todo', archived: false,
            revision: 1, createdAt: now, updatedAt: now, createdBy: 'user', updatedBy: 'user',
        }));
        atomicWriteJsonUnique(file, { version: 1, ledgers: { [owner.processId]: { revision: 1, items } } });
        expectTodoError(() => new SentinelTodoStore(dataDir).create(owner, { title: 'one more' }, { actor: 'user' }), 'limit');
    });

    it('leaves the accepted ledger untouched when the disk write fails', () => {
        const ok = new SentinelTodoStore(dataDir);
        const { item } = ok.create(owner, { title: 'Before' }, { actor: 'user' });
        const failing = new SentinelTodoStore(dataDir, () => { throw new Error('ENOSPC'); });
        expect(() => failing.update(owner, item.id, 1, { title: 'After' }, 'user')).toThrow('ENOSPC');
        expect(() => failing.create(owner, { title: 'New' }, { actor: 'user' })).toThrow('ENOSPC');
        expect(ok.get(owner)).toMatchObject({ revision: 1, items: [{ title: 'Before', revision: 1 }] });
    });
});

describe('Sentinel to-do snapshot policy', () => {
    it('wipes ledgers with server data and never exports or imports them', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todo-snap-'));
        try {
            new SentinelTodoStore(dataDir).create(owner, { title: 'x' }, { actor: 'user' });
            expect(createSnapshotDomains().map(domain => domain.id)).toContain('sentinel-todos');
            const domain = createSentinelTodosDomain();
            const context = { dataDir, includeWikis: false } as StorageSnapshotContext;
            expect(await domain.collect(context)).toEqual({ data: {}, metadata: {}, warnings: [] });
            const wipe = await domain.planWipe(context);
            expect(wipe.plan).toEqual([getRepoDataPath(dataDir, owner.workspaceId, SENTINEL_TODOS_FILE)]);
            const errors = { errors: [] as string[] };
            await domain.executeWipe(context, wipe.plan, errors);
            expect(errors.errors).toEqual([]);
            expect(new SentinelTodoStore(dataDir).get(owner).items).toEqual([]);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});

describe('SentinelTodoService', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todo-svc-')); });
    afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

    const processes: Record<string, { mode: string; workspaceId: string }> = {
        queue_parent: { mode: 'sentinel', workspaceId: 'ws-a' },
        queue_ask: { mode: 'ask', workspaceId: 'ws-a' },
    };
    const makeService = (overrides: Partial<ConstructorParameters<typeof SentinelTodoService>[0]> = {}) => new SentinelTodoService({
        todos: new SentinelTodoStore(dataDir),
        store: { getProcess: async (id: string) => processes[id] ? { id, metadata: processes[id] } as never : undefined },
        ...overrides,
    });

    it('rejects non-Sentinel chats and forged parent workspaces', async () => {
        const service = makeService();
        await expect(service.list({ workspaceId: 'ws-a', processId: 'queue_ask' })).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.list({ workspaceId: 'ws-b', processId: 'queue_parent' })).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.create({ workspaceId: 'ws-b', processId: 'queue_parent' }, { title: 'x' }, { actor: 'sentinel' }))
            .rejects.toMatchObject({ code: 'not_found' });
        expect(new SentinelTodoStore(dataDir).get({ workspaceId: 'ws-b', processId: 'queue_parent' }).items).toEqual([]);
    });

    it('accepts a Sentinel whose first turn is still queued', async () => {
        const service = makeService({
            getTask: (taskId: string) => taskId === 'live' ? {
                type: 'chat', status: 'queued', repoId: 'ws-a', payload: { kind: 'chat', mode: 'sentinel' },
            } as never : undefined,
        });
        const created = await service.create({ workspaceId: 'ws-a', processId: 'queue_live' }, { title: 'x' }, { actor: 'user' });
        expect(created.created).toBe(true);
    });

    it('emits changes only after a committed write, and not for replays or failures', async () => {
        const onChange = vi.fn();
        const service = makeService({ onChange });
        const first = await service.create(owner, { title: 'x' }, { actor: 'user', idempotencyKey: 'k' });
        await service.create(owner, { title: 'x' }, { actor: 'user', idempotencyKey: 'k' });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({ owner, ledgerRevision: 1, item: first.item });

        await expect(service.update(owner, first.item.id, 99, { title: 'y' }, 'user')).rejects.toMatchObject({ code: 'conflict' });
        const failing = makeService({ onChange, todos: new SentinelTodoStore(dataDir, () => { throw new Error('EIO'); }) });
        await expect(failing.update(owner, first.item.id, 1, { title: 'y' }, 'user')).rejects.toThrow('EIO');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('still reports success when the change notification throws', async () => {
        const service = makeService({ onChange: () => { throw new Error('ws down'); } });
        await expect(service.create(owner, { title: 'x' }, { actor: 'user' })).resolves.toMatchObject({ created: true });
    });
});
