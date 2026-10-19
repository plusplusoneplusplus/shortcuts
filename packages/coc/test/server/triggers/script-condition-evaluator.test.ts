import { describe, expect, it, vi } from 'vitest';
import { ScriptConditionEvaluator } from '../../../src/server/triggers/script-condition-evaluator';
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

    it.each([undefined, NaN, { invalid: undefined }, 'x'.repeat(16_384)])('rejects invalid or oversized result without advancing the baseline', async value => {
        const trigger = rule(baseline({ valid: true }));
        const original = structuredClone(trigger);
        await expect(new ScriptConditionEvaluator(async () => value).evaluate(trigger)).rejects.toThrow();
        expect(trigger).toEqual(original);
    });

    it('propagates runner errors without mutating the previous result', async () => {
        const trigger = rule(baseline({ valid: true }));
        const original = structuredClone(trigger);
        const error = new Error('Tool denied');
        await expect(new ScriptConditionEvaluator(async () => { throw error; }).evaluate(trigger)).rejects.toBe(error);
        expect(trigger).toEqual(original);
    });

    it('rejects other event kinds before executing the runner', async () => {
        const run = vi.fn();
        const trigger: Trigger = { ...rule(), event: { type: 'date-time', firesAt: '2026-10-20T00:00:00Z', timeZone: 'UTC' } };
        await expect(new ScriptConditionEvaluator(run).evaluate(trigger)).rejects.toThrow('cannot evaluate event date-time');
        expect(run).not.toHaveBeenCalled();
    });
});
