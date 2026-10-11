/**
 * Unit tests for `PrMergedEvaluator` and `getPrMergedPollDelay` — the
 * Sentinel To-do PR-merge watch: open keeps polling, merged fires, closed is
 * terminal `closed-unmerged`, and read errors never fire but back off.
 */

import { describe, it, expect, vi } from 'vitest';
import { PrMergedEvaluator, getPrMergedPollDelay } from '../../../src/server/triggers/pr-merged-evaluator';
import type { PrStatusSnapshot } from '../../../src/server/triggers/pr-status-fetcher';
import type { PrMergedMonitorEvent, Trigger } from '../../../src/server/triggers/trigger-types';
import { MAX_PR_MERGE_BACKOFF_MS } from '../../../src/server/triggers/trigger-types';

const NOW = Date.parse('2026-10-11T00:00:00.000Z');

function makeEvent(overrides: Partial<PrMergedMonitorEvent> = {}): PrMergedMonitorEvent {
    return {
        type: 'condition-monitor',
        monitor: 'pr-merged',
        pr: { provider: 'github', host: 'github.com', repoPath: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7' },
        pollIntervalMs: 300_000,
        consecutiveErrors: 0,
        ...overrides,
    };
}

function makeTrigger(event: PrMergedMonitorEvent): Trigger {
    return {
        id: 'trigger_1', workspaceId: 'ws', processId: 'proc', status: 'active', event,
        action: { type: 'send-message', processId: 'proc', prompt: '', mode: 'inherit' },
        inFlight: false, createdAt: '2026-10-10T00:00:00.000Z', expiresAt: null,
        lastTickAt: null, nextTickAt: null, revision: 1,
        binding: { kind: 'sentinel-todo', itemId: 'item_1', armedBy: 'user', armedAt: '2026-10-10T00:00:00.000Z' },
    };
}

function evaluatorFor(result: PrStatusSnapshot | Error) {
    const fetcher = vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { fetcher, evaluator: new PrMergedEvaluator(fetcher, () => NOW) };
}

describe('PrMergedEvaluator', () => {
    it('keeps polling an open PR and records its status/title', async () => {
        const { evaluator, fetcher } = evaluatorFor({ status: 'open', title: 'Add X', url: 'u' });
        const event = makeEvent();
        const outcome = await evaluator.evaluate(makeTrigger(event));
        expect(fetcher).toHaveBeenCalledWith(event.pr);
        expect(outcome.fire).toBe(false);
        expect(outcome.autoDisarm).toBeUndefined();
        expect(outcome.event).toMatchObject({ lastSeenStatus: 'open', lastSeenTitle: 'Add X', consecutiveErrors: 0 });
        expect(outcome.changed).toBe(true);
    });

    it('does not report a change when an open PR is unchanged', async () => {
        const { evaluator } = evaluatorFor({ status: 'draft', title: 'T', url: 'u' });
        const outcome = await evaluator.evaluate(makeTrigger(makeEvent({ lastSeenStatus: 'draft', lastSeenTitle: 'T' })));
        expect(outcome.changed).toBe(false);
    });

    it('fires when the PR is merged and records the merge commit', async () => {
        const { evaluator } = evaluatorFor({ status: 'merged', title: 'Add X', url: 'u', mergeCommit: 'abc123' });
        const outcome = await evaluator.evaluate(makeTrigger(makeEvent({ lastSeenStatus: 'open' })));
        expect(outcome.fire).toBe(true);
        expect(outcome.autoDisarm).toBeUndefined();
        expect(outcome.event).toMatchObject({ lastSeenStatus: 'merged', mergeCommit: 'abc123' });
    });

    it('fires for a merge that happened while nothing was polling (no last-seen status)', async () => {
        const { evaluator } = evaluatorFor({ status: 'merged', title: 'T', url: 'u' });
        expect((await evaluator.evaluate(makeTrigger(makeEvent()))).fire).toBe(true);
    });

    it('stops terminally as closed-unmerged when the PR closes without merging', async () => {
        const { evaluator } = evaluatorFor({ status: 'closed', title: 'T', url: 'u' });
        const outcome = await evaluator.evaluate(makeTrigger(makeEvent({ lastSeenStatus: 'open' })));
        expect(outcome.fire).toBe(false);
        expect(outcome.autoDisarm).toEqual({ status: 'disarmed', reason: 'PR closed without merging', outcome: 'closed-unmerged' });
    });

    it('records read errors without firing and counts consecutive failures', async () => {
        const { evaluator } = evaluatorFor(new Error('GitHub is not signed in on this server'));
        const outcome = await evaluator.evaluate(makeTrigger(makeEvent({ lastSeenStatus: 'open', consecutiveErrors: 2 })));
        expect(outcome.fire).toBe(false);
        expect(outcome.autoDisarm).toBeUndefined();
        expect(outcome.changed).toBe(true);
        expect(outcome.event).toMatchObject({
            lastSeenStatus: 'open',
            consecutiveErrors: 3,
            lastError: { message: 'GitHub is not signed in on this server', at: new Date(NOW).toISOString() },
        });
    });

    it('clears the error state after a successful read', async () => {
        const { evaluator } = evaluatorFor({ status: 'open', title: 'T', url: 'u' });
        const outcome = await evaluator.evaluate(makeTrigger(makeEvent({
            lastSeenStatus: 'open', lastSeenTitle: 'T', consecutiveErrors: 4, lastError: { message: 'x', at: 'y' },
        })));
        expect(outcome.event).not.toHaveProperty('lastError');
        expect(outcome.event).toMatchObject({ consecutiveErrors: 0 });
        expect(outcome.changed).toBe(true);
    });
});

describe('getPrMergedPollDelay', () => {
    it('uses the steady cadence without errors', () => {
        expect(getPrMergedPollDelay(makeEvent())).toBe(300_000);
    });

    it('doubles per consecutive error and caps at the max backoff', () => {
        expect(getPrMergedPollDelay(makeEvent({ consecutiveErrors: 1 }))).toBe(600_000);
        expect(getPrMergedPollDelay(makeEvent({ consecutiveErrors: 2 }))).toBe(1_200_000);
        expect(getPrMergedPollDelay(makeEvent({ consecutiveErrors: 3 }))).toBe(MAX_PR_MERGE_BACKOFF_MS);
        expect(getPrMergedPollDelay(makeEvent({ consecutiveErrors: 500 }))).toBe(MAX_PR_MERGE_BACKOFF_MS);
    });
});
