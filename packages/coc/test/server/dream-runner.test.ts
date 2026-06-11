import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type {
    ConversationTurn,
    ProcessIndexEntry,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { FileDreamStore } from '../../src/server/dreams/dream-store';
import { DreamRunExecutor } from '../../src/server/dreams/dream-runner';
import type { DreamInternalStepRunner } from '../../src/server/dreams/dream-internal-process';

const WORKSPACE_ID = 'ws-dream-runner';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-dream-runner-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

function entry(overrides: Partial<ProcessIndexEntry> = {}): ProcessIndexEntry {
    return {
        id: 'process-1',
        workspaceId: WORKSPACE_ID,
        status: 'completed',
        type: 'chat',
        startTime: '2026-06-10T00:00:00.000Z',
        endTime: '2026-06-10T00:05:00.000Z',
        promptPreview: 'Review repeated setup',
        lastEventAt: '2026-06-10T00:05:00.000Z',
        activityAt: '2026-06-10T00:05:00.000Z',
        ...overrides,
    };
}

function turn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
    return {
        role: 'user',
        content: 'Please review this with the strict no-style-comments policy again.',
        timestamp: new Date('2026-06-10T00:00:00.000Z'),
        turnIndex: 0,
        timeline: [],
        ...overrides,
    };
}

function queuedTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'task-1',
        repoId: WORKSPACE_ID,
        type: 'chat',
        priority: 'normal',
        status: 'queued',
        createdAt: Date.parse('2026-06-10T00:06:00.000Z'),
        payload: { workspaceId: WORKSPACE_ID },
        config: {},
        ...overrides,
    };
}

function rawCandidate() {
    return {
        category: 'skill-or-prompt-improvement',
        sourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 1 }],
        observedPattern: 'The user repeatedly restates code review constraints before asking for reviews.',
        whyItMatters: 'Repeated setup increases review friction and makes automated review behavior less consistent.',
        recommendation: 'Harden the code-review skill to include the recurring review constraints by default.',
        expectedImpact: 'Review requests become shorter while preserving high-signal review behavior.',
        confidence: 0.94,
        notAlreadyCoveredRationale: 'Existing review guidance does not encode this recurring setup pattern.',
    };
}

function mockInternalStepRunner(...responses: string[]): DreamInternalStepRunner {
    const runInternalStep = vi.fn<DreamInternalStepRunner>();
    responses.forEach((response, index) => {
        runInternalStep.mockImplementationOnce(async (request) => {
            const processId = `queue_dream-${request.purpose}-${index + 1}`;
            request.onProcessStarted?.(processId);
            return { processId, response };
        });
    });
    return runInternalStep;
}

function processStore(options: {
    completedEntries?: ProcessIndexEntry[];
    runningEntries?: ProcessIndexEntry[];
    recentEntries?: ProcessIndexEntry[];
    turnsByProcess?: Map<string, ConversationTurn[]>;
} = {}): ProcessStore {
    const completedEntries = options.completedEntries ?? [entry()];
    const runningEntries = options.runningEntries ?? [];
    const recentEntries = options.recentEntries ?? completedEntries;
    const turnsByProcess = options.turnsByProcess ?? new Map<string, ConversationTurn[]>([
        ['process-1', [
            turn({ turnIndex: 0 }),
            turn({
                role: 'assistant',
                content: 'I will focus only on material defects.',
                timestamp: new Date('2026-06-10T00:01:00.000Z'),
                turnIndex: 1,
            }),
        ]],
    ]);

    return {
        getProcessSummaries: vi.fn<NonNullable<ProcessStore['getProcessSummaries']>>(async (filter) => {
            if (filter?.status === 'completed') {
                return { entries: completedEntries, total: completedEntries.length };
            }
            if (filter?.status === 'running') {
                return { entries: runningEntries, total: runningEntries.length };
            }
            return { entries: recentEntries, total: recentEntries.length };
        }),
        getConversationTurns: vi.fn<NonNullable<ProcessStore['getConversationTurns']>>(async (processId: string) =>
            turnsByProcess.get(processId) ?? []
        ),
        getAllProcesses: vi.fn(),
        getProcess: vi.fn(),
    } as unknown as ProcessStore;
}

function createRunner(options: {
    dataDir: string;
    runInternalStep?: DreamInternalStepRunner;
    processStore?: ProcessStore;
    getDreamsEnabled?: () => boolean | Promise<boolean>;
    getWorkspaceDreamsEnabled?: (workspaceId: string) => boolean | Promise<boolean>;
    listWorkspaceTasks?: (workspaceId: string) => readonly QueuedTask[] | Promise<readonly QueuedTask[]>;
    now?: () => Date;
}): { runner: DreamRunExecutor; store: FileDreamStore } {
    const store = new FileDreamStore({ dataDir: options.dataDir });
    return {
        store,
        runner: new DreamRunExecutor({
            store,
            processStore: options.processStore ?? processStore(),
            runInternalStep: options.runInternalStep ?? mockInternalStepRunner(
                JSON.stringify({ candidates: [rawCandidate()] }),
                JSON.stringify({
                    decisions: [{
                        candidateIndex: 0,
                        verdict: 'accept',
                        rationale: 'Evidence is repeated, source-linked, and actionable.',
                    }],
                }),
            ),
            getDreamsEnabled: options.getDreamsEnabled ?? (() => true),
            getWorkspaceDreamsEnabled: options.getWorkspaceDreamsEnabled ?? (() => true),
            listWorkspaceTasks: options.listWorkspaceTasks,
            now: options.now,
        }),
    };
}

describe('DreamRunExecutor', () => {
    it('runs a manual dream pass and persists visible cards plus source coverage', async () => {
        await withTempDir(async (dataDir) => {
            const { runner, store } = createRunner({ dataDir });

            const result = await runner.runManual(WORKSPACE_ID, {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                timeoutMs: 3_600_000,
            });

            expect(result.run).toMatchObject({
                workspaceId: WORKSPACE_ID,
                trigger: 'manual',
                status: 'completed',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                timeoutMs: 3_600_000,
                sourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 1 }],
                analyzerProcessId: 'queue_dream-analyzer-1',
                criticProcessId: 'queue_dream-critic-2',
            });
            expect(result.cards).toHaveLength(1);
            expect(result.cards[0]).toMatchObject({
                status: 'visible',
                runId: result.run.id,
                criticRationale: 'Evidence is repeated, source-linked, and actionable.',
            });
            expect(result.run.candidateCardIds).toEqual([result.cards[0].id]);
            await expect(store.getRun(WORKSPACE_ID, result.run.id)).resolves.toMatchObject({
                analyzerProcessId: 'queue_dream-analyzer-1',
                criticProcessId: 'queue_dream-critic-2',
            });
            await expect(store.listCoveredSourceRanges(WORKSPACE_ID)).resolves.toEqual([
                { processId: 'process-1', startTurnIndex: 0, endTurnIndex: 1 },
            ]);
        });
    });

    it('does not create a run when global or workspace opt-in gates are closed', async () => {
        await withTempDir(async (dataDir) => {
            const { runner, store } = createRunner({
                dataDir,
                getDreamsEnabled: () => false,
            });

            await expect(runner.runManual(WORKSPACE_ID)).rejects.toThrow(/global config/i);
            await expect(store.listRuns(WORKSPACE_ID)).resolves.toEqual([]);

            const workspaceDisabled = createRunner({
                dataDir,
                getWorkspaceDreamsEnabled: () => false,
            });
            await expect(workspaceDisabled.runner.runManual(WORKSPACE_ID)).rejects.toThrow(/not enabled for workspace/i);
            await expect(store.listRuns(WORKSPACE_ID)).resolves.toEqual([]);
        });
    });

    it('marks the run failed when analysis fails after source selection', async () => {
        await withTempDir(async (dataDir) => {
            const failingInternalStep = vi.fn<DreamInternalStepRunner>(async (request) => {
                request.onProcessStarted?.('queue_dream-analyzer-failed');
                throw new Error('model unavailable');
            });
            const { runner, store } = createRunner({ dataDir, runInternalStep: failingInternalStep });

            await expect(runner.runManual(WORKSPACE_ID)).rejects.toThrow(/model unavailable/i);

            const runs = await store.listRuns(WORKSPACE_ID);
            expect(runs).toHaveLength(1);
            expect(runs[0]).toMatchObject({
                status: 'failed',
                error: 'model unavailable',
                timeoutMs: 3_600_000,
                sourceRanges: [{ processId: 'process-1', startTurnIndex: 0, endTurnIndex: 1 }],
                analyzerProcessId: 'queue_dream-analyzer-failed',
            });
        });
    });

    it('does not run a critic process when analyzer returns zero candidates', async () => {
        await withTempDir(async (dataDir) => {
            const runInternalStep = mockInternalStepRunner(JSON.stringify({ candidates: [] }));
            const { runner, store } = createRunner({ dataDir, runInternalStep });

            const result = await runner.runManual(WORKSPACE_ID);

            expect(result.run).toMatchObject({
                status: 'completed',
                analyzerProcessId: 'queue_dream-analyzer-1',
            });
            expect(result.run).not.toHaveProperty('criticProcessId');
            expect(result.cards).toHaveLength(0);
            expect(vi.mocked(runInternalStep).mock.calls).toHaveLength(1);
            expect(vi.mocked(runInternalStep).mock.calls[0][0].purpose).toBe('analyzer');
            await expect(store.getRun(WORKSPACE_ID, result.run.id)).resolves.toMatchObject({
                analyzerProcessId: 'queue_dream-analyzer-1',
            });
        });
    });

    it('skips idle-triggered runs unless the workspace quiet window is satisfied', async () => {
        await withTempDir(async (dataDir) => {
            const store = processStore({
                runningEntries: [entry({
                    id: 'process-streaming',
                    status: 'running',
                    endTime: undefined,
                    lastEventAt: '2026-06-10T00:09:50.000Z',
                    activityAt: '2026-06-10T00:09:50.000Z',
                })],
                recentEntries: [entry({
                    id: 'process-recent',
                    lastEventAt: '2026-06-10T00:09:50.000Z',
                    activityAt: '2026-06-10T00:09:50.000Z',
                })],
                turnsByProcess: new Map([
                    ['process-streaming', [
                        turn({
                            role: 'assistant',
                            content: 'streaming output',
                            turnIndex: 0,
                            streaming: true,
                        }),
                    ]],
                ]),
            });
            const { runner, store: dreamStore } = createRunner({
                dataDir,
                processStore: store,
                listWorkspaceTasks: () => [
                    queuedTask(),
                    queuedTask({ id: 'task-running', status: 'running' }),
                    queuedTask({ id: 'task-other', repoId: 'ws-other', payload: { workspaceId: 'ws-other' } }),
                ],
                now: () => new Date('2026-06-10T00:10:00.000Z'),
            });

            const result = await runner.runIdle(WORKSPACE_ID, { minIdleMs: 60_000 });

            expect(result).toMatchObject({
                started: false,
                idle: {
                    isIdle: false,
                    queuedTaskCount: 1,
                    runningTaskCount: 1,
                    activeStreamingChatProcessIds: ['process-streaming'],
                    idleForMs: 10_000,
                    minIdleMs: 60_000,
                },
            });
            expect(result.started === false ? result.reason : '').toContain('workspace has 1 queued and 1 running task');
            await expect(dreamStore.listRuns(WORKSPACE_ID)).resolves.toEqual([]);
        });
    });

    it('runs an idle dream pass once the workspace is quiet long enough', async () => {
        await withTempDir(async (dataDir) => {
            const { runner } = createRunner({
                dataDir,
                processStore: processStore({
                    recentEntries: [entry({
                        id: 'process-old',
                        lastEventAt: '2026-06-10T00:00:00.000Z',
                        activityAt: '2026-06-10T00:00:00.000Z',
                    })],
                }),
                listWorkspaceTasks: () => [],
                now: () => new Date('2026-06-10T00:20:00.000Z'),
            });

            const result = await runner.runIdle(WORKSPACE_ID, { minIdleMs: 60_000 });

            expect(result.started).toBe(true);
            if (result.started) {
                expect(result.result.run).toMatchObject({
                    trigger: 'idle',
                    status: 'completed',
                });
                expect(result.result.cards).toHaveLength(1);
            }
        });
    });
});
