import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, type AIProcess } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import {
    SentinelTodoTriggerService,
    type SentinelTodoTriggerServiceDeps,
} from '../../../src/server/triggers/sentinel-todo-trigger-service';
import { SentinelTodoTriggerFirer } from '../../../src/server/triggers/sentinel-todo-trigger-firer';
import { TriggerManager } from '../../../src/server/triggers/trigger-manager';
import { ScriptConditionEvaluator } from '../../../src/server/triggers/script-condition-evaluator';
import { ScheduleTimerRegistry } from '../../../src/server/schedule/schedule-timer-registry';
import {
    DEFAULT_SCRIPT_CONDITION_INTERVAL_MS, MAX_ACTIVE_TRIGGERS, MAX_SCRIPT_CONDITIONS_PER_OWNER,
    MIN_SCRIPT_CONDITION_INTERVAL_MS, type ScriptConditionEvent, type Trigger,
} from '../../../src/server/triggers/trigger-types';

const owner = { workspaceId: 'workspace-a', processId: 'sentinel-a' };
const timestamp = '2026-01-01T00:00:00.000Z';
const process: AIProcess = {
    id: owner.processId, type: 'chat', status: 'completed', promptPreview: '', fullPrompt: '',
    startTime: new Date(timestamp), metadata: { type: 'chat', mode: 'sentinel', workspaceId: owner.workspaceId },
};
const scriptEvent = { type: 'script-condition', script: 'return { ready: true };' };
const prUrl = 'https://github.com/example/repository/pull/1';

describe('Sentinel To-do script authoring', () => {
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let triggers: TriggerStore;
    let service: SentinelTodoTriggerService;
    let firer: SentinelTodoTriggerFirer;
    let itemId: string;
    let scriptTriggersEnabled: boolean;
    let toolScriptingEnabled: boolean;
    const getProcess = vi.fn();
    const fetchPr = vi.fn();
    const execute = vi.fn();
    const arm = vi.fn();
    const disarm = vi.fn();
    const emit = vi.fn();
    const enabled = () => scriptTriggersEnabled && toolScriptingEnabled;
    const managers: TriggerManager[] = [];

    beforeEach(() => {
        vi.resetAllMocks();
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        todos = new SentinelTodoStore(db);
        triggers = new TriggerStore(db);
        getProcess.mockResolvedValue(process);
        fetchPr.mockResolvedValue({ status: 'open', title: 'Example PR', url: prUrl });
        itemId = todos.create(owner, { title: 'Track readiness' }, { actor: 'user' }).item.id;
        scriptTriggersEnabled = true;
        toolScriptingEnabled = true;
        firer = new SentinelTodoTriggerFirer({
            triggers, todos, processes: { getProcess }, executor: { execute }, emit,
            scriptConditionsEnabled: enabled,
        });
        service = build();
    });
    afterEach(() => {
        for (const manager of managers.splice(0)) manager.shutdownAll();
        db.close();
    });

    function enableRunNow() {
        const run = vi.fn().mockResolvedValue({ ready: false });
        const timers = new Map<string, () => void>();
        const timerRegistry = new ScheduleTimerRegistry();
        vi.spyOn(timerRegistry, 'set').mockImplementation((id, callback) => {
            timers.set(id, callback);
            return { wasCapped: false };
        });
        vi.spyOn(timerRegistry, 'cancel').mockImplementation(id => { timers.delete(id); });
        vi.spyOn(timerRegistry, 'has').mockImplementation(id => timers.has(id));
        vi.spyOn(timerRegistry, 'clear').mockImplementation(() => timers.clear());
        const evaluator = new ScriptConditionEvaluator(run, () => Date.parse(timestamp));
        const manager = new TriggerManager({
            store: triggers, scriptConditionFirer: firer, scriptConditionsEnabled: enabled,
            resolveEvaluator: () => evaluator, oneShotFirer: firer,
            actionExecutor: { execute: vi.fn() }, now: () => Date.parse(timestamp),
            timerRegistry,
        });
        managers.push(manager);
        service = build({ manager });
        return { manager, run, timers };
    }
    function runNow(rule: Trigger, extra = {}) {
        return service.runNow(owner, rule.id, { expectedRevision: rule.revision, confirmed: true, ...extra });
    }

    function build(overrides: Partial<SentinelTodoTriggerServiceDeps> = {}) {
        return new SentinelTodoTriggerService({
            triggers, todos, owners: new SentinelTodoService({ todos, store: { getProcess } }),
            manager: { arm, disarm }, firer, fetchPr, emit, now: () => Date.parse(timestamp),
            scriptConditionsEnabled: enabled, ...overrides,
        });
    }
    function create(event = {}, extra = {}) {
        return service.create(owner, { itemId, event: { ...scriptEvent, ...event }, ...extra }, 'sentinel');
    }
    function edit(rule: Trigger, event = {}, extra = {}) {
        return service.edit(owner, rule.id, {
            itemId, expectedRevision: rule.revision, event: { ...scriptEvent, ...event }, ...extra,
        });
    }
    function evaluated(rule: Trigger, patch: Partial<ScriptConditionEvent> = {}): Trigger {
        if (rule.event.type !== 'script-condition') throw new Error('Expected a script rule');
        const next = {
            ...rule, lastTickAt: timestamp,
            event: { ...rule.event, lastResult: '{"ready":false}', lastResultHash: 'saved-hash', ...patch },
        };
        triggers.update(next);
        return next;
    }
    function pending(rule: Trigger, reason: 'script-changed' | 'script-paused' = 'script-changed'): Trigger {
        if (rule.event.type !== 'script-condition') throw new Error('Expected a script rule');
        const next: Trigger = {
            ...rule, action: { ...rule.action, prompt: 'Immutable saved notice' },
            delivery: {
                deliveryId: `receipt-${rule.id}`, firedAt: timestamp, reason, state: 'pending',
                scriptRevision: rule.event.scriptRevision, resultHash: rule.event.lastResultHash,
            },
            outcomeReason: 'Queue unavailable',
        };
        triggers.update(next);
        return next;
    }

    it('stores owner-bound source and default cadence without reading a PR or changing the item', async () => {
        const before = todos.get(owner);
        const rule = await create({ script: '\nreturn { ready: true };\n' }, { instruction: 'Review readiness' });
        expect(rule).toMatchObject({
            ...owner, revision: 1, status: 'active', expiresAt: null, lastTickAt: null,
            nextTickAt: '2026-01-01T00:15:00.000Z',
            event: {
                type: 'script-condition', script: '\nreturn { ready: true };\n', scriptRevision: 1,
                intervalMs: DEFAULT_SCRIPT_CONDITION_INTERVAL_MS, consecutiveFailures: 0, paused: false,
            },
            binding: { kind: 'sentinel-todo', itemId, instruction: 'Review readiness', armedBy: 'sentinel' },
            action: { processId: owner.processId, prompt: '', mode: 'inherit' },
        });
        expect(triggers.getById(rule.id)).toEqual(rule);
        expect(arm).toHaveBeenCalledExactlyOnceWith(rule);
        expect(fetchPr).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(todos.get(owner)).toEqual(before);
    });

    it('accepts the five-minute floor', async () => {
        const rule = await create({ intervalMs: MIN_SCRIPT_CONDITION_INTERVAL_MS });
        expect(rule.nextTickAt).toBe('2026-01-01T00:05:00.000Z');
    });

    it.each([0, -1, 60_000, MIN_SCRIPT_CONDITION_INTERVAL_MS - 1, 300_000.5, Infinity, NaN, '300000', null, Number.MAX_SAFE_INTEGER])(
        'rejects invalid or unschedulable cadence %s on create and edit', async intervalMs => {
            const rule = await create();
            await expect(create({ intervalMs })).rejects.toMatchObject({ statusCode: 400 });
            await expect(edit(rule, { intervalMs })).rejects.toMatchObject({ statusCode: 400 });
            expect(triggers.getAll()).toEqual([rule]);
        },
    );

    it.each(['', '  \n ', null, 1])('rejects invalid source %j on create and edit', async script => {
        const rule = await create();
        await expect(create({ script })).rejects.toMatchObject({ statusCode: 400 });
        await expect(edit(rule, { script })).rejects.toMatchObject({ statusCode: 400 });
        expect(triggers.getById(rule.id)).toEqual(rule);
    });

    it.each([
        { event: { ...scriptEvent, scriptRevision: 7 } },
        { event: { ...scriptEvent, lastResult: 'true' } },
        { event: { ...scriptEvent, consecutiveFailures: 0 } },
        { event: { ...scriptEvent, paused: false } },
        { event: { ...scriptEvent, lastError: null } },
        { processId: 'foreign-owner' },
        { prUrl },
        { workspaceId: 'foreign-workspace' },
        { originId: 'foreign-origin' },
    ])('rejects caller-supplied state, owner and PR fields %j', async extra => {
        await expect(create({}, extra)).rejects.toMatchObject({ statusCode: 400 });
        expect(triggers.getAll()).toEqual([]);
    });

    it.each(['absent', 'script-flag', 'tool-flag'] as const)('defaults admission to denied with %s disabled', async gate => {
        const rule = await create();
        if (gate === 'absent') service = build({ scriptConditionsEnabled: undefined });
        if (gate === 'script-flag') scriptTriggersEnabled = false;
        if (gate === 'tool-flag') toolScriptingEnabled = false;
        await expect(create()).rejects.toMatchObject({ statusCode: 403 });
        await expect(edit(rule)).rejects.toMatchObject({ statusCode: 403 });
        expect(await service.list(owner)).toEqual([rule]);
        const paused = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        await expect(service.setPaused(owner, rule.id, { expectedRevision: paused.revision }, false))
            .rejects.toMatchObject({ statusCode: 403 });
        await service.remove(owner, rule.id, { expectedRevision: paused.revision });
        expect(await service.list(owner)).toEqual([]);
    });

    it.each(['create', 'edit'] as const)('rechecks the live gate before committing %s', async operation => {
        const rule = await create();
        let calls = 0;
        getProcess.mockImplementation(async () => {
            if (++calls === 2) scriptTriggersEnabled = false;
            return process;
        });
        await expect(operation === 'create' ? create() : edit(rule, { script: 'return false;' }))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(triggers.getAll()).toEqual([rule]);
    });

    it.each(['script', 'interval'] as const)('bumps source revision and clears baseline, errors and pending notice for %s edits', async field => {
        const rule = pending(evaluated(await create(), {
            scriptRevision: 4, consecutiveFailures: 3, lastError: { message: 'Failed', at: timestamp },
        }));
        const updated = await edit(rule, field === 'script' ? { script: 'return false;' } : { intervalMs: 600_000 });
        expect(updated).toMatchObject({
            status: 'active', revision: 2, inFlight: false,
            event: { scriptRevision: 5, consecutiveFailures: 0, paused: false },
            action: { prompt: '' },
        });
        expect(updated.event).not.toHaveProperty('lastResult');
        expect(updated.event).not.toHaveProperty('lastResultHash');
        expect(updated.event).not.toHaveProperty('lastError');
        expect(updated.delivery).toBeUndefined();
        expect(updated.outcomeReason).toBeUndefined();
        expect(updated.nextTickAt).toBe(field === 'script' ? '2026-01-01T00:15:00.000Z' : '2026-01-01T00:10:00.000Z');
        expect(disarm).toHaveBeenCalledWith(rule.id);
        expect(arm).toHaveBeenLastCalledWith(updated);
        await firer.deliverPending(rule.id);
        expect(execute).not.toHaveBeenCalled();
    });

    it('preserves script revision, baseline and failure state on guidance-only edits', async () => {
        const rule = evaluated(await create(), { consecutiveFailures: 2, lastError: { message: 'Failed', at: timestamp } });
        const updated = await edit(rule, {}, { instruction: 'Changed guidance' });
        expect(updated.event).toEqual(rule.event);
        expect(updated.revision).toBe(2);
        expect(updated.binding).toMatchObject({ instruction: 'Changed guidance', armedBy: 'sentinel' });
        expect(updated.lastTickAt).toBe(timestamp);
    });

    it('edits paused scripts without resuming them', async () => {
        const rule = await create();
        const paused = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        arm.mockClear();
        const updated = await edit(paused, { script: 'return false;' });
        expect(updated).toMatchObject({
            status: 'paused', nextTickAt: null, revision: 3,
            event: { paused: true, scriptRevision: 2 },
        });
        expect(arm).not.toHaveBeenCalled();
    });

    it('pauses and resumes delivery-bearing scripts, resets errors only on resume and preserves the baseline', async () => {
        const rule = pending(evaluated(await create(), {
            consecutiveFailures: 4, lastError: { message: 'Failure', at: timestamp },
        }));
        const paused = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        expect(paused).toMatchObject({
            revision: 2, status: 'paused', nextTickAt: null,
            event: { paused: true, consecutiveFailures: 4, lastError: { message: 'Failure' }, lastResultHash: 'saved-hash' },
        });
        expect(paused.delivery).toBeUndefined();
        const resumed = await service.setPaused(owner, rule.id, { expectedRevision: paused.revision }, false);
        expect(resumed).toMatchObject({
            revision: 3, status: 'active', nextTickAt: timestamp,
            event: { paused: false, consecutiveFailures: 0, lastResultHash: 'saved-hash', scriptRevision: 1 },
        });
        expect(resumed.event.lastError).toBeUndefined();
        expect(resumed.action.prompt).toBe('');
        expect(arm).toHaveBeenLastCalledWith(resumed);
        await firer.deliverPending(rule.id);
        expect(execute).not.toHaveBeenCalled();
    });

    it('resumes an automatically paused rule while revoking its pending pause notice', async () => {
        const rule = pending({
            ...evaluated(await create(), {
                paused: true, consecutiveFailures: 5, lastError: { message: 'Five failures', at: timestamp },
            }),
            status: 'paused', nextTickAt: null,
        }, 'script-paused');
        const resumed = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, false);
        expect(resumed).toMatchObject({
            status: 'active', event: { paused: false, consecutiveFailures: 0, lastResultHash: 'saved-hash' },
        });
        expect(resumed.delivery).toBeUndefined();
        await firer.deliverPending(rule.id);
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps delivered repeating rules mutable', async () => {
        const rule = pending(evaluated(await create()));
        triggers.update({ ...rule, delivery: { ...rule.delivery!, state: 'delivered' } });
        const updated = await edit(rule, { script: 'return 2;' });
        expect(updated.revision).toBe(2);
        expect(updated.delivery).toBeUndefined();
    });

    it('clearing a pending script preserves its receipt but stops evaluation and delivery', async () => {
        const rule = pending(evaluated(await create()));
        disarm.mockClear();
        const removed = await service.remove(owner, rule.id, { expectedRevision: rule.revision });
        expect(removed).toMatchObject({
            status: 'disarmed', revision: 2, nextTickAt: null, event: { paused: true },
            binding: { removedAt: timestamp }, delivery: rule.delivery,
        });
        expect(disarm).toHaveBeenCalledExactlyOnceWith(rule.id);
        expect(await service.list(owner)).toEqual([]);
        await firer.deliverPending(rule.id);
        expect(execute).not.toHaveBeenCalled();
    });

    it('retires scripts inside the item transaction and disarms after commit, even with a pending receipt', async () => {
        const rule = pending(evaluated(await create()));
        disarm.mockClear();
        let release = () => {};
        triggers.transaction(() => { release = service.retireItemRules(owner, itemId); });
        expect(disarm).not.toHaveBeenCalled();
        expect(triggers.getById(rule.id)).toMatchObject({ status: 'disarmed', nextTickAt: null });
        release();
        expect(disarm).toHaveBeenCalledExactlyOnceWith(rule.id);
        await firer.deliverPending(rule.id);
        expect(execute).not.toHaveBeenCalled();
    });

    it('counts paused rules toward the owner cap, allows edits/replays at capacity and frees removed slots', async () => {
        const first = await create({}, { idempotencyKey: 'draft-1' });
        for (let n = 1; n < MAX_SCRIPT_CONDITIONS_PER_OWNER; n++) await create();
        const paused = await service.setPaused(owner, first.id, { expectedRevision: first.revision }, true);
        await expect(create()).rejects.toMatchObject({ statusCode: 409 });
        expect((await create({}, { idempotencyKey: 'draft-1' })).id).toBe(first.id);
        const edited = await edit(paused, { script: 'return 2;' });
        expect(edited.event).toMatchObject({ scriptRevision: 2 });
        await service.remove(owner, first.id, { expectedRevision: edited.revision });
        await create();
        expect(await service.list(owner)).toHaveLength(MAX_SCRIPT_CONDITIONS_PER_OWNER);
    });

    it('serializes concurrent creation of the final owner slot', async () => {
        for (let n = 0; n < MAX_SCRIPT_CONDITIONS_PER_OWNER - 1; n++) await create();
        const results = await Promise.allSettled([create(), create()]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(await service.list(owner)).toHaveLength(MAX_SCRIPT_CONDITIONS_PER_OWNER);
    });

    it('applies the owner cap when converting a PR rule but lets scripts convert out', async () => {
        const pr = await service.create(owner, { itemId, prUrl }, 'user');
        for (let n = 0; n < MAX_SCRIPT_CONDITIONS_PER_OWNER; n++) await create();
        await expect(edit(pr)).rejects.toMatchObject({ statusCode: 409 });
        const script = (await service.list(owner)).find(rule => rule.event.type === 'script-condition')!;
        const converted = await service.edit(owner, script.id, { itemId, prUrl, expectedRevision: script.revision });
        expect(converted.event.monitor).toBe('pr-merged');
        expect((await edit(pr)).event).toMatchObject({ type: 'script-condition', scriptRevision: 1 });
    });

    it('scopes counts, list and mutations to the exact owner/workspace', async () => {
        const rule = await create();
        for (let n = 0; n < MAX_SCRIPT_CONDITIONS_PER_OWNER; n++) {
            triggers.insert({ ...rule, id: `other-owner-${n}`, processId: 'sentinel-b' });
            triggers.insert({ ...rule, id: `other-workspace-${n}`, workspaceId: 'workspace-b' });
        }
        expect(await service.list(owner)).toEqual([rule]);
        expect((await create()).processId).toBe(owner.processId);
        getProcess.mockImplementation(async (id: string) => ({
            ...process, id, metadata: { ...process.metadata, workspaceId: owner.workspaceId },
        }));
        const foreignOwner = { ...owner, processId: 'sentinel-b' };
        await expect(service.edit(foreignOwner, rule.id, {
            itemId, event: scriptEvent, expectedRevision: 1,
        })).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.remove(foreignOwner, rule.id, { expectedRevision: 1 })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('counts scripts toward the server cap on create and resume', async () => {
        const rule = await create();
        const paused = await service.setPaused(owner, rule.id, { expectedRevision: 1 }, true);
        for (let n = 0; n < MAX_ACTIVE_TRIGGERS; n++) {
            triggers.insert({ ...rule, id: `unbound-${n}`, binding: undefined });
        }
        await expect(create()).rejects.toMatchObject({ statusCode: 409 });
        await expect(service.setPaused(owner, rule.id, { expectedRevision: paused.revision }, false))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it.each(['manual', 'done', 'archived', 'missing'] as const)('rejects %s items', async state => {
        if (state === 'manual') itemId = todos.create(owner, { title: 'Manual', type: 'manual' }, { actor: 'user' }).item.id;
        if (state === 'done') todos.update(owner, itemId, 1, { status: 'done' }, 'user');
        if (state === 'archived') todos.update(owner, itemId, 1, { archived: true }, 'user');
        if (state === 'missing') itemId = 'missing-item';
        await expect(create()).rejects.toMatchObject({
            statusCode: state === 'manual' ? 400 : state === 'missing' ? 404 : 409,
        });
        expect(triggers.getAll()).toEqual([]);
    });

    it.each(['create', 'edit'] as const)('rechecks owner eligibility before committing %s', async operation => {
        const rule = await create();
        getProcess.mockResolvedValueOnce(process).mockResolvedValueOnce(undefined);
        await expect(operation === 'create' ? create() : edit(rule)).rejects.toThrow('Sentinel chat not found');
        expect(triggers.getAll()).toEqual([rule]);
    });

    it('revision-checks script mutations including pending rules', async () => {
        const rule = pending(evaluated(await create()));
        await expect(edit({ ...rule, revision: 2 })).rejects.toMatchObject({ statusCode: 409 });
        await expect(service.setPaused(owner, rule.id, { expectedRevision: 2 }, true)).rejects.toMatchObject({ statusCode: 409 });
        await expect(service.remove(owner, rule.id, { expectedRevision: 2 })).rejects.toMatchObject({ statusCode: 409 });
        expect(triggers.getById(rule.id)).toEqual(rule);
    });

    it('never routes script Run now to the one-shot firer while script manual admission is unwired', async () => {
        const fire = vi.spyOn(firer, 'fire');
        const rule = await create();
        await expect(service.runNow(owner, rule.id, { expectedRevision: 1, confirmed: true }))
            .rejects.toMatchObject({ statusCode: 503 });
        await expect(create({}, { runNow: true, confirmed: true })).rejects.toMatchObject({ statusCode: 503 });
        expect(triggers.getAll()).toEqual([rule]);
        expect(fire).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('runs create-and-run once silently and preserves idempotent creation replay', async () => {
        const { run, timers } = enableRunNow();
        const fire = vi.spyOn(firer, 'fire');
        const rule = await create({}, { runNow: true, confirmed: true, idempotencyKey: 'creation' });
        expect(rule).toMatchObject({ status: 'active', lastTickAt: timestamp,
            event: { lastResult: '{"ready":false}', consecutiveFailures: 0 } });
        expect(timers.has(rule.id)).toBe(true);
        expect(await create({}, { runNow: true, confirmed: true, idempotencyKey: 'creation' })).toEqual(rule);
        expect(run).toHaveBeenCalledOnce();
        expect(execute).not.toHaveBeenCalled();
        expect(fire).not.toHaveBeenCalled();
    });

    it('uses whole-result changes for repeated immediate runs without touching the item', async () => {
        const { run } = enableRunNow();
        const before = todos.get(owner);
        let rule = await runNow(await create());
        rule = await runNow(rule);
        expect(execute).not.toHaveBeenCalled();
        run.mockResolvedValueOnce({ ready: true });
        rule = await runNow(rule);
        expect(rule).toMatchObject({ status: 'active', delivery: { reason: 'script-changed', state: 'delivered' } });
        expect(rule.outcome).toBeUndefined();
        expect(execute).toHaveBeenCalledOnce();
        await runNow(rule);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(todos.get(owner)).toEqual(before);
    });

    it.each([false, true])('runs a paused rule once without resuming (baseline exists: %s)', async hasBaseline => {
        const { run, timers } = enableRunNow();
        let rule = await create();
        if (hasBaseline) rule = await runNow(rule);
        rule = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        run.mockResolvedValue({ ready: true });
        const fire = vi.spyOn(firer, 'fire');
        rule = await runNow(rule);
        expect(rule).toMatchObject({ status: 'paused', nextTickAt: null, lastTickAt: timestamp,
            event: { paused: true, consecutiveFailures: 0, lastResult: '{"ready":true}' } });
        expect(timers.has(rule.id)).toBe(false);
        expect(execute).toHaveBeenCalledTimes(hasBaseline ? 1 : 0);
        if (hasBaseline) expect(rule.action.prompt).toContain('The rule remains paused.');
        await runNow(rule);
        expect(execute).toHaveBeenCalledTimes(hasBaseline ? 1 : 0);
        expect(fire).not.toHaveBeenCalled();
    });

    it('records immediate errors, pauses on the fifth, and does not send another pause notice on paused retries', async () => {
        const { run, timers } = enableRunNow();
        let rule = await runNow(await create());
        const baseline = rule.event;
        run.mockRejectedValue(new Error('Script failed'));
        for (let n = 1; n <= 5; n++) {
            rule = await runNow(rule);
            expect(rule).toMatchObject({ event: { consecutiveFailures: n, lastError: { message: 'Script failed' },
                lastResult: (baseline as ScriptConditionEvent).lastResult } });
        }
        expect(rule.status).toBe('paused');
        expect(execute).toHaveBeenCalledOnce();
        rule = await runNow(rule);
        expect(rule).toMatchObject({ status: 'paused', nextTickAt: null, event: { paused: true, consecutiveFailures: 6 } });
        expect(execute).toHaveBeenCalledOnce();
        run.mockResolvedValue({ ready: false });
        rule = await runNow(rule);
        expect(rule).toMatchObject({ status: 'paused', event: { paused: true, consecutiveFailures: 0 } });
        expect((rule.event as ScriptConditionEvent).lastError).toBeUndefined();
        expect(timers.has(rule.id)).toBe(false);
    });

    it('keeps a manually paused rule paused when its first immediate run fails', async () => {
        const { run, timers } = enableRunNow();
        let rule = await create();
        rule = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        run.mockRejectedValue(new Error('Failure'));
        rule = await runNow(rule);
        expect(rule).toMatchObject({ status: 'paused', event: { paused: true, consecutiveFailures: 1 } });
        expect(timers.has(rule.id)).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(['script-flag', 'tool-flag', 'confirmation', 'revision', 'item'] as const)(
        'rejects immediate execution before launching for %s', async reason => {
            const { run } = enableRunNow();
            const rule = await create();
            if (reason === 'script-flag') scriptTriggersEnabled = false;
            if (reason === 'tool-flag') toolScriptingEnabled = false;
            if (reason === 'item') {
                const item = todos.get(owner).items[0];
                todos.update(owner, itemId, item.revision, { status: 'done' }, 'user');
            }
            await expect(runNow(rule, reason === 'confirmation' ? { confirmed: false }
                : reason === 'revision' ? { expectedRevision: 99 } : {})).rejects.toMatchObject({
                statusCode: reason.endsWith('flag') ? 403 : reason === 'confirmation' ? 400 : 409,
            });
            expect(run).not.toHaveBeenCalled();
        },
    );

    it.each(['edit', 'pause', 'flag', 'shutdown'] as const)(
        'discards a manual run revoked during execution by %s', async reason => {
            const { manager, run } = enableRunNow();
            const rule = await create();
            let release!: (value: unknown) => void;
            let started!: () => void;
            const running = new Promise<void>(resolve => { started = resolve; });
            run.mockImplementationOnce(async () => {
                started();
                return new Promise(resolve => { release = resolve; });
            });
            const result = runNow(rule);
            const rejected = expect(result).rejects.toMatchObject({ statusCode: 409 });
            await running;
            if (reason === 'edit') await edit(rule, { script: 'return 2;' });
            if (reason === 'pause') await service.setPaused(owner, rule.id, { expectedRevision: 1 }, true);
            if (reason === 'flag') { scriptTriggersEnabled = false; manager.refreshScriptConditions(); }
            if (reason === 'shutdown') manager.shutdownAll();
            release({ ready: true });
            await rejected;
            expect(triggers.getById(rule.id)).toMatchObject({ lastTickAt: null,
                event: { consecutiveFailures: 0 } });
            expect((triggers.getById(rule.id)!.event as ScriptConditionEvent).lastResult).toBeUndefined();
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it('rejects overlapping manual runs and a background tick cannot evaluate concurrently', async () => {
        const { run, timers } = enableRunNow();
        const rule = await create();
        const tick = timers.get(rule.id)!;
        let release!: (value: unknown) => void;
        let started!: () => void;
        const running = new Promise<void>(resolve => { started = resolve; });
        run.mockImplementationOnce(async () => {
            started();
            return new Promise(resolve => { release = resolve; });
        });
        const result = runNow(rule);
        await running;
        await expect(runNow(rule)).rejects.toMatchObject({ statusCode: 409 });
        tick();
        expect(run).toHaveBeenCalledOnce();
        release(null);
        await result;
        expect(timers.has(rule.id)).toBe(true);
    });

    it('retains a failed paused wake for restart retries without resuming evaluation', async () => {
        const { manager, run, timers } = enableRunNow();
        let rule = await runNow(await create());
        rule = await service.setPaused(owner, rule.id, { expectedRevision: rule.revision }, true);
        run.mockResolvedValue({ ready: true });
        execute.mockRejectedValueOnce(new Error('Queue unavailable'));
        await expect(runNow(rule)).rejects.toThrow('Queue unavailable');
        rule = triggers.getById(rule.id)!;
        const receipt = rule.delivery!.deliveryId;
        expect(rule).toMatchObject({ status: 'paused', event: { paused: true },
            delivery: { reason: 'script-changed', state: 'pending' } });
        await expect(runNow(rule)).rejects.toMatchObject({ statusCode: 409 });
        manager.shutdownAll();
        const replacement = enableRunNow();
        await replacement.manager.reconcilePendingDeliveries();
        expect(triggers.getById(rule.id)).toMatchObject({ status: 'paused', nextTickAt: null,
            delivery: { deliveryId: receipt, state: 'delivered' } });
        expect(replacement.run).not.toHaveBeenCalled();
        expect(replacement.timers.has(rule.id)).toBe(false);
        expect(timers.has(rule.id)).toBe(false);
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('rolls back script creation when arming fails', async () => {
        arm.mockImplementationOnce(() => { throw new Error('Timer unavailable'); });
        await expect(create()).rejects.toThrow('Timer unavailable');
        expect(triggers.getAll()).toEqual([]);
    });
});
