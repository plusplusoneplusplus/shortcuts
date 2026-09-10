import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as deliveryWatchdog from '../../src/reliability/delivery-watchdog';
import * as watchdogRuntime from '../../src/reliability/watchdog-runtime';
import {
    confirmWatchdogRecovery,
    createWatchdogState,
    deriveWatchdogProbe,
    type DeliveryWatchdogConfig,
    type WatchdogLimits,
    type WatchdogProbe,
    type WatchdogSnapshot,
    type WatchdogState,
} from '../../src/reliability/delivery-watchdog';
import {
    runDeliveryWatchdog,
    WATCHDOG_CONFIG_FILENAME,
    WATCHDOG_STATE_FILENAME,
} from '../../src/reliability/watchdog-runtime';
import { safeRmSync } from '../helpers/safe-rm';

const NOW = Date.UTC(2026, 8, 9, 19, 0, 0);
const LIMITS: WatchdogLimits = {
    pollIntervalMs: 1,
    idlePolls: 3,
    cooldownMs: 100,
    ttlMs: 10_000,
    maxResumes: 2,
    heartbeatIntervalMs: 10,
};
const CLASSIFIER_ERROR = 'CAPIError: 422 This content was flagged for possible cybersecurity risk';

type FailureClass = 'none' | 'ordinary-failure' | 'classifier-rejection';
type ClassifierState = {
    classifierCircuit: 'closed' | 'attempted' | 'open';
    classifierRejectionCount: number;
    classifierCompactionAttempts: number;
    classifierLastOccurrenceId: string | null;
};
type ClassifierProbe = WatchdogProbe & {
    failureClass: FailureClass;
    failureOccurrenceId: string | null;
    provider: string | null;
    hasSdkSession: boolean;
};
type ClassifierRecoveryPlan = {
    kind: 'attempt' | 'handoff-required';
    reason?: string;
    compactRequest?: {
        url: string;
        body: Record<string, unknown>;
    };
    recoveryRequest?: {
        url: string;
        body: Record<string, unknown>;
    };
};
type ClassifierHandoffInput = {
    ledgerCheckpointed: boolean;
    targetInflight: number;
    pendingWakeups: number;
    duplicateWriterTaskIds: string[];
    successorProcessId?: string;
    successorWriterCount: number;
    successorMode: string;
    successorWorkspaceId: string;
    successorWorktree: string;
    watchdogProcessId: string;
};
type ClassifierHandoffPlan = {
    kind: 'ready' | 'fail-closed';
    reason?: string;
    action?: string;
    prompt?: string;
    lineage?: {
        predecessorProcessId: string;
        successorProcessId: string;
    };
};

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        safeRmSync(dir);
    }
});

function futureExport<T>(module: object, name: string): T | undefined {
    const value: unknown = Reflect.get(module, name);
    return typeof value === 'function' ? value as T : undefined;
}

function fixture(): { config: DeliveryWatchdogConfig } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classifier-watchdog-'));
    tempDirs.push(root);
    const worktree = path.join(root, 'worktree');
    const stateDir = path.join(root, 'state');
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(worktree);
    fs.mkdirSync(stateDir);
    fs.mkdirSync(dataDir);
    const ledgerPath = path.join(root, 'DELIVERY.md');
    const promptFile = path.join(root, 'continue.txt');
    fs.writeFileSync(ledgerPath, '# Delivery\n');
    fs.writeFileSync(promptFile, 'Perform exactly one bounded action.');
    return {
        config: {
            workspaceId: 'ws-example',
            processId: 'queue_example',
            worktree,
            ledgerPath,
            promptFile,
            stateDir,
            dataDir,
            serverUrl: 'http://127.0.0.1:4000',
            mode: 'autopilot',
            completeMarker: 'DELIVERY_COMPLETE',
            blockedMarker: 'DELIVERY_BLOCKED',
            limits: LIMITS,
        },
    };
}

function snapshot(
    error: string | null = CLASSIFIER_ERROR,
    overrides: Partial<NonNullable<WatchdogSnapshot['process']>> = {},
): WatchdogSnapshot {
    return {
        process: {
            id: 'queue_example',
            workspaceId: 'ws-example',
            status: error ? 'failed' : 'completed',
            endTime: new Date(NOW - 60_000).toISOString(),
            error,
            workingDirectory: path.resolve('feature-worktree'),
            sdkSessionId: 'sdk-example',
            metadata: { mode: 'autopilot', provider: 'copilot' },
            ...overrides,
        },
        activeTasks: [],
        pendingWakeups: [],
    };
}

function classifierProbe(overrides: Partial<ClassifierProbe> = {}): ClassifierProbe {
    return {
        processStatus: 'failed',
        bindingMatches: true,
        targetInflight: 0,
        pendingWakeups: 0,
        splitBrain: false,
        duplicateWriterTaskIds: [],
        failureClass: 'classifier-rejection',
        failureOccurrenceId: 'classifier-occurrence-a',
        provider: 'copilot',
        hasSdkSession: true,
        ...overrides,
    };
}

describe('classifier rejection classification', () => {
    const classifyWatchdogFailure = futureExport<(error: string | null) => FailureClass>(
        deliveryWatchdog,
        'classifyWatchdogFailure',
    );

    it.each([
        'CAPIError: 422 This content was flagged for possible cybersecurity risk',
        'Request failed with HTTP 400 because the content was blocked by the safety system',
    ])('recognizes a supported classifier signature without relying on a request id', (error) => {
        expect(classifyWatchdogFailure?.(error)).toBe('classifier-rejection');
    });

    it('keeps ordinary HTTP and timeout failures out of the classifier circuit', () => {
        expect(classifyWatchdogFailure?.('HTTP 422 COMPACT_UNSUPPORTED')).toBe('ordinary-failure');
        expect(classifyWatchdogFailure?.('Request timed out after 21600000ms')).toBe('ordinary-failure');
        expect(classifyWatchdogFailure?.(null)).toBe('none');
    });

    it('surfaces the classifier class and provider eligibility in the read-only probe', () => {
        const probe = deriveWatchdogProbe(snapshot(), {
            ...fixture().config,
            worktree: path.resolve('feature-worktree'),
        }, NOW) as ClassifierProbe;

        expect(probe).toMatchObject({
            failureClass: 'classifier-rejection',
            provider: 'copilot',
            hasSdkSession: true,
        });
        expect(probe.failureOccurrenceId).toMatch(/^[a-f0-9]{64}$/);
        expect(probe.failureOccurrenceId).not.toContain(CLASSIFIER_ERROR);
    });

    it('ignores a preserved classifier error after a successful partial process update', () => {
        const probe = deriveWatchdogProbe(snapshot(CLASSIFIER_ERROR, {
            status: 'completed',
            endTime: new Date(NOW).toISOString(),
        }), {
            ...fixture().config,
            worktree: path.resolve('feature-worktree'),
        }, NOW) as ClassifierProbe;

        expect(probe).toMatchObject({
            processStatus: 'completed',
            failureClass: 'none',
            failureOccurrenceId: null,
        });
    });

    it('keeps one occurrence stable and changes identity for a later rejection event', () => {
        const cfg = {
            ...fixture().config,
            worktree: path.resolve('feature-worktree'),
        };
        const first = deriveWatchdogProbe(snapshot(), cfg, NOW) as ClassifierProbe;
        const same = deriveWatchdogProbe(snapshot(), cfg, NOW) as ClassifierProbe;
        const later = deriveWatchdogProbe(snapshot(CLASSIFIER_ERROR, {
            endTime: new Date(NOW + 60_000).toISOString(),
        }), cfg, NOW + 60_000) as ClassifierProbe;

        expect(same.failureOccurrenceId).toBe(first.failureOccurrenceId);
        expect(later.failureOccurrenceId).not.toBe(first.failureOccurrenceId);
    });
});

describe('classifier circuit decisions', () => {
    it('initializes a durable circuit independently from the normal resume budget', () => {
        expect(createWatchdogState(NOW)).toMatchObject({
            resumeCount: 0,
            classifierCircuit: 'closed',
            classifierRejectionCount: 0,
            classifierCompactionAttempts: 0,
            classifierLastOccurrenceId: null,
        });
    });

    it('allows exactly one supported compact-and-rephrase attempt without consuming a resume', () => {
        const state = {
            ...createWatchdogState(NOW - 1),
            idleStreak: LIMITS.idlePolls,
            classifierCircuit: 'closed',
            classifierRejectionCount: 0,
            classifierCompactionAttempts: 0,
            classifierLastOccurrenceId: null,
        } as WatchdogState & ClassifierState;

        expect(confirmWatchdogRecovery(
            state,
            classifierProbe(),
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'classifier-attempt',
            state: {
                resumeCount: 0,
                classifierCircuit: 'attempted',
                classifierRejectionCount: 1,
                classifierCompactionAttempts: 1,
                classifierLastOccurrenceId: 'classifier-occurrence-a',
            },
        });
    });

    it('does not treat the same stored classifier occurrence as a recurrence', () => {
        const attempted = {
            ...createWatchdogState(NOW - 1),
            idleStreak: LIMITS.idlePolls,
            resumeCount: 1,
            classifierCircuit: 'attempted',
            classifierRejectionCount: 1,
            classifierCompactionAttempts: 1,
            classifierLastOccurrenceId: 'classifier-occurrence-a',
        } as WatchdogState & ClassifierState;

        expect(confirmWatchdogRecovery(
            attempted,
            classifierProbe({ failureOccurrenceId: 'classifier-occurrence-a' }),
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'wait',
            reason: 'classifier-occurrence-seen',
            state: {
                resumeCount: 1,
                lastRecoveryAtMs: null,
                classifierCircuit: 'attempted',
                classifierRejectionCount: 1,
                classifierCompactionAttempts: 1,
                classifierLastOccurrenceId: 'classifier-occurrence-a',
            },
        });
    });

    it('fails closed on an unavailable attempted occurrence without counting recurrence', () => {
        const attempted = {
            ...createWatchdogState(NOW - 1),
            idleStreak: LIMITS.idlePolls,
            resumeCount: 1,
            classifierCircuit: 'attempted',
            classifierRejectionCount: 1,
            classifierCompactionAttempts: 1,
            classifierLastOccurrenceId: 'classifier-occurrence-a',
        } as WatchdogState & ClassifierState;

        expect(confirmWatchdogRecovery(
            attempted,
            classifierProbe({ failureOccurrenceId: null }),
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'handoff-required',
            reason: 'classifier-occurrence-unavailable',
            state: {
                resumeCount: 1,
                lastRecoveryAtMs: null,
                classifierCircuit: 'open',
                classifierRejectionCount: 1,
                classifierCompactionAttempts: 1,
                classifierLastOccurrenceId: 'classifier-occurrence-a',
            },
        });
    });

    it('opens the circuit on a distinct rejection occurrence and never enqueues again', () => {
        const attempted = {
            ...createWatchdogState(NOW - 1),
            idleStreak: LIMITS.idlePolls,
            resumeCount: 1,
            classifierCircuit: 'attempted',
            classifierRejectionCount: 1,
            classifierCompactionAttempts: 1,
            classifierLastOccurrenceId: 'classifier-occurrence-a',
        } as WatchdogState & ClassifierState;
        const open = {
            ...attempted,
            classifierCircuit: 'open',
            classifierRejectionCount: 2,
            classifierLastOccurrenceId: 'classifier-occurrence-b',
        } as WatchdogState & ClassifierState;

        expect(confirmWatchdogRecovery(
            attempted,
            classifierProbe({ failureOccurrenceId: 'classifier-occurrence-b' }),
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'handoff-required',
            reason: 'classifier-recurred',
            state: {
                resumeCount: 1,
                classifierCircuit: 'open',
                classifierCompactionAttempts: 1,
                classifierLastOccurrenceId: 'classifier-occurrence-b',
            },
        });
        expect(confirmWatchdogRecovery(
            open,
            classifierProbe(),
            NOW,
            LIMITS,
        )).toMatchObject({
            kind: 'handoff-required',
            reason: 'classifier-circuit-open',
            state: {
                resumeCount: 1,
                classifierCircuit: 'open',
                classifierCompactionAttempts: 1,
            },
        });
    });
});

describe('classifier recovery planning', () => {
    const planClassifierRecovery = futureExport<(
        config: DeliveryWatchdogConfig,
        probe: ClassifierProbe,
    ) => ClassifierRecoveryPlan>(deliveryWatchdog, 'planClassifierRecovery');

    it.each(['copilot', 'codex', 'claude'])(
        'builds one in-place compact followed by a minimal mode-correct recovery for %s',
        (provider) => {
            const { config } = fixture();
            const plan = planClassifierRecovery?.(config, classifierProbe({ provider }));

            expect(plan).toMatchObject({
                kind: 'attempt',
                compactRequest: {
                    url: `http://127.0.0.1:4000/api/processes/queue_example/compact?workspaceId=ws-example`,
                },
                recoveryRequest: {
                    url: 'http://127.0.0.1:4000/api/queue',
                    body: {
                        payload: {
                            processId: 'queue_example',
                            mode: 'autopilot',
                        },
                    },
                },
            });
            const compactInstructions = plan?.compactRequest?.body.customInstructions;
            const prompt = Reflect.get(
                Reflect.get(plan?.recoveryRequest?.body ?? {}, 'payload') ?? {},
                'prompt',
            );
            expect(compactInstructions).toEqual(expect.any(String));
            expect(String(compactInstructions)).not.toContain(CLASSIFIER_ERROR);
            expect(prompt).toContain(config.ledgerPath);
            expect(prompt).toContain('Next bounded action');
            expect(prompt).not.toContain(CLASSIFIER_ERROR);
            expect(prompt).not.toContain(fs.readFileSync(config.promptFile, 'utf-8'));
        },
    );

    it('fails closed when provider compaction is unsupported or no SDK session exists', () => {
        const { config } = fixture();

        expect(planClassifierRecovery?.(
            config,
            classifierProbe({ provider: 'opencode' }),
        )).toMatchObject({
            kind: 'handoff-required',
            reason: 'classifier-compaction-unsupported',
        });
        expect(planClassifierRecovery?.(
            config,
            classifierProbe({ hasSdkSession: false }),
        )).toMatchObject({
            kind: 'handoff-required',
            reason: 'classifier-session-missing',
        });
    });

    it('keeps the post-compaction attempt mode-correct for Ralph', () => {
        const { config } = fixture();
        config.mode = 'ralph';
        config.ralphSessionId = 'ralph-example';

        expect(planClassifierRecovery?.(
            config,
            classifierProbe(),
        )).toMatchObject({
            kind: 'attempt',
            recoveryRequest: {
                url: 'http://127.0.0.1:4000/api/workspaces/ws-example/ralph-sessions/ralph-example/resume',
                body: {},
            },
        });
    });
});

describe('serialized classifier handoff', () => {
    const planClassifierHandoff = futureExport<(
        config: DeliveryWatchdogConfig,
        input: ClassifierHandoffInput,
    ) => ClassifierHandoffPlan>(deliveryWatchdog, 'planClassifierHandoff');

    it.each([
        ['ledger-not-checkpointed', { ledgerCheckpointed: false }],
        ['old-writer-active', { targetInflight: 1 }],
        ['pending-wakeup', { pendingWakeups: 1 }],
        ['duplicate-writer', { duplicateWriterTaskIds: ['queue_other'] }],
        ['fresh-writer-required', { successorProcessId: undefined }],
        ['fresh-writer-required', { successorProcessId: 'queue_example' }],
        ['fresh-writer-required', { successorWriterCount: 2 }],
        ['successor-binding-mismatch', { successorMode: 'ralph' }],
        ['successor-binding-mismatch', { successorWorkspaceId: 'ws-other' }],
        ['successor-binding-mismatch', { successorWorktree: path.resolve('other-worktree') }],
        ['watchdog-not-retargeted', { watchdogProcessId: 'queue_example' }],
    ])('fails closed on unmet prerequisite %s', (reason, override) => {
        const { config } = fixture();
        const input: ClassifierHandoffInput = {
            ledgerCheckpointed: true,
            targetInflight: 0,
            pendingWakeups: 0,
            duplicateWriterTaskIds: [],
            successorProcessId: 'queue_fresh',
            successorWriterCount: 1,
            successorMode: 'autopilot',
            successorWorkspaceId: config.workspaceId,
            successorWorktree: config.worktree,
            watchdogProcessId: 'queue_fresh',
            ...override,
        };

        expect(planClassifierHandoff?.(config, input)).toMatchObject({
            kind: 'fail-closed',
            reason,
        });
    });

    it('records lineage and emits only a minimal file-reference prompt after every guard passes', () => {
        const { config } = fixture();
        const plan = planClassifierHandoff?.(config, {
            ledgerCheckpointed: true,
            targetInflight: 0,
            pendingWakeups: 0,
            duplicateWriterTaskIds: [],
            successorProcessId: 'queue_fresh',
            successorWriterCount: 1,
            successorMode: 'autopilot',
            successorWorkspaceId: config.workspaceId,
            successorWorktree: config.worktree,
            watchdogProcessId: 'queue_fresh',
        });

        expect(plan).toMatchObject({
            kind: 'ready',
            lineage: {
                predecessorProcessId: 'queue_example',
                successorProcessId: 'queue_fresh',
            },
        });
        expect(plan?.prompt).toContain(config.ledgerPath);
        expect(plan?.prompt).toContain('Next bounded action');
        expect(plan?.prompt).not.toContain(CLASSIFIER_ERROR);
    });
});

describe('classifier watchdog runtime', () => {
    it('persists and dispatches one classifier attempt without spending a normal resume', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-classifier-attempt',
            config,
        }));
        const postJson = vi.fn(async (url: string) => {
            if (url.endsWith('/api/queue')) {
                fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                return '{"task":{"id":"classifier-retry"}}';
            }
            return '{"success":true,"tokensRemoved":128,"messagesRemoved":4}';
        });

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 1_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => classifierProbe(),
            postJson,
            verifyServer: async () => undefined,
        });

        expect(postJson.mock.calls.map(call => call[0])).toEqual([
            'http://127.0.0.1:4000/api/processes/queue_example/compact?workspaceId=ws-example',
            'http://127.0.0.1:4000/api/queue',
        ]);
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({
            status: 'complete',
            resumeCount: 0,
            classifierCircuit: 'attempted',
            classifierRejectionCount: 1,
            classifierCompactionAttempts: 1,
        });
    });

    it('fails closed without enqueue when compaction reports that no history was rewritten', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-classifier-compact-noop',
            config,
        }));
        const postJson = vi.fn(async (url: string) => {
            if (url.endsWith('/api/queue')) {
                fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
            }
            return '{"success":false,"tokensRemoved":0,"messagesRemoved":0}';
        });

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 2_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => classifierProbe(),
            postJson,
            verifyServer: async () => undefined,
        });

        expect(postJson.mock.calls.map(call => call[0])).toEqual([
            'http://127.0.0.1:4000/api/processes/queue_example/compact?workspaceId=ws-example',
        ]);
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({
            status: 'classifier-circuit-open',
            resumeCount: 0,
            classifierCircuit: 'open',
            classifierRejectionCount: 1,
            classifierCompactionAttempts: 1,
        });
    });

    it('opens the circuit, records fail-closed lineage, and never enqueues after recurrence', async () => {
        const { config } = fixture();
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-classifier-recurrence',
            config,
        }));
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_STATE_FILENAME), JSON.stringify({
            instanceId: 'previous-instance',
            pid: 4242,
            status: 'stopped',
            workspaceId: config.workspaceId,
            processId: config.processId,
            worktree: config.worktree,
            mode: config.mode,
            startedAtMs: 100,
            idleStreak: 0,
            resumeCount: 1,
            lastRecoveryAtMs: 200,
            classifierCircuit: 'attempted',
            classifierRejectionCount: 1,
            classifierCompactionAttempts: 1,
            classifierLastOccurrenceId: 'classifier-occurrence-a',
            lastHeartbeatAtMs: 200,
            lastProbe: classifierProbe(),
            lastAction: 'classifier attempt enqueued',
        }));
        const postJson = vi.fn(async () => {
            fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
            return '{"task":{"id":"must-not-enqueue"}}';
        });

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 3_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => classifierProbe({ failureOccurrenceId: 'classifier-occurrence-b' }),
            postJson,
            verifyServer: async () => undefined,
        });

        expect(postJson).not.toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        ))).toMatchObject({
            status: 'classifier-circuit-open',
            resumeCount: 1,
            classifierCircuit: 'open',
            classifierRejectionCount: 2,
            classifierCompactionAttempts: 1,
            classifierLastOccurrenceId: 'classifier-occurrence-b',
            classifierLineage: {
                predecessorProcessId: 'queue_example',
                handoff: 'manual-required',
            },
        });
    });

    it('persists only an opaque occurrence id and keeps normal recovery budget unchanged', async () => {
        const { config } = fixture();
        const derivedProbe = deriveWatchdogProbe(snapshot(CLASSIFIER_ERROR, {
            workingDirectory: config.worktree,
        }), config, NOW);
        fs.writeFileSync(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), JSON.stringify({
            instanceId: 'instance-classifier-private-occurrence',
            config,
        }));
        const postJson = vi.fn(async (url: string) => {
            if (url.endsWith('/api/queue')) {
                fs.appendFileSync(config.ledgerPath, '\nDELIVERY_COMPLETE\n');
                return '{"task":{"id":"classifier-private"}}';
            }
            return '{"success":true,"tokensRemoved":64,"messagesRemoved":2}';
        });

        await runDeliveryWatchdog(path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME), {
            now: (() => {
                let now = 4_000;
                return () => now++;
            })(),
            sleep: async () => undefined,
            probe: () => derivedProbe,
            postJson,
            verifyServer: async () => undefined,
        });

        const persisted = fs.readFileSync(
            path.join(config.stateDir, WATCHDOG_STATE_FILENAME),
            'utf-8',
        );
        const log = fs.readFileSync(path.join(config.stateDir, 'watchdog.log'), 'utf-8');
        expect(JSON.parse(persisted)).toMatchObject({
            resumeCount: 0,
            lastRecoveryAtMs: null,
            classifierLastOccurrenceId: derivedProbe.failureOccurrenceId,
        });
        expect(derivedProbe.failureOccurrenceId).toMatch(/^[a-f0-9]{64}$/);
        expect(persisted).not.toContain(CLASSIFIER_ERROR);
        expect(log).not.toContain(CLASSIFIER_ERROR);
    });
});
