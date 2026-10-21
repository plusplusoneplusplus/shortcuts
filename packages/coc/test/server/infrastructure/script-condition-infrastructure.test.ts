import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteProcessStore, TaskQueueManager, type AIProcess } from '@plusplusoneplusplus/forge';
import {
    createTriggerInfrastructure,
    type TriggerInfrastructure,
    type TriggerInfrastructureOptions,
} from '../../../src/server/infrastructure/trigger-infrastructure';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { runJobGateWithOwnerTools } from '../../../src/server/sentinel-jobs/job-gate-owner-runner';
import type { ScriptConditionRunner } from '../../../src/server/triggers/script-condition-evaluator';
import type { Trigger } from '../../../src/server/triggers/trigger-types';

const owner = { workspaceId: 'workspace-a', processId: 'sentinel-a' };
const intervalMs = 300_000;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(settle => { resolve = settle; });
    return { promise, resolve };
}

describe('script-condition trigger infrastructure', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let todos: SentinelTodoStore;
    let queue: TaskQueueManager;
    let itemId: string;
    let infra: TriggerInfrastructure;
    let scriptEnabled: boolean;
    let scriptingEnabled: boolean;
    const run = vi.fn<ScriptConditionRunner>();
    const fetchPr = vi.fn();
    const enqueueAdmitted = vi.fn<NonNullable<TriggerInfrastructureOptions['deliveryBridge']['enqueueAdmitted']>>();

    beforeEach(async () => {
        vi.resetAllMocks();
        dataDir = mkdtempSync(join(tmpdir(), 'script-trigger-infra-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        await store.addProcess({
            id: owner.processId, type: 'chat', status: 'completed', promptPreview: 'Sentinel',
            startTime: new Date(), metadata: { ...owner, mode: 'sentinel' },
        });
        todos = new SentinelTodoStore(store.getDatabase());
        itemId = todos.create(owner, { title: 'Track readiness', completionCondition: 'Ready' }, { actor: 'user' }).item.id;
        queue = new TaskQueueManager();
        scriptEnabled = scriptingEnabled = true;
        run.mockResolvedValue({ ready: false });
        enqueueAdmitted.mockImplementation(async (input, validate) => {
            const process = await store.getProcess(owner.processId, owner.workspaceId);
            validate?.(process);
            return queue.enqueue(input);
        });
    });

    afterEach(() => {
        infra?.dispose();
        vi.useRealTimers();
        store.close();
        rmSync(dataDir, { recursive: true, force: true });
    });

    async function build(overrides: Partial<TriggerInfrastructureOptions> = {}) {
        infra = await createTriggerInfrastructure({
            dataDir, store, queueFacade: queue,
            deliveryBridge: {
                executeFollowUp: vi.fn(), isSessionAlive: vi.fn(),
                enqueue: async input => queue.enqueue(input), enqueueAdmitted,
                getTask: id => queue.getTask(id),
            },
            emit: vi.fn(), ciChecksFetcher: vi.fn(), prStatusFetcher: fetchPr,
            getScriptConditionsEnabled: () => scriptEnabled && scriptingEnabled,
            runScriptCondition: run,
            ...overrides,
        });
        return infra;
    }

    function create(script = 'return { ready: false };') {
        return infra.sentinelTodoTriggers.create(owner, {
            itemId, event: { type: 'script-condition', script, intervalMs },
        }, 'sentinel');
    }

    function current(id: string): Trigger {
        const rule = infra.triggerStore.getById(id);
        if (!rule) throw new Error('Missing test rule');
        return rule;
    }

    function runNow(id: string) {
        return infra.sentinelTodoTriggers.runNow(owner, id, {
            expectedRevision: current(id).revision, confirmed: true,
        });
    }

    it.each([
        { scriptEnabled: false, scriptingEnabled: true },
        { scriptEnabled: true, scriptingEnabled: false },
        { scriptEnabled: false, scriptingEnabled: false },
    ])('keeps creation and persisted timers disabled for flags %j', async flags => {
        await build();
        const rule = await create();
        infra.dispose();
        scriptEnabled = flags.scriptEnabled;
        scriptingEnabled = flags.scriptingEnabled;
        await build();
        expect(await infra.sentinelTodoTriggers.capabilities(owner)).toEqual({ dateTime: false, scriptCondition: false });
        await expect(create()).rejects.toMatchObject({ statusCode: 403 });
        expect(await infra.sentinelTodoTriggers.list(owner)).toEqual([rule]);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it.each(['runScriptCondition', 'getScriptConditionsEnabled'] as const)('fails closed without %s', async missing => {
        await build();
        const rule = await create();
        infra.dispose();
        await build({ [missing]: undefined });
        expect(infra.sentinelTodoTriggers.isScriptConditionEnabled()).toBe(false);
        await expect(create()).rejects.toMatchObject({ statusCode: 403 });
        expect(current(rule.id)).toEqual(rule);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
    });

    it('composes baseline, canonical changes and result receipt dedupe without changing the item', async () => {
        await build();
        const before = todos.get(owner);
        const rule = await create();
        await runNow(rule.id);
        expect(current(rule.id)).toMatchObject({
            status: 'active', lastTickAt: expect.any(String), event: { lastResult: '{"ready":false}', consecutiveFailures: 0 },
        });
        expect(run).toHaveBeenLastCalledWith(expect.objectContaining(owner), null, expect.any(AbortSignal));
        expect(enqueueAdmitted).not.toHaveBeenCalled();
        await runNow(rule.id);
        expect(enqueueAdmitted).not.toHaveBeenCalled();
        run.mockResolvedValue({ ready: true, ci: 'passing' });
        await runNow(rule.id);
        expect(queue.getAll()).toHaveLength(1);
        const prompt = queue.getAll()[0].payload.prompt;
        expect(prompt).toContain('UNTRUSTED DATA');
        expect(prompt).toContain('ready');
        expect(current(rule.id)).toMatchObject({ status: 'active', delivery: { state: 'delivered', reason: 'script-changed' } });
        run.mockResolvedValue({ ci: 'passing', ready: true });
        await runNow(rule.id);
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
        run.mockResolvedValue({ ready: false });
        await runNow(rule.id);
        run.mockResolvedValue({ ready: true, ci: 'passing' });
        await runNow(rule.id);
        // The owner is now queued: the second distinct result is buffered, and the
        // first result's fixed receipt still deduplicates when it recurs.
        expect(queue.getAll()).toHaveLength(1);
        expect((await store.getProcess(owner.processId))?.pendingMessages).toHaveLength(1);
        expect(todos.get(owner)).toEqual(before);
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it('uses the shared timer registry for scheduled evaluation and interval cadence', async () => {
        vi.useFakeTimers();
        await build();
        const rule = await create();
        expect(infra.timerRegistry.has(rule.id)).toBe(true);
        await vi.advanceTimersByTimeAsync(intervalMs - 1);
        expect(run).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(1);
        expect(enqueueAdmitted).not.toHaveBeenCalled();
        run.mockResolvedValue({ ready: true });
        await vi.advanceTimersByTimeAsync(intervalMs);
        expect(run).toHaveBeenCalledTimes(2);
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
        expect(infra.timerRegistry.has(rule.id)).toBe(true);
    });

    it('backs off, pauses after five failures, notices once, and resumes with a fresh failure count', async () => {
        vi.useFakeTimers();
        await build();
        const rule = await create();
        await runNow(rule.id);
        run.mockRejectedValue(new Error('Script failed'));
        await runNow(rule.id);
        expect(current(rule.id)).toMatchObject({ event: { lastResult: '{"ready":false}', consecutiveFailures: 1 } });
        expect(Date.parse(current(rule.id).nextTickAt!) - Date.now()).toBe(intervalMs * 2);
        for (let failure = 2; failure <= 5; failure++) await runNow(rule.id);
        expect(current(rule.id)).toMatchObject({
            status: 'paused', nextTickAt: null,
            event: { paused: true, consecutiveFailures: 5, lastError: { message: 'Script failed' } },
            delivery: { state: 'delivered', reason: 'script-paused' },
        });
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
        await vi.advanceTimersByTimeAsync(10 * 3_600_000);
        expect(run).toHaveBeenCalledTimes(6);
        await infra.sentinelTodoTriggers.setPaused(owner, rule.id, { expectedRevision: current(rule.id).revision }, false);
        expect(current(rule.id)).toMatchObject({ status: 'active', event: { paused: false, consecutiveFailures: 0 } });
        expect(current(rule.id).event).not.toHaveProperty('lastError');
        run.mockResolvedValue({ ready: false });
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"ready":false}', consecutiveFailures: 0 });
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
    });

    it('runs paused rules once without resuming, including changed-result wakes', async () => {
        await build();
        const rule = await create();
        await runNow(rule.id);
        await infra.sentinelTodoTriggers.setPaused(owner, rule.id, { expectedRevision: current(rule.id).revision }, true);
        run.mockResolvedValue({ ready: true });
        await runNow(rule.id);
        expect(current(rule.id)).toMatchObject({
            status: 'paused', nextTickAt: null,
            event: { paused: true, lastResult: '{"ready":true}' },
            delivery: { state: 'delivered' },
        });
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
    });

    it.each([
        { metadata: { workspaceId: owner.workspaceId, mode: 'ask' } },
        { metadata: { workspaceId: 'workspace-b', mode: 'sentinel' } },
        { status: 'cancelled' },
        { status: 'cancelling' },
        { type: 'workflow' },
    ] satisfies Partial<AIProcess>[])('rejects ineligible owner before runtime construction: %j', async patch => {
        await build();
        const rule = await create();
        await store.updateProcess(owner.processId, patch);
        await expect(infra.triggerManager.runScriptNow(rule.id, rule.revision)).rejects.toThrow('admission revoked');
        expect(run).not.toHaveBeenCalled();
        expect(current(rule.id)).toEqual(rule);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
    });

    it('does not construct a runtime for an item that became Done', async () => {
        await build();
        const rule = await create();
        const item = todos.get(owner).items[0];
        todos.update(owner, item.id, item.revision, { status: 'done', outcome: 'completed' }, 'user');
        await expect(infra.triggerManager.runScriptNow(rule.id, rule.revision)).rejects.toThrow('admission revoked');
        expect(run).not.toHaveBeenCalled();
        expect(current(rule.id)).toEqual(rule);
    });

    it.each(['success', 'failure'] as const)('suppresses late %s after owner revocation without counting a failure', async outcome => {
        await build();
        const rule = await create();
        run.mockImplementationOnce(async () => {
            await store.updateProcess(owner.processId, { status: 'cancelled' });
            if (outcome === 'failure') throw new Error('Late failure');
            return { ready: true };
        });
        await expect(runNow(rule.id)).rejects.toMatchObject({ statusCode: 409 });
        expect(current(rule.id)).toEqual(rule);
        expect(enqueueAdmitted).not.toHaveBeenCalled();
    });

    it('cancels a running evaluation on live gate refresh and can rearm after recovery', async () => {
        await build();
        const rule = await create();
        const started = deferred<AbortSignal | undefined>();
        const result = deferred<unknown>();
        run.mockImplementationOnce((_trigger, _state, signal) => { started.resolve(signal); return result.promise; });
        const running = runNow(rule.id).catch(error => error);
        const signal = await started.promise;
        scriptingEnabled = false;
        infra.triggerManager.refreshScriptConditions();
        expect(signal?.aborted).toBe(true);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
        result.resolve({ ready: true });
        expect(await running).toMatchObject({ statusCode: 409 });
        expect(current(rule.id)).toEqual(rule);
        scriptingEnabled = true;
        infra.triggerManager.refreshScriptConditions();
        expect(infra.timerRegistry.has(rule.id)).toBe(true);
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"ready":false}' });
    });

    it('rechecks the live gate after runtime resolution even without a refresh notification', async () => {
        await build();
        const rule = await create();
        run.mockImplementationOnce(async () => { scriptEnabled = false; return { ready: true }; });
        await expect(runNow(rule.id)).rejects.toMatchObject({ statusCode: 409 });
        expect(current(rule.id)).toEqual(rule);
        expect(enqueueAdmitted).not.toHaveBeenCalled();
    });

    it('suppresses stale outcomes when a persisted source revision changes during a run', async () => {
        await build();
        const rule = await create();
        run.mockImplementationOnce(async () => {
            if (rule.event.type !== 'script-condition') throw new Error('Expected script');
            infra.triggerStore.update({ ...rule, revision: rule.revision + 1,
                event: { ...rule.event, script: 'return true;', scriptRevision: 2 } });
            return { ready: true };
        });
        await expect(runNow(rule.id)).rejects.toMatchObject({ statusCode: 409 });
        expect(current(rule.id).event).toMatchObject({ scriptRevision: 2, consecutiveFailures: 0 });
        expect(current(rule.id).event).not.toHaveProperty('lastResult');
        expect(enqueueAdmitted).not.toHaveBeenCalled();
    });

    it('revokes the live delivery guard on shutdown while queue routing is pending', async () => {
        await build();
        const rule = await create();
        await runNow(rule.id);
        run.mockResolvedValue({ ready: true });
        enqueueAdmitted.mockImplementationOnce(async (input, validate) => {
            const process = await store.getProcess(owner.processId);
            infra.dispose();
            validate?.(process);
            return queue.enqueue(input);
        });
        await expect(runNow(rule.id)).rejects.toThrow('admission');
        expect(queue.getAll()).toHaveLength(0);
        expect(current(rule.id)).toMatchObject({ delivery: { state: 'pending' } });
        expect(infra.sentinelTodoTriggers.isScriptConditionEnabled()).toBe(false);
    });

    it('cancels an active runtime on disposal without persisting a late baseline', async () => {
        await build();
        const rule = await create();
        const started = deferred<AbortSignal | undefined>();
        const result = deferred<unknown>();
        run.mockImplementationOnce((_trigger, _state, signal) => { started.resolve(signal); return result.promise; });
        const running = runNow(rule.id).catch(error => error);
        const signal = await started.promise;
        infra.dispose();
        expect(signal?.aborted).toBe(true);
        result.resolve({ ready: true });
        expect(await running).toMatchObject({ statusCode: 409 });
        expect(current(rule.id)).toEqual(rule);
        expect(infra.timerRegistry.has(rule.id)).toBe(false);
    });

    it('retains pending receipts flag-off and retries them once after restart without evaluating again', async () => {
        await build();
        const rule = await create();
        await runNow(rule.id);
        run.mockResolvedValue({ ready: true });
        enqueueAdmitted.mockRejectedValueOnce(new Error('Queue unavailable'));
        await expect(runNow(rule.id)).rejects.toThrow('Failed to enqueue follow-up');
        const pending = current(rule.id);
        expect(pending.delivery?.state).toBe('pending');
        infra.dispose();
        scriptEnabled = false;
        await build();
        expect(current(rule.id)).toEqual(pending);
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledTimes(2);
        infra.dispose();
        scriptEnabled = true;
        await build();
        expect(current(rule.id)).toMatchObject({ delivery: { state: 'delivered', deliveryId: pending.delivery?.deliveryId } });
        expect(queue.getAll()).toHaveLength(1);
        expect(run).toHaveBeenCalledTimes(2);
        infra.dispose();
        await build();
        expect(enqueueAdmitted).toHaveBeenCalledTimes(2);
        expect(queue.getAll()).toHaveLength(1);
    });

    it('runs the real owner tool context and worker through production infrastructure', async () => {
        await build({
            runScriptCondition: async (trigger, state, signal) => {
                if (trigger.event.type !== 'script-condition') throw new Error('Expected script');
                return runJobGateWithOwnerTools({
                    ownerTools: { dataDir, store, workspaceId: trigger.workspaceId, processId: trigger.processId },
                    code: trigger.event.script, state, signal,
                });
            },
        });
        const rule = await create('return { count: state === null ? 1 : state.count + 1 };');
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"count":1}' });
        expect(enqueueAdmitted).not.toHaveBeenCalled();
        await runNow(rule.id);
        expect(current(rule.id).event).toMatchObject({ lastResult: '{"count":2}' });
        expect(enqueueAdmitted).toHaveBeenCalledTimes(1);
        expect(todos.get(owner).items[0].status).toBe('todo');
    });
});
