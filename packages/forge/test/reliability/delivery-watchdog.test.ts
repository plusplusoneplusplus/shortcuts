import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
    buildRecoveryRequest,
    confirmWatchdogRecovery,
    createWatchdogState,
    deriveWatchdogProbe,
    evaluateWatchdogPoll,
    hasExactTerminalMarker,
    validateDeliveryWatchdogConfig,
    type DeliveryWatchdogConfig,
    type WatchdogProcessSnapshot,
    type WatchdogLimits,
    type WatchdogSnapshot,
} from '../../src/reliability/delivery-watchdog';

const NOW = Date.UTC(2026, 8, 9, 6, 0, 0);
const LIMITS: WatchdogLimits = {
    pollIntervalMs: 60_000,
    idlePolls: 3,
    cooldownMs: 15 * 60_000,
    ttlMs: 72 * 60 * 60_000,
    maxResumes: 2,
    heartbeatIntervalMs: 15 * 60_000,
};

function config(overrides: Partial<DeliveryWatchdogConfig> = {}): DeliveryWatchdogConfig {
    return {
        workspaceId: 'ws-example',
        processId: 'queue_example',
        worktree: path.resolve('feature-worktree'),
        ledgerPath: path.resolve('watchdog-state', 'DELIVERY.md'),
        promptFile: path.resolve('watchdog-state', 'continue.txt'),
        stateDir: path.resolve('watchdog-state', 'watchdog'),
        dataDir: path.resolve('coc-data'),
        serverUrl: 'http://127.0.0.1:4000',
        mode: 'autopilot',
        completeMarker: 'DELIVERY_COMPLETE',
        blockedMarker: 'DELIVERY_BLOCKED',
        limits: LIMITS,
        ...overrides,
    };
}

function snapshot(overrides: Partial<WatchdogSnapshot> = {}): WatchdogSnapshot {
    return {
        process: {
            id: 'queue_example',
            workspaceId: 'ws-example',
            status: 'completed',
            endTime: new Date(NOW - 60_000).toISOString(),
            error: null,
            workingDirectory: path.resolve('feature-worktree'),
            metadata: { mode: 'autopilot' },
        },
        activeTasks: [],
        pendingWakeups: [],
        ...overrides,
    };
}

describe('delivery watchdog state machine', () => {
    it('requires the configured idle streak and then requests an immediate recheck', () => {
        const probe = deriveWatchdogProbe(snapshot(), config(), NOW);
        const first = evaluateWatchdogPoll(createWatchdogState(NOW), probe, NOW, LIMITS);
        const second = evaluateWatchdogPoll(first.state, probe, NOW + 60_000, LIMITS);
        const third = evaluateWatchdogPoll(second.state, probe, NOW + 120_000, LIMITS);

        expect(first).toMatchObject({ kind: 'wait', reason: 'idle', state: { idleStreak: 1 } });
        expect(second).toMatchObject({ kind: 'wait', reason: 'idle', state: { idleStreak: 2 } });
        expect(third).toMatchObject({ kind: 'recheck', state: { idleStreak: 3 } });
    });

    it('aborts recovery when target activity appears during the immediate recheck', () => {
        const idleProbe = deriveWatchdogProbe(snapshot(), config(), NOW);
        const activeProbe = deriveWatchdogProbe(snapshot({
            activeTasks: [{
                id: 'follow-up',
                processId: 'queue_example',
                repoId: 'ws-example',
                status: 'running',
                folderPath: path.resolve('feature-worktree'),
                payload: { mode: 'autopilot', processId: 'queue_example' },
            }],
        }), config(), NOW);
        const state = { ...createWatchdogState(NOW), idleStreak: 3 };

        expect(confirmWatchdogRecovery(state, activeProbe, NOW, LIMITS)).toMatchObject({
            kind: 'wait',
            reason: 'activity-during-recheck',
            state: { idleStreak: 0, resumeCount: 0 },
        });
        expect(idleProbe.targetInflight).toBe(0);
    });

    it('rejects recovery when another Autopilot writer targets the worktree', () => {
        const probe = deriveWatchdogProbe(snapshot({
            activeTasks: [{
                id: 'other-writer',
                processId: 'queue_other',
                repoId: 'ws-example',
                status: 'running',
                folderPath: null,
                payload: {
                    mode: 'autopilot',
                    processId: 'queue_other',
                    workingDirectory: path.resolve('feature-worktree'),
                },
            }],
        }), config(), NOW);

        expect(probe.duplicateWriterTaskIds).toEqual(['other-writer']);
        expect(confirmWatchdogRecovery(
            { ...createWatchdogState(NOW), idleStreak: 3 },
            probe,
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'reject',
            reason: 'duplicate-writer',
            state: { idleStreak: 0 },
        });
    });

    it('logs split-brain as a bounded wait rather than releasing or recovering', () => {
        const probe = deriveWatchdogProbe(snapshot({
            activeTasks: [{
                id: 'original-task',
                processId: 'queue_example',
                repoId: 'ws-example',
                status: 'running',
                folderPath: path.resolve('feature-worktree'),
                payload: { mode: 'autopilot', processId: 'queue_example' },
            }],
        }), config(), NOW);

        expect(probe.splitBrain).toBe(true);
        expect(evaluateWatchdogPoll(
            { ...createWatchdogState(NOW), idleStreak: 2 },
            probe,
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'wait',
            reason: 'split-brain',
            state: { idleStreak: 0 },
        });
    });

    it('treats every pending target wakeup as activity while its turn is executing', () => {
        const probe = deriveWatchdogProbe(snapshot({
            pendingWakeups: [{
                processId: 'queue_example',
                status: 'pending',
                firesAt: new Date(NOW - 60_000).toISOString(),
            }],
        }), config(), NOW);

        expect(probe.pendingWakeups).toBe(1);
        expect(evaluateWatchdogPoll(createWatchdogState(NOW), probe, NOW, LIMITS)).toMatchObject({
            kind: 'wait',
            reason: 'activity',
            state: { idleStreak: 0 },
        });
    });

    it('binds configured recovery mode and Ralph session to process metadata', () => {
        const processWithMetadata = {
            ...snapshot().process!,
            metadata: {
                mode: 'ralph',
                ralph: { sessionId: 'ralph-other' },
            },
        } as WatchdogProcessSnapshot & {
            metadata: { mode: string; ralph: { sessionId: string } };
        };

        expect(deriveWatchdogProbe(snapshot({
            process: processWithMetadata,
        }), config({
            mode: 'ralph',
            ralphSessionId: 'ralph-expected',
        }), NOW).bindingMatches).toBe(false);

        expect(deriveWatchdogProbe(snapshot({
            process: processWithMetadata,
        }), config({ mode: 'autopilot' }), NOW).bindingMatches).toBe(false);
    });

    it('enforces cooldown, resume ceiling, and TTL before recovery', () => {
        const probe = deriveWatchdogProbe(snapshot(), config(), NOW);
        const ready = { ...createWatchdogState(NOW - 1), idleStreak: 3 };

        const recovered = confirmWatchdogRecovery(ready, probe, NOW, LIMITS);
        expect(recovered).toMatchObject({
            kind: 'recover',
            state: { idleStreak: 0, resumeCount: 1, lastRecoveryAtMs: NOW },
        });
        expect(confirmWatchdogRecovery(
            { ...recovered.state, idleStreak: 3 },
            probe,
            NOW + LIMITS.cooldownMs - 1,
            LIMITS,
        )).toMatchObject({ kind: 'wait', reason: 'cooldown' });
        expect(confirmWatchdogRecovery(
            { ...recovered.state, idleStreak: 3, resumeCount: LIMITS.maxResumes },
            probe,
            NOW + LIMITS.cooldownMs,
            LIMITS,
        )).toMatchObject({ kind: 'stop', reason: 'max-resumes' });
        expect(evaluateWatchdogPoll(
            createWatchdogState(NOW - LIMITS.ttlMs),
            probe,
            NOW,
            LIMITS,
        )).toMatchObject({ kind: 'stop', reason: 'ttl' });
    });
});

describe('delivery watchdog safety helpers', () => {
    it('matches terminal markers only as exact standalone trimmed lines', () => {
        expect(hasExactTerminalMarker('work remains\nDELIVERY_COMPLETE\n', 'DELIVERY_COMPLETE')).toBe(true);
        expect(hasExactTerminalMarker('Set DELIVERY_COMPLETE when done.', 'DELIVERY_COMPLETE')).toBe(false);
        expect(hasExactTerminalMarker('DELIVERY_COMPLETE_EXTRA', 'DELIVERY_COMPLETE')).toBe(false);
    });

    it('rejects state directories in worktree children whose names begin with dots', () => {
        expect(() => validateDeliveryWatchdogConfig(config({
            stateDir: path.join(path.resolve('feature-worktree'), '..watchdog'),
        }))).toThrow('state-dir must be outside the target worktree');
    });

    it('builds an Autopilot continuation for the same process', () => {
        const request = buildRecoveryRequest(config(), 'Perform one bounded action.');

        expect(request).toMatchObject({
            url: 'http://127.0.0.1:4000/api/queue',
            body: {
                type: 'chat',
                repoId: 'ws-example',
                payload: {
                    mode: 'autopilot',
                    processId: 'queue_example',
                    workspaceId: 'ws-example',
                    workingDirectory: path.resolve('feature-worktree'),
                    prompt: 'Perform one bounded action.',
                },
            },
        });
    });

    it('uses the supported Ralph resume route instead of an ordinary follow-up', () => {
        const request = buildRecoveryRequest(config({
            workspaceId: 'ws/example',
            mode: 'ralph',
            ralphSessionId: 'ralph/example',
        }), 'ignored for Ralph');

        expect(request).toEqual({
            url: 'http://127.0.0.1:4000/api/workspaces/ws%2Fexample/ralph-sessions/ralph%2Fexample/resume',
            body: {},
        });
    });
});
