/**
 * CI-Failure Evaluator Tests
 *
 * Unit tests for `CiFailureEvaluator` transition detection and auto-disarm.
 * The checks fetcher is faked, so these tests are pure (no provider/HTTP/file
 * I/O) and cross-platform safe.
 *
 * Covers AC-02 DoD:
 *  - green → failure fires exactly once; failure → failure does not re-fire.
 *  - a new run that newly fails fires again.
 *  - currently-green keeps the monitor armed (no fire, refreshed state).
 *  - auto-disarm on PR merge/close.
 */

import { describe, it, expect } from 'vitest';
import {
    CiFailureEvaluator,
    type CiPrChecksSnapshot,
} from '../../../src/server/triggers/ci-failure-evaluator';
import type { Trigger, TriggerEvent } from '../../../src/server/triggers/trigger-types';

// ============================================================================
// Helpers
// ============================================================================

function makeTrigger(lastSeenChecks: Record<string, string>, overrides: Partial<Trigger> = {}): Trigger {
    const event: TriggerEvent = {
        type: 'condition-monitor',
        monitor: 'ci-failure',
        originId: 'origin_1',
        prId: '42',
        pollIntervalMs: 60_000,
        lastSeenChecks,
    };
    return {
        id: 'trigger_1',
        workspaceId: 'ws_a',
        processId: 'proc_a',
        status: 'active',
        event,
        action: { type: 'send-message', processId: 'proc_a', prompt: 'fix the CI', mode: 'autopilot' },
        inFlight: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        lastTickAt: null,
        nextTickAt: null,
        ...overrides,
    };
}

/** A fetcher that returns a queue of snapshots (one per call), tracking calls. */
function queuedFetcher(snapshots: CiPrChecksSnapshot[]) {
    const calls: Array<{ workspaceId: string; originId: string; prId: string }> = [];
    let i = 0;
    const fn = async (args: { workspaceId: string; originId: string; prId: string }) => {
        calls.push(args);
        const snap = snapshots[Math.min(i, snapshots.length - 1)];
        i += 1;
        return snap;
    };
    return Object.assign(fn, { calls });
}

const openWith = (checks: CiPrChecksSnapshot['checks']): CiPrChecksSnapshot => ({
    prStatus: 'open',
    prNumber: '42',
    checks,
});

// ============================================================================
// Tests
// ============================================================================

describe('CiFailureEvaluator', () => {
    it('fires exactly once on a green → failure transition', async () => {
        const fetcher = queuedFetcher([
            openWith([{ id: 'build', name: 'build', status: 'failure', detailsUrl: 'https://ci/build' }]),
        ]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({ build: 'success' }));

        expect(outcome.fire).toBe(true);
        expect(outcome.autoDisarm).toBeUndefined();
        expect(outcome.event.type === 'condition-monitor' && outcome.event.lastSeenChecks).toEqual({ build: 'failure' });
        expect(outcome.actionPrompt).toContain('#42');
        expect(outcome.actionPrompt).toContain('https://ci/build');
    });

    it('fires on a pending → failure transition', async () => {
        const fetcher = queuedFetcher([openWith([{ id: 'test', name: 'test', status: 'failure' }])]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({ test: 'pending' }));

        expect(outcome.fire).toBe(true);
    });

    it('does NOT re-fire on failure → failure for the same check', async () => {
        const fetcher = queuedFetcher([openWith([{ id: 'build', name: 'build', status: 'failure' }])]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({ build: 'failure' }));

        expect(outcome.fire).toBe(false);
        // State is refreshed (still failure) and tracked.
        expect(outcome.event.type === 'condition-monitor' && outcome.event.lastSeenChecks).toEqual({ build: 'failure' });
    });

    it('fires again when a newly-appeared check fails', async () => {
        // A new run/check id appears (lint) and is failing; build was already
        // failing and seen, so it alone would not re-fire.
        const fetcher = queuedFetcher([
            openWith([
                { id: 'build', name: 'build', status: 'failure' },
                { id: 'lint', name: 'lint', status: 'failure', detailsUrl: 'https://ci/lint' },
            ]),
        ]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({ build: 'failure' }));

        expect(outcome.fire).toBe(true);
        // Prompt names every currently-failing check.
        expect(outcome.actionPrompt).toContain('build');
        expect(outcome.actionPrompt).toContain('lint');
        expect(outcome.actionPrompt).toContain('https://ci/lint');
    });

    it('re-fires when a check goes failure → success → failure (same id)', async () => {
        const evaluator = new CiFailureEvaluator(
            queuedFetcher([openWith([{ id: 'build', name: 'build', status: 'failure' }])]),
        );
        // Previously seen as success (recovered), now failing again → fire.
        const outcome = await evaluator.evaluate(makeTrigger({ build: 'success' }));
        expect(outcome.fire).toBe(true);
    });

    it('does NOT fire and keeps polling when currently green', async () => {
        const fetcher = queuedFetcher([
            openWith([
                { id: 'build', name: 'build', status: 'success' },
                { id: 'test', name: 'test', status: 'running' },
            ]),
        ]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({ build: 'success' }));

        expect(outcome.fire).toBe(false);
        expect(outcome.autoDisarm).toBeUndefined();
        // Refreshed snapshot reflects the latest observed statuses.
        expect(outcome.event.type === 'condition-monitor' && outcome.event.lastSeenChecks).toEqual({
            build: 'success',
            test: 'running',
        });
    });

    it('requests auto-disarm when the PR is merged', async () => {
        const fetcher = queuedFetcher([
            { prStatus: 'merged', prNumber: '42', checks: [{ id: 'build', name: 'build', status: 'failure' }] },
        ]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({ build: 'success' }));

        expect(outcome.fire).toBe(false);
        expect(outcome.autoDisarm).toEqual({ status: 'disarmed', reason: 'PR merged' });
    });

    it('requests auto-disarm when the PR is closed', async () => {
        const fetcher = queuedFetcher([
            { prStatus: 'closed', prNumber: '42', checks: [] },
        ]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({}));

        expect(outcome.fire).toBe(false);
        expect(outcome.autoDisarm).toEqual({ status: 'disarmed', reason: 'PR closed' });
    });

    it('keeps polling (no disarm) while the PR is a draft', async () => {
        const fetcher = queuedFetcher([
            { prStatus: 'draft', prNumber: '42', checks: [{ id: 'build', name: 'build', status: 'success' }] },
        ]);
        const evaluator = new CiFailureEvaluator(fetcher);

        const outcome = await evaluator.evaluate(makeTrigger({}));

        expect(outcome.autoDisarm).toBeUndefined();
        expect(outcome.fire).toBe(false);
    });

    it('passes the workspace/origin/PR identifiers to the fetcher', async () => {
        const fetcher = queuedFetcher([openWith([])]);
        const evaluator = new CiFailureEvaluator(fetcher);

        await evaluator.evaluate(makeTrigger({}));

        expect(fetcher.calls[0]).toEqual({ workspaceId: 'ws_a', originId: 'origin_1', prId: '42' });
    });
});
