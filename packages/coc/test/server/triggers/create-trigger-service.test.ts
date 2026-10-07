import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { createTrigger, type CreateTriggerContext } from '../../../src/server/triggers/create-trigger-service';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { createCreatePullRequestTool } from '../../../src/server/llm-tools/create-pull-request-tool';
import { initializeDatabase, resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const body = {
    processId: 'chat',
    event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'origin', prId: '77' },
};

describe('shared trigger creation', () => {
    let db: NativeDatabase;
    let ctx: CreateTriggerContext;
    const arm = vi.fn();
    const emit = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        db = new NativeDatabase(':memory:');
        ctx = { store: new TriggerStore(db), manager: { arm } as any,
            emit, enabled: true, now: () => NOW, resolveWorkspaceId: async () => 'ws' };
    });
    afterEach(() => db.close());

    it('persists, arms and broadcasts a monitor with the default autopilot action', async () => {
        const trigger = await createTrigger(ctx, 'ws', body);
        expect(ctx.store.getById(trigger.id)).toEqual(trigger);
        expect(trigger).toMatchObject({ workspaceId: 'ws', status: 'active', processId: 'chat',
            event: { originId: 'origin', prId: '77', lastSeenChecks: {} },
            action: { type: 'send-message', mode: 'autopilot', processId: 'chat' } });
        expect(arm).toHaveBeenCalledWith(trigger);
        expect(emit).toHaveBeenCalledWith({ type: 'trigger-created', trigger });
    });

    it('rejects disabled creation without writing or scheduling', async () => {
        ctx.enabled = false;
        await expect(createTrigger(ctx, 'ws', body)).rejects.toMatchObject({ statusCode: 403 });
        expect(ctx.store.getAll()).toEqual([]);
        expect(arm).not.toHaveBeenCalled();
    });

    it('rejects invalid requests', async () => {
        await expect(createTrigger(ctx, 'ws', { ...body, event: {} })).rejects.toMatchObject({ statusCode: 400 });
        expect(ctx.store.getAll()).toEqual([]);
    });

    it.each(['process', 'action'])('rejects cross-workspace %s targets', async target => {
        ctx.resolveWorkspaceId = async id => id === 'foreign' ? 'other' : 'ws';
        const request = target === 'process' ? { ...body, processId: 'foreign' }
            : { ...body, action: { processId: 'foreign' } };
        await expect(createTrigger(ctx, 'ws', request)).rejects.toMatchObject({ statusCode: 400 });
        expect(ctx.store.getAll()).toEqual([]);
        expect(arm).not.toHaveBeenCalled();
    });

    it('reuses an active monitor even under concurrent requests', async () => {
        const monitors = await Promise.all(Array.from({ length: 3 }, () => createTrigger(ctx, 'ws', body, true)));
        expect(new Set(monitors.map(t => t.id)).size).toBe(1);
        expect(ctx.store.getAll()).toHaveLength(1);
        expect(arm).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('resumes a paused monitor without resetting failure state or retry limits', async () => {
        const trigger = await createTrigger(ctx, 'ws', body, true);
        trigger.status = 'paused';
        trigger.event.lastSeenChecks = { check: 'failure' };
        trigger.event.attemptCount = 2;
        ctx.store.update(trigger);
        const resumed = await createTrigger(ctx, 'ws', body, true);
        expect(resumed).toMatchObject({ id: trigger.id, status: 'active',
            event: { lastSeenChecks: { check: 'failure' }, attemptCount: 2 } });
        expect(ctx.store.getAll()).toHaveLength(1);
        expect(emit).toHaveBeenLastCalledWith({ type: 'trigger-updated', trigger: resumed });
    });

    it.each(['disarmed', 'expired', 'elapsed'] as const)('does not reuse a %s monitor', async status => {
        const trigger = await createTrigger(ctx, 'ws', body, true);
        if (status === 'elapsed') trigger.expiresAt = new Date(NOW - 1).toISOString();
        else trigger.status = status;
        ctx.store.update(trigger);
        const next = await createTrigger(ctx, 'ws', body, true);
        expect(next.id).not.toBe(trigger.id);
        expect(next.status).toBe('active');
    });

    it('does not reuse monitors from another workspace, origin, PR or conversation', async () => {
        ctx.resolveWorkspaceId = undefined;
        const first = await createTrigger(ctx, 'ws', body, true);
        const requests: Array<[string, typeof body]> = [
            ['other', body], ['ws', { ...body, processId: 'other' }],
            ['ws', { ...body, event: { ...body.event, originId: 'other' } }],
            ['ws', { ...body, event: { ...body.event, prId: '88' } }],
        ];
        for (const [ws, request] of requests) {
            expect((await createTrigger(ctx, ws, request, true)).id).not.toBe(first.id);
        }
        expect(ctx.store.getAll()).toHaveLength(5);
    });

    it('removes a new monitor if scheduling fails', async () => {
        arm.mockImplementationOnce(() => { throw new Error('Cannot schedule'); });
        await expect(createTrigger(ctx, 'ws', body)).rejects.toThrow('Cannot schedule');
        expect(ctx.store.getAll()).toEqual([]);
        expect(emit).not.toHaveBeenCalled();
    });

    it('restores paused state when resuming cannot schedule the monitor', async () => {
        const trigger = await createTrigger(ctx, 'ws', body, true);
        trigger.status = 'paused';
        trigger.nextTickAt = null;
        ctx.store.update(trigger);
        arm.mockImplementationOnce(() => { throw new Error('Cannot schedule'); });
        await expect(createTrigger(ctx, 'ws', body, true)).rejects.toThrow('Cannot schedule');
        expect(ctx.store.getById(trigger.id)).toEqual(trigger);
    });

    it('reports persistence failures without scheduling a monitor', async () => {
        vi.spyOn(ctx.store, 'insert').mockImplementationOnce(() => { throw new Error('Trigger limit'); });
        await expect(createTrigger(ctx, 'ws', body)).rejects.toMatchObject({ statusCode: 409, message: 'Trigger limit' });
        expect(arm).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('does not report failure when broadcasting fails', async () => {
        emit.mockImplementationOnce(() => { throw new Error('Offline'); });
        const trigger = await createTrigger(ctx, 'ws', body);
        expect(ctx.store.getById(trigger.id)).toEqual(trigger);
    });

    it('arms exactly one persisted monitor when the PR tool is retried on an existing PR', async () => {
        initializeDatabase(db);
        const remoteUrl = 'https://github.com/example/repo.git';
        const originId = resolveCanonicalOriginId({ workspaceId: 'ws', remoteUrl });
        const { tool } = createCreatePullRequestTool({
            workspaceId: 'ws', processId: 'chat',
            store: { getDatabase: () => db, getWorkspaces: async () => [
                { id: 'ws', name: 'repo', rootPath: process.cwd(), remoteUrl },
            ] },
            createPullRequest: async () => ({ id: 77, url: `${remoteUrl}/pull/77`, provider: 'github',
                branch: 'feature', base: 'main', existing: true, autoMerge: { requested: false, enabled: false } }),
            getCreateTrigger: () => (ws, request, reuse) => createTrigger(ctx, ws, request, reuse),
        });
        const invoke = () => tool.handler({ title: 'T', autoFix: true }, {} as any);
        const first = await invoke();
        expect(await invoke()).toEqual(first);
        expect(ctx.store.getAll()).toHaveLength(1);
        expect(ctx.store.getAll()[0]).toMatchObject({ workspaceId: 'ws', processId: 'chat',
            event: { originId, prId: '77' } });
        expect(arm).toHaveBeenCalledTimes(1);
    });
});
