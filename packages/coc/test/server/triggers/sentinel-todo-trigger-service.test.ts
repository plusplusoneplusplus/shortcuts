import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, type AIProcess } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { SentinelTodoTriggerService } from '../../../src/server/triggers/sentinel-todo-trigger-service';
import { SentinelTodoTriggerFirer } from '../../../src/server/triggers/sentinel-todo-trigger-firer';
import { MAX_ACTIVE_TRIGGERS, type Trigger } from '../../../src/server/triggers/trigger-types';

const owner = { workspaceId: 'ws-owner', processId: 'sentinel-owner' };
const timestamp = '2026-01-01T00:00:00.000Z';
const prUrl = 'https://github.com/example/foreign-repo/pull/7';
const process: AIProcess = {
    id: owner.processId, type: 'chat', status: 'completed', promptPreview: '', fullPrompt: '',
    startTime: new Date(timestamp), metadata: { type: 'chat', mode: 'sentinel', workspaceId: owner.workspaceId },
};

describe('SentinelTodoTriggerService', () => {
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let triggers: TriggerStore;
    let service: SentinelTodoTriggerService;
    let itemId: string;
    const getProcess = vi.fn();
    const fetchPr = vi.fn();
    const execute = vi.fn();
    const arm = vi.fn();
    const disarm = vi.fn();
    const emit = vi.fn();
    let firer: SentinelTodoTriggerFirer;

    beforeEach(() => {
        vi.resetAllMocks();
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        todos = new SentinelTodoStore(db);
        triggers = new TriggerStore(db);
        getProcess.mockResolvedValue(process);
        fetchPr.mockResolvedValue({ status: 'open', title: 'PR title', url: prUrl });
        execute.mockResolvedValue(undefined);
        itemId = todos.create(owner, {
            title: 'Item', targetRepo: { workspaceId: 'remote-workspace', serverId: 'remote-server' },
        }, { actor: 'user' }).item.id;
        firer = new SentinelTodoTriggerFirer({ triggers, todos, processes: { getProcess }, executor: { execute }, emit });
        service = build();
    });
    afterEach(() => db.close());
    function build(enabled = true) {
        return new SentinelTodoTriggerService({
            triggers, todos, owners: new SentinelTodoService({ todos, store: { getProcess } }),
            manager: { arm, disarm }, firer, fetchPr, enabled, emit, now: () => Date.parse(timestamp),
        });
    }
    function create(input = {}) { return service.create(owner, { itemId, prUrl, ...input }, 'sentinel'); }
    function fillCap(seed: Trigger) {
        for (let n = 0; triggers.countActive() < MAX_ACTIVE_TRIGGERS; n++) {
            triggers.insert({ ...seed, id: `ci-${n}`, binding: undefined, delivery: undefined, status: 'active', outcome: undefined });
        }
    }

    it('arms indefinitely with owner-local storage, any PR identity and optional guidance', async () => {
        const before = todos.get(owner);
        const rule = await create({ instruction: 'Ship carefully', workspaceId: 'picker-workspace', originId: 'origin-picked' });
        expect(rule).toMatchObject({
            ...owner, status: 'active', expiresAt: null, revision: 1,
            binding: { itemId, armedBy: 'sentinel', armedAt: timestamp, instruction: 'Ship carefully' },
            action: { processId: owner.processId, mode: 'inherit' },
            event: { pr: {
                provider: 'github', host: 'github.com', repoPath: 'example/foreign-repo', number: 7,
                workspaceId: 'picker-workspace', originId: 'origin-picked',
            } },
        });
        expect(arm).toHaveBeenCalledWith(rule);
        expect(fetchPr).toHaveBeenCalledWith(rule.event.monitor === 'pr-merged' ? rule.event.pr : undefined);
        expect(await service.list(owner)).toEqual([rule]);
        expect(todos.get(owner)).toEqual(before);
    });

    it('arms an item with a local linked job whose process has not been persisted', async () => {
        todos.linkJob(owner, itemId, {
            processId: 'queue_unpersisted', workspaceId: owner.workspaceId,
            kind: 'local', openLink: '#repos/ws-owner/chats/unpersisted',
        });
        const before = todos.get(owner);
        const owners = new SentinelTodoService({ todos, store: { getProcess } });
        const ledger = await owners.list(owner);
        expect(ledger.items[0].jobs[0].mode).toBeUndefined();
        const rule = await create();
        expect(rule.binding?.itemId).toBe(itemId);
        expect(await service.list(owner)).toEqual([rule]);
        expect(todos.get(owner)).toEqual(before);
    });

    it.each(['create', 'edit', 'resume'] as const)('rejects manual items on %s', async operation => {
        const rule = await create();
        const manual = todos.create(owner, { title: 'Manual', type: 'manual' }, { actor: 'user' }).item;
        if (operation === 'create') await expect(create({ itemId: manual.id })).rejects.toThrow('Manual');
        if (operation === 'edit') await expect(service.edit(owner, rule.id, {
            itemId: manual.id, prUrl, expectedRevision: rule.revision,
        })).rejects.toThrow('Manual');
        if (operation === 'resume') {
            triggers.update({ ...rule, status: 'paused', binding: { ...rule.binding!, itemId: manual.id } });
            await expect(service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, false)).rejects.toThrow('Manual');
        }
    });

    it.each(['done', 'archived'] as const)('rejects creation on a %s item', async field => {
        todos.update(owner, itemId, 1, field === 'done' ? { status: 'done' } : { archived: true }, 'user');
        await expect(create()).rejects.toThrow('Done or archived');
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it.each(['merged', 'closed'] as const)('rejects arming an already %s PR', async status => {
        fetchPr.mockResolvedValue({ status, title: 'PR', url: prUrl });
        await expect(create()).rejects.toThrow(status === 'merged' ? 'use Run now' : 'closed');
        expect(triggers.getAll()).toEqual([]);
    });

    it('creates and consumes an already merged rule only with confirmed Run now', async () => {
        fetchPr.mockResolvedValue({ status: 'merged', title: 'PR', url: prUrl, mergeCommit: 'abc123' });
        await expect(create({ runNow: true })).rejects.toThrow('confirmation');
        const rule = await create({ runNow: true, confirmed: true });
        expect(rule).toMatchObject({ outcome: 'fired', delivery: { reason: 'run-now', state: 'delivered' } });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(todos.get(owner).items[0].status).toBe('todo');
    });

    it('shows a preview but never creates executable state on read/credential failure', async () => {
        const result = await service.preview(owner, { prUrl });
        expect(result).toMatchObject({ pr: { url: prUrl }, snapshot: { status: 'open', title: 'PR title' } });
        fetchPr.mockRejectedValue(new Error('Credentials unavailable'));
        await expect(service.preview(owner, { prUrl })).rejects.toThrow('Credentials unavailable');
        await expect(create()).rejects.toThrow('Credentials unavailable');
        expect(triggers.getAll()).toEqual([]);
        expect(execute).not.toHaveBeenCalled();
    });

    it('counts watches with the shared active cap on create and resume', async () => {
        const rule = await create();
        const paused = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        fillCap(rule);
        await expect(create()).rejects.toThrow('limit');
        await expect(service.setPaused(owner, paused.id, { expectedRevision: paused.revision }, false)).rejects.toThrow('limit');
        expect(triggers.countActive()).toBe(MAX_ACTIVE_TRIGGERS);
    });

    it('supports revision-checked pause, resume and edit, preserving arming attribution', async () => {
        const rule = await create();
        const paused = await service.setPaused(owner, rule.id, { expectedRevision: 1 }, true);
        expect(paused).toMatchObject({ status: 'paused', revision: 2, nextTickAt: null });
        const edited = await service.edit(owner, rule.id, { expectedRevision: 2, itemId, prUrl, instruction: 'Updated' });
        expect(edited).toMatchObject({ status: 'paused', revision: 3, binding: { armedBy: 'sentinel', instruction: 'Updated' } });
        const resumed = await service.setPaused(owner, rule.id, { expectedRevision: 3 }, false);
        expect(resumed).toMatchObject({ status: 'active', revision: 4, nextTickAt: timestamp });
        await expect(service.remove(owner, rule.id, { expectedRevision: 3 })).rejects.toMatchObject({ statusCode: 409, current: resumed });
    });

    it.each(['pause', 'edit', 'resume', 'run-now'] as const)('rejects %s on a fired terminal rule', async operation => {
        const rule = await create();
        await service.runNow(owner, rule.id, { expectedRevision: 1, confirmed: true });
        const current = triggers.getById(rule.id)!;
        const input = { expectedRevision: current.revision };
        const call = operation === 'edit' ? service.edit(owner, rule.id, { ...input, itemId, prUrl })
            : operation === 'run-now' ? service.runNow(owner, rule.id, { ...input, confirmed: true })
            : service.setPaused(owner, rule.id, input, operation === 'pause');
        await expect(call).rejects.toThrow('Terminal');
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('deletes waiting rules, but clearing a fired rule preserves its immutable receipt', async () => {
        const rule = await create();
        await service.remove(owner, rule.id, { expectedRevision: 1 });
        expect(triggers.getById(rule.id)).toBeNull();
        const fired = await create({ runNow: true, confirmed: true });
        const cleared = await service.remove(owner, fired.id, { expectedRevision: fired.revision });
        expect(cleared.binding?.removedAt).toBe(timestamp);
        expect(triggers.getById(fired.id)?.delivery).toEqual(fired.delivery);
        expect(await service.list(owner)).toEqual([]);
    });

    it('clearing a pending fired rule never loses or replays its delivery identity', async () => {
        const rule = await create();
        execute.mockRejectedValueOnce(new Error('Queue unavailable'));
        await expect(service.runNow(owner, rule.id, { expectedRevision: 1, confirmed: true })).rejects.toThrow('Queue unavailable');
        const pending = triggers.getById(rule.id)!;
        await service.remove(owner, rule.id, { expectedRevision: pending.revision });
        expect(await service.list(owner)).toEqual([]);
        await firer.deliverPending(rule.id);
        expect(triggers.getById(rule.id)?.delivery).toMatchObject({ deliveryId: pending.delivery?.deliveryId, state: 'delivered' });
    });

    it.each(['create', 'edit'] as const)('rejects item-state races during %s preflight', async operation => {
        const rule = operation === 'edit' ? await create() : undefined;
        fetchPr.mockImplementationOnce(async () => {
            todos.update(owner, itemId, 1, { status: 'done' }, 'user');
            return { status: 'open', title: 'PR', url: prUrl };
        });
        await expect(operation === 'create' ? create() : service.edit(owner, rule!.id, { itemId, prUrl, expectedRevision: 1 }))
            .rejects.toThrow('Done or archived');
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects an edit if pause changes the revision during PR lookup', async () => {
        const rule = await create();
        fetchPr.mockImplementationOnce(async () => {
            await service.setPaused(owner, rule.id, { expectedRevision: 1 }, true);
            return { status: 'open', title: 'PR', url: prUrl };
        });
        await expect(service.edit(owner, rule.id, { itemId, prUrl, expectedRevision: 1 }))
            .rejects.toThrow('revision conflict');
        expect(triggers.getById(rule.id)?.status).toBe('paused');
    });

    it('returns a Run-now revision conflict when a pause wins during fire owner lookup', async () => {
        const rule = await create();
        let calls = 0;
        getProcess.mockImplementation(async () => {
            calls++;
            if (calls === 2) triggers.update({ ...rule, status: 'paused', revision: 2, nextTickAt: null });
            return process;
        });
        await expect(service.runNow(owner, rule.id, { expectedRevision: 1, confirmed: true }))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(triggers.getById(rule.id)?.status).toBe('paused');
        expect(execute).not.toHaveBeenCalled();
    });

    it('rolls back creation if timer arming fails', async () => {
        arm.mockImplementationOnce(() => { throw new Error('Timer unavailable'); });
        await expect(create()).rejects.toThrow('Timer unavailable');
        expect(triggers.getAll()).toEqual([]);
        expect(execute).not.toHaveBeenCalled();
    });

    it('admits at most one of concurrent creates competing for the final active slot', async () => {
        const rule = await create();
        fillCap(rule);
        triggers.delete('ci-0');
        const results = await Promise.allSettled([create(), create()]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(triggers.countActive()).toBe(MAX_ACTIVE_TRIGGERS);
    });

    it('replays create receipts without rearming paused or consumed rules', async () => {
        const first = await create({ idempotencyKey: 'draft-1' });
        const paused = await service.setPaused(owner, first.id, { expectedRevision: 1 }, true);
        expect(await create({ idempotencyKey: 'draft-1' })).toEqual(paused);
        expect(arm).toHaveBeenCalledTimes(1);
        const fired = await service.runNow(owner, first.id, { expectedRevision: paused.revision, confirmed: true });
        expect(await create({ idempotencyKey: 'draft-1' })).toEqual(fired);
        expect(triggers.getAll()).toHaveLength(1);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('uses one owner-scoped rule for concurrent retries of the same editor draft', async () => {
        const [first, second] = await Promise.all([
            create({ idempotencyKey: 'draft-1' }), create({ idempotencyKey: 'draft-1' }),
        ]);
        expect(first.id).toBe(second.id);
        expect(triggers.getAll()).toHaveLength(1);
        expect(arm).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
    });

    it('never recreates a removed rule on a stale draft retry', async () => {
        const first = await create({ idempotencyKey: 'draft-1' });
        await service.remove(owner, first.id, { expectedRevision: first.revision });
        await expect(create({ idempotencyKey: 'draft-1' })).rejects.toMatchObject({ statusCode: 409 });
        expect(await service.list(owner)).toEqual([]);
        expect(triggers.countActive()).toBe(0);
        expect(arm).toHaveBeenCalledTimes(1);
    });

    it('rejects owner removal during PR preflight and foreign rule/item access', async () => {
        const rule = await create();
        getProcess.mockImplementation(async (id: string) => id === process.id ? process : { ...process, id, metadata: { ...process.metadata, mode: 'sentinel' } });
        const other = { ...owner, processId: 'other-sentinel' };
        await expect(service.remove(other, rule.id, { expectedRevision: 1 })).rejects.toMatchObject({ statusCode: 404 });
        expect(await service.list(other)).toEqual([]);
        await expect(service.create(other, { itemId, prUrl }, 'user')).rejects.toThrow('item not found');
        fetchPr.mockImplementationOnce(async () => {
            getProcess.mockResolvedValue(undefined);
            return { status: 'open', title: 'PR', url: prUrl };
        });
        await expect(create()).rejects.toThrow('Sentinel chat not found');
    });

    it.each(['list', 'preview', 'create', 'edit', 'pause', 'remove', 'run-now'] as const)(
        'gates %s with triggers.enabled and does not call providers', async operation => {
            const rule = await create();
            service = build(false);
            const input = { expectedRevision: 1 };
            const call = operation === 'list' ? service.list(owner)
                : operation === 'preview' ? service.preview(owner, { prUrl })
                : operation === 'create' ? create()
                : operation === 'edit' ? service.edit(owner, rule.id, { ...input, itemId, prUrl })
                : operation === 'remove' ? service.remove(owner, rule.id, input)
                : operation === 'run-now' ? service.runNow(owner, rule.id, { ...input, confirmed: true })
                : service.setPaused(owner, rule.id, input, true);
            await expect(call).rejects.toMatchObject({ statusCode: 403 });
            expect(execute).not.toHaveBeenCalled();
        });

    it('retires only the owner item rules inside the caller transaction and releases them after', async () => {
        const rule = await create({ idempotencyKey: 'draft-1' });
        const otherItem = todos.create(owner, { title: 'Other' }, { actor: 'user' }).item.id;
        const kept = await create({ itemId: otherItem });
        const foreign = { ...rule, id: 'foreign', workspaceId: 'ws-other', binding: { ...rule.binding!, idempotencyKey: undefined } };
        triggers.insert(foreign);
        disarm.mockClear();
        let release = () => {};
        triggers.transaction(() => { release = service.retireItemRules(owner, itemId); });
        expect(disarm).not.toHaveBeenCalled();
        expect(triggers.getById(rule.id)).toMatchObject({ status: 'disarmed', revision: 2, binding: { removedAt: timestamp } });
        expect(triggers.getById(kept.id)!.status).toBe('active');
        expect(triggers.getById('foreign')!.status).toBe('active');
        release();
        expect(disarm).toHaveBeenCalledExactlyOnceWith(rule.id);
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-disarmed' }));
        expect(service.retireItemRules(owner, itemId)).toBeTypeOf('function');
        expect(triggers.getById(rule.id)!.revision).toBe(2);
    });
});
