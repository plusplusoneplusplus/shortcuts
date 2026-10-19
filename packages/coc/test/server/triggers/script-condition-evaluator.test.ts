import { describe, expect, it, vi } from 'vitest';
import { getScriptConditionPollDelay, ScriptConditionEvaluator } from '../../../src/server/triggers/script-condition-evaluator';
import { canonicalizeScriptConditionResult } from '../../../src/server/triggers/script-condition-result';
import type { ScriptConditionEvent, Trigger } from '../../../src/server/triggers/trigger-types';

function rule(overrides: Partial<ScriptConditionEvent> = {}): Trigger {
    return {
        id: 'script-rule', workspaceId: 'workspace-a', processId: 'sentinel-a', status: 'active',
        event: {
            type: 'script-condition', script: 'return state;', scriptRevision: 1,
            intervalMs: 900_000, consecutiveFailures: 0, paused: false, ...overrides,
        },
        action: { type: 'send-message', processId: 'sentinel-a', prompt: '', mode: 'inherit' },
        binding: { kind: 'sentinel-todo', itemId: 'item-a', armedBy: 'sentinel', armedAt: '2026-10-19T00:00:00Z' },
        inFlight: false, createdAt: '2026-10-19T00:00:00Z', expiresAt: null,
        lastTickAt: null, nextTickAt: null, revision: 1,
    };
}

function baseline(value: unknown): Partial<ScriptConditionEvent> {
    const result = canonicalizeScriptConditionResult(value);
    return { lastResult: result.canonicalJson, lastResultHash: result.hash };
}

describe('ScriptConditionEvaluator', () => {
    it.each([null, false, 0, '', [], { state: 'open' }])('stores first result %j without firing', async value => {
        const trigger = rule();
        const original = structuredClone(trigger);
        const run = vi.fn().mockResolvedValue(value);
        const outcome = await new ScriptConditionEvaluator(run).evaluate(trigger);
        expect(run).toHaveBeenCalledExactlyOnceWith(trigger, null);
        expect(outcome).toMatchObject({ fire: false, changed: true, event: baseline(value) });
        expect(trigger).toEqual(original);
    });

    it('ignores object key order at every depth', async () => {
        const trigger = rule(baseline({ state: 'open', ci: { b: 2, a: 1 } }));
        const outcome = await new ScriptConditionEvaluator(async () => ({ ci: { a: 1, b: 2 }, state: 'open' })).evaluate(trigger);
        expect(outcome).toMatchObject({ fire: false, changed: false, event: trigger.event });
    });

    it.each([
        [{ a: 1 }, { a: 2 }],
        [{ a: 1 }, { a: 1, b: null }],
        [{ a: 1 }, {}],
        [[1, 2], [2, 1]],
        [null, false],
        [0, '0'],
    ])('fires on whole-value change from %j to %j', async (before, after) => {
        const outcome = await new ScriptConditionEvaluator(async () => after).evaluate(rule(baseline(before)));
        expect(outcome).toMatchObject({ fire: true, changed: true, event: baseline(after) });
        expect(outcome.autoDisarm).toBeUndefined();
    });

    it('keeps detecting changes after firing and passes an isolated previous value each run', async () => {
        let trigger = rule(baseline({ count: 0 }));
        const run = vi.fn(async (_trigger: Trigger, state: unknown) => {
            const previous = state as { count: number };
            previous.count++;
            return previous;
        });
        const evaluator = new ScriptConditionEvaluator(run);
        for (let count = 1; count <= 3; count++) {
            const original = structuredClone(trigger);
            const outcome = await evaluator.evaluate(trigger);
            expect(outcome).toMatchObject({ fire: true, event: baseline({ count }) });
            expect(trigger).toEqual(original);
            trigger = { ...trigger, event: outcome.event };
        }
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('does not fire when a previously stored null stays null', async () => {
        const run = vi.fn().mockResolvedValue(null);
        expect(await new ScriptConditionEvaluator(run).evaluate(rule(baseline(null))))
            .toMatchObject({ fire: false, changed: false });
        expect(run.mock.calls[0][1]).toBeNull();
    });

    it.each(['paused', 'disarmed', 'expired'] as const)('does not run a %s trigger', async status => {
        const run = vi.fn();
        const trigger = { ...rule(), status };
        expect(await new ScriptConditionEvaluator(run).evaluate(trigger)).toEqual({ fire: false, event: trigger.event });
        expect(run).not.toHaveBeenCalled();
    });

    it('does not run an automatically paused event', async () => {
        const run = vi.fn();
        expect((await new ScriptConditionEvaluator(run).evaluate(rule({ paused: true }))).fire).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it.each([undefined, NaN, { invalid: undefined }, 'x'.repeat(16_384)])('records invalid or oversized result as one failure without advancing the baseline', async value => {
        const trigger = rule(baseline({ valid: true }));
        const original = structuredClone(trigger);
        const outcome = await new ScriptConditionEvaluator(async () => value).evaluate(trigger);
        expect(outcome).toMatchObject({ fire: false, changed: true,
            event: { ...baseline({ valid: true }), consecutiveFailures: 1, paused: false } });
        expect(outcome.event.lastError?.message).toBeTruthy();
        expect(trigger).toEqual(original);
    });

    it('records runner errors without mutating the previous result', async () => {
        const trigger = rule(baseline({ valid: true }));
        const original = structuredClone(trigger);
        const error = new Error('Tool denied');
        const now = Date.parse('2026-10-19T12:00:00Z');
        const outcome = await new ScriptConditionEvaluator(async () => { throw error; }, () => now).evaluate(trigger);
        expect(outcome).toMatchObject({ fire: false, changed: true,
            event: { ...baseline({ valid: true }), consecutiveFailures: 1, lastError: { message: 'Tool denied', at: new Date(now).toISOString() } } });
        expect(trigger).toEqual(original);
    });

    it('pauses at five consecutive failures and skips subsequent runs', async () => {
        const run = vi.fn().mockRejectedValue(new Error('Script failed'));
        const evaluator = new ScriptConditionEvaluator(run);
        let trigger = rule(baseline({ stable: true }));
        for (let failures = 1; failures <= 5; failures++) {
            const original = structuredClone(trigger);
            const outcome = await evaluator.evaluate(trigger);
            expect(outcome).toMatchObject({ fire: false, changed: true,
                event: { ...baseline({ stable: true }), consecutiveFailures: failures, paused: failures === 5 } });
            expect(outcome.autoDisarm).toBeUndefined();
            expect(trigger).toEqual(original);
            trigger = { ...trigger, event: outcome.event };
        }
        expect(await evaluator.evaluate(trigger)).toEqual({ fire: false, event: trigger.event });
        expect(run).toHaveBeenCalledTimes(5);
    });

    it.each([false, true])('clears errors and failures on success with changed result %s', async changed => {
        const trigger = rule({ ...baseline({ value: 1 }), consecutiveFailures: 4,
            lastError: { message: 'Failed', at: '2026-10-19T00:00:00Z' } });
        const outcome = await new ScriptConditionEvaluator(async () => ({ value: changed ? 2 : 1 })).evaluate(trigger);
        expect(outcome).toMatchObject({ fire: changed, changed: true, event: { consecutiveFailures: 0, paused: false } });
        expect(outcome.event).not.toHaveProperty('lastError');
        expect(getScriptConditionPollDelay(outcome.event)).toBe(900_000);
    });

    it('keeps first success silent after failures and restarts the failure streak', async () => {
        const run = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('again'));
        const evaluator = new ScriptConditionEvaluator(run);
        let trigger = rule();
        for (const failures of [1, 0, 1]) {
            const outcome = await evaluator.evaluate(trigger);
            expect(outcome.fire).toBe(false);
            expect(outcome.event.consecutiveFailures).toBe(failures);
            trigger = { ...trigger, event: outcome.event };
        }
        expect(trigger.event).toMatchObject(baseline(null));
    });

    it.each([
        [new Error('x'.repeat(1_000)), 'x'.repeat(500)],
        [new Error(''), 'Unknown error'],
        ['thrown string', 'thrown string'],
        [null, 'null'],
        [Object.create(null), 'Unknown error'],
    ])('stores bounded error text for case %#', async (error, message) => {
        const outcome = await new ScriptConditionEvaluator(async () => { throw error; }).evaluate(rule());
        expect(outcome.event.lastError?.message).toBe(message);
        expect(outcome.event.consecutiveFailures).toBe(1);
        expect(outcome.event.lastResult).toBeUndefined();
        expect(outcome.event.lastResultHash).toBeUndefined();
    });

    it('records a corrupt stored baseline as a failure without invoking the runner', async () => {
        const run = vi.fn();
        const outcome = await new ScriptConditionEvaluator(run).evaluate(rule({ lastResult: '{', lastResultHash: 'stored' }));
        expect(outcome).toMatchObject({ fire: false, event: { lastResult: '{', lastResultHash: 'stored', consecutiveFailures: 1 } });
        expect(run).not.toHaveBeenCalled();
    });

    it('rejects other event kinds before executing the runner', async () => {
        const run = vi.fn();
        const trigger: Trigger = { ...rule(), event: { type: 'date-time', firesAt: '2026-10-20T00:00:00Z', timeZone: 'UTC' } };
        await expect(new ScriptConditionEvaluator(run).evaluate(trigger)).rejects.toThrow('cannot evaluate event date-time');
        expect(run).not.toHaveBeenCalled();
    });
});

describe('getScriptConditionPollDelay', () => {
    it.each([
        [300_000, 0, 300_000], [300_000, 1, 600_000], [300_000, 2, 1_200_000],
        [300_000, 3, 2_400_000], [300_000, 4, 3_600_000], [300_000, 5, 3_600_000],
        [900_000, 1, 1_800_000], [900_000, 2, 3_600_000], [900_000, 1_000, 3_600_000],
        [7_200_000, 0, 7_200_000], [7_200_000, 1, 7_200_000],
    ])('uses interval %i and failure count %i to delay %i ms', (intervalMs, consecutiveFailures, delay) => {
        const event = rule({ intervalMs, consecutiveFailures }).event as ScriptConditionEvent;
        expect(getScriptConditionPollDelay(event)).toBe(delay);
    });
});
