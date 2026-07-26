import { describe, expect, it } from 'vitest';
import {
    WorkspacePullPollScheduler,
    type WorkspacePullPollSchedulerAdapter,
    type WorkspacePullPollTimerApi,
    type WorkspacePullPollWorkspaceConfig,
} from '../../../src/server/work-items/workspace-pull-poll-scheduler';

interface FakeResult {
    warnings: string[];
    errors: string[];
}

interface ScheduledTimer {
    id: number;
    ms: number;
    handler: () => void | Promise<void>;
    unrefCalls: number;
}

/** A recording timer API that never touches the real event loop. */
function makeTimerApi(): { timerApi: WorkspacePullPollTimerApi; scheduled: ScheduledTimer[]; cleared: number[] } {
    const scheduled: ScheduledTimer[] = [];
    const cleared: number[] = [];
    const timerApi: WorkspacePullPollTimerApi = {
        setInterval(handler, ms) {
            const timer: ScheduledTimer = { id: scheduled.length + 1, ms, handler, unrefCalls: 0 };
            scheduled.push(timer);
            return { id: timer.id, unref: () => { timer.unrefCalls++; } };
        },
        clearInterval(timer) {
            cleared.push((timer as { id: number }).id);
        },
    };
    return { timerApi, scheduled, cleared };
}

interface AdapterState {
    workspaceIds: string[];
    syncEnabled: boolean;
    config: Map<string, WorkspacePullPollWorkspaceConfig>;
    eligible: Set<string>;
    pollThrows: Map<string, Error>;
    pollResults: Map<string, FakeResult>;
    polled: string[];
}

function makeAdapter(
    state: AdapterState,
    overrides: Partial<WorkspacePullPollSchedulerAdapter<FakeResult>> = {},
): WorkspacePullPollSchedulerAdapter<FakeResult> {
    return {
        logPrefix: 'work-items/test-poll',
        defaultIntervalMinutes: 5,
        listWorkspaceIds: async () => [...state.workspaceIds],
        isSyncEnabled: () => state.syncEnabled,
        getWorkspaceConfig: (workspaceId) =>
            state.config.get(workspaceId) ?? { pollingEnabled: true, pollIntervalMinutes: undefined },
        hasEligibleWork: async (workspaceId) => state.eligible.has(workspaceId),
        poll: async (workspaceId) => {
            state.polled.push(workspaceId);
            const thrown = state.pollThrows.get(workspaceId);
            if (thrown) throw thrown;
            return state.pollResults.get(workspaceId) ?? { warnings: [], errors: [] };
        },
        resultLogMessages: (result) => [...result.warnings, ...result.errors],
        ...overrides,
    };
}

function baseState(workspaceIds: string[]): AdapterState {
    return {
        workspaceIds,
        syncEnabled: true,
        config: new Map(),
        eligible: new Set(workspaceIds),
        pollThrows: new Map(),
        pollResults: new Map(),
        polled: [],
    };
}

describe('WorkspacePullPollScheduler', () => {
    it('schedules a workspace timer on start and clears it on dispose', async () => {
        const { timerApi, scheduled, cleared } = makeTimerApi();
        const state = baseState(['ws-a']);
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].ms).toBe(5 * 60 * 1000);

        scheduler.dispose();
        expect(cleared).toEqual([1]);
    });

    it('is idempotent across repeated start and dispose calls', async () => {
        const { timerApi, scheduled, cleared } = makeTimerApi();
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(baseState(['ws-a'])), { timerApi });

        await scheduler.start();
        await scheduler.start();
        expect(scheduled).toHaveLength(1);

        scheduler.dispose();
        scheduler.dispose();
        expect(cleared).toEqual([1]);

        // Starting again after dispose reconciles a fresh timer.
        await scheduler.start();
        expect(scheduled).toHaveLength(2);
    });

    it('adds a timer when a workspace appears and removes it when the workspace goes away', async () => {
        const { timerApi, scheduled, cleared } = makeTimerApi();
        const state = baseState(['ws-a']);
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(1);

        state.workspaceIds = ['ws-a', 'ws-b'];
        state.eligible.add('ws-b');
        await scheduler.refreshWorkspaceTimers();
        expect(scheduled).toHaveLength(2);

        state.workspaceIds = ['ws-a'];
        await scheduler.refreshWorkspaceTimers();
        // ws-b's timer (id 2) is cleared once it is no longer active.
        expect(cleared).toContain(2);
    });

    it('suppresses and clears timers when global sync is disabled', async () => {
        const { timerApi, scheduled, cleared } = makeTimerApi();
        const state = baseState(['ws-a']);
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(1);

        state.syncEnabled = false;
        await scheduler.configureWorkspace('ws-a');
        expect(cleared).toEqual([1]);
    });

    it('does not schedule when provider polling is disabled for the workspace', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const state = baseState(['ws-a']);
        state.config.set('ws-a', { pollingEnabled: false });
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(0);
    });

    it('does not schedule when there are no eligible roots', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const state = baseState(['ws-a']);
        state.eligible.clear();
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(0);
    });

    it('uses the provider default interval and honors a configured interval', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const state = baseState(['ws-default', 'ws-custom']);
        state.eligible.add('ws-custom');
        state.config.set('ws-custom', { pollingEnabled: true, pollIntervalMinutes: 2 });
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        const byMs = new Set(scheduled.map(timer => timer.ms));
        expect(byMs.has(5 * 60 * 1000)).toBe(true); // default (ws-default)
        expect(byMs.has(2 * 60 * 1000)).toBe(true); // configured (ws-custom)
    });

    it('falls back to the default interval when the configured minutes are invalid', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const state = baseState(['ws-a']);
        state.config.set('ws-a', { pollingEnabled: true, pollIntervalMinutes: 0 });
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled[0].ms).toBe(5 * 60 * 1000);
    });

    it('does not replace a timer when the interval is unchanged', async () => {
        const { timerApi, scheduled, cleared } = makeTimerApi();
        const state = baseState(['ws-a']);
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        await scheduler.configureWorkspace('ws-a');
        await scheduler.configureWorkspace('ws-a');

        expect(scheduled).toHaveLength(1);
        expect(cleared).toHaveLength(0);
    });

    it('replaces the timer without leaking when the interval changes', async () => {
        const { timerApi, scheduled, cleared } = makeTimerApi();
        const state = baseState(['ws-a']);
        state.config.set('ws-a', { pollingEnabled: true, pollIntervalMinutes: 5 });
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(1);

        state.config.set('ws-a', { pollingEnabled: true, pollIntervalMinutes: 10 });
        await scheduler.configureWorkspace('ws-a');

        expect(scheduled).toHaveLength(2);
        expect(scheduled[1].ms).toBe(10 * 60 * 1000);
        // The old timer is cleared before the new one is stored — no leak.
        expect(cleared).toEqual([1]);
    });

    it('calls unref on each scheduled timer', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(baseState(['ws-a'])), { timerApi });

        await scheduler.start();
        expect(scheduled[0].unrefCalls).toBe(1);
    });

    it('logs returned warnings then errors from a safe poll and swallows thrown errors', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const state = baseState(['ws-ok', 'ws-throws']);
        state.eligible.add('ws-throws');
        state.pollResults.set('ws-ok', { warnings: ['w1'], errors: ['e1'] });
        state.pollThrows.set('ws-throws', new Error('boom'));
        const logs: string[] = [];
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(state), {
            timerApi,
            logError: message => logs.push(message),
        });

        await scheduler.start();
        const okTimer = scheduled.find(timer => timer.ms === 5 * 60 * 1000 && timer.id === 1)!;
        const throwTimer = scheduled.find(timer => timer.id === 2)!;

        await okTimer.handler();
        expect(logs).toEqual([
            '[work-items/test-poll] ws-ok: w1',
            '[work-items/test-poll] ws-ok: e1',
        ]);

        // A thrown poll must not escape the scheduler; it is logged instead.
        logs.length = 0;
        await expect(throwTimer.handler()).resolves.toBeUndefined();
        expect(logs).toEqual(['[work-items/test-poll] ws-throws: boom']);
    });

    it('keeps independent timers for multiple workspaces', async () => {
        const { timerApi, scheduled } = makeTimerApi();
        const scheduler = new WorkspacePullPollScheduler(makeAdapter(baseState(['ws-a', 'ws-b'])), { timerApi });

        await scheduler.start();
        expect(scheduled).toHaveLength(2);

        await scheduled[0].handler();
        await scheduled[1].handler();
        // Each timer polls its own workspace only.
        expect(new Set(scheduled.map((_, index) => index))).toEqual(new Set([0, 1]));
    });

    it('runs two provider scheduler instances for the same workspace without sharing timers', async () => {
        const githubTimers = makeTimerApi();
        const azureTimers = makeTimerApi();
        const githubState = baseState(['ws-shared']);
        const azureState = baseState(['ws-shared']);
        githubState.pollResults.set('ws-shared', { warnings: ['gh'], errors: [] });
        azureState.pollResults.set('ws-shared', { warnings: ['ado'], errors: [] });

        const githubLogs: string[] = [];
        const azureLogs: string[] = [];
        const github = new WorkspacePullPollScheduler(
            makeAdapter(githubState, { logPrefix: 'work-items/github-poll' }),
            { timerApi: githubTimers.timerApi, logError: m => githubLogs.push(m) },
        );
        const azure = new WorkspacePullPollScheduler(
            makeAdapter(azureState, { logPrefix: 'work-items/azure-boards-poll' }),
            { timerApi: azureTimers.timerApi, logError: m => azureLogs.push(m) },
        );

        await github.start();
        await azure.start();

        // Both providers schedule a timer for the same workspace independently.
        expect(githubTimers.scheduled).toHaveLength(1);
        expect(azureTimers.scheduled).toHaveLength(1);

        await githubTimers.scheduled[0].handler();
        await azureTimers.scheduled[0].handler();
        expect(githubLogs).toEqual(['[work-items/github-poll] ws-shared: gh']);
        expect(azureLogs).toEqual(['[work-items/azure-boards-poll] ws-shared: ado']);

        // Disposing one provider leaves the other's timer intact.
        github.dispose();
        expect(githubTimers.cleared).toEqual([1]);
        expect(azureTimers.cleared).toEqual([]);
    });
});
