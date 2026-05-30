import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import type { RalphSessionRecord } from '../../../src/server/ralph/types';
import { RALPH_DEFAULT_MAX_ITERATIONS } from '../../../src/server/preferences-handler';
import {
    findInFlightRalphTask,
    parseAdditionalIterations,
    recoverIterationPaths,
    resolveRalphAdditionalIterations,
} from '../../../src/server/routes/ralph-route-utils';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('ralph-route-utils', () => {
    describe('findInFlightRalphTask', () => {
        it('returns queued or running tasks that match the Ralph session id', () => {
            const bridge = makeBridge([
                makeTask('other', 'running', 'other-session'),
                makeTask('done', 'completed', 'sess-1'),
                makeTask('match', 'queued', 'sess-1'),
            ]);

            expect(findInFlightRalphTask(bridge, 'sess-1')).toEqual({
                id: 'match',
                status: 'queued',
            });
        });

        it('ignores non-Ralph and terminal queue tasks', () => {
            const bridge = makeBridge([
                makeTask('done', 'completed', 'sess-1'),
                { ...makeTask('plain', 'running', 'sess-2'), payload: {} },
            ]);

            expect(findInFlightRalphTask(bridge, 'sess-1')).toBeUndefined();
        });
    });

    describe('parseAdditionalIterations', () => {
        it('returns undefined when the body omits additionalIterations', () => {
            expect(parseAdditionalIterations({}, 200)).toEqual({ value: undefined });
        });

        it('returns the explicit integer when it is inside the limit', () => {
            expect(parseAdditionalIterations({ additionalIterations: 12 }, 200)).toEqual({ value: 12 });
        });

        it('rejects non-integers and values outside the inclusive limit', () => {
            expect(parseAdditionalIterations({ additionalIterations: 1.5 }, 200)).toEqual({
                error: 'additionalIterations must be an integer between 1 and 200',
            });
            expect(parseAdditionalIterations({ additionalIterations: 201 }, 200)).toEqual({
                error: 'additionalIterations must be an integer between 1 and 200',
            });
        });
    });

    describe('resolveRalphAdditionalIterations', () => {
        it('uses explicit values before preferences', () => {
            const dataDir = makeTempDataDir();
            writeRepoPreferences(dataDir, 'ws-pref', { maxRalphIterations: 9 });

            expect(resolveRalphAdditionalIterations(4, dataDir, 'ws-pref')).toBe(4);
        });

        it('uses per-repo preferences when explicit value is omitted', () => {
            const dataDir = makeTempDataDir();
            writeRepoPreferences(dataDir, 'ws-pref', { maxRalphIterations: 9 });

            expect(resolveRalphAdditionalIterations(undefined, dataDir, 'ws-pref')).toBe(9);
        });

        it('falls back to the default when preferences are unavailable', () => {
            expect(resolveRalphAdditionalIterations(undefined, undefined, 'ws-pref')).toBe(RALPH_DEFAULT_MAX_ITERATIONS);

            const dataDir = makeTempDataDir();
            expect(resolveRalphAdditionalIterations(undefined, dataDir, 'ws-missing')).toBe(RALPH_DEFAULT_MAX_ITERATIONS);
        });
    });

    describe('recoverIterationPaths', () => {
        it('recovers paths from the latest iteration process payload', async () => {
            const store = {
                getProcess: vi.fn(async () => ({
                    id: 'proc-new',
                    type: 'clarification',
                    promptPreview: 'test',
                    fullPrompt: 'test',
                    status: 'completed',
                    startTime: new Date(),
                    workingDirectory: 'process-working-directory',
                    payload: {
                        workingDirectory: 'payload-working-directory',
                        folderPath: 'payload-folder',
                    },
                })),
            } as unknown as ProcessStore;

            const paths = await recoverIterationPaths(makeRecord([
                { iteration: 1, processId: 'proc-old' },
                { iteration: 3, processId: 'proc-new' },
                { iteration: 2, processId: 'proc-mid' },
            ]), store, 'ws-1');

            expect(store.getProcess).toHaveBeenCalledWith('proc-new', 'ws-1');
            expect(paths).toEqual({
                workingDirectory: 'payload-working-directory',
                folderPath: 'payload-folder',
            });
        });

        it('falls back to folderPath and process workingDirectory', async () => {
            const folderOnlyStore = {
                getProcess: vi.fn(async () => ({
                    id: 'proc-folder',
                    type: 'clarification',
                    promptPreview: 'test',
                    fullPrompt: 'test',
                    status: 'completed',
                    startTime: new Date(),
                    workingDirectory: 'process-working-directory',
                    payload: { folderPath: 'payload-folder' },
                })),
            } as unknown as ProcessStore;
            await expect(recoverIterationPaths(makeRecord([
                { iteration: 1, processId: 'proc-folder' },
            ]), folderOnlyStore, 'ws-1')).resolves.toEqual({
                workingDirectory: 'payload-folder',
                folderPath: 'payload-folder',
            });

            const processOnlyStore = {
                getProcess: vi.fn(async () => ({
                    id: 'proc-process',
                    type: 'clarification',
                    promptPreview: 'test',
                    fullPrompt: 'test',
                    status: 'completed',
                    startTime: new Date(),
                    workingDirectory: 'process-working-directory',
                })),
            } as unknown as ProcessStore;
            await expect(recoverIterationPaths(makeRecord([
                { iteration: 1, processId: 'proc-process' },
            ]), processOnlyStore, 'ws-1')).resolves.toEqual({
                workingDirectory: 'process-working-directory',
                folderPath: undefined,
            });
        });

        it('returns undefined paths when process recovery fails', async () => {
            const store = {
                getProcess: vi.fn(async () => {
                    throw new Error('store unavailable');
                }),
            } as unknown as ProcessStore;

            await expect(recoverIterationPaths(makeRecord([
                { iteration: 1, processId: 'proc-error' },
            ]), store, 'ws-1')).resolves.toEqual({
                workingDirectory: undefined,
                folderPath: undefined,
            });
        });
    });
});

function makeBridge(tasks: QueuedTask[]): MultiRepoQueueRouter {
    return {
        registry: {
            getAllQueues: () => new Map([['repo-1', { getAll: () => tasks }]]),
        },
    } as unknown as MultiRepoQueueRouter;
}

function makeTask(id: string, status: QueuedTask['status'], sessionId: string): QueuedTask {
    return {
        id,
        status,
        type: 'chat',
        priority: 'normal',
        createdAt: Date.now(),
        payload: { context: { ralph: { sessionId } } },
        config: {},
    };
}

function makeRecord(
    iterations: Array<{ iteration: number; processId?: string }>,
): RalphSessionRecord {
    return {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'Goal',
        maxIterations: 10,
        currentIteration: 3,
        phase: 'complete',
        startedAt: '2026-05-29T00:00:00.000Z',
        iterations: iterations.map(iter => ({
            iteration: iter.iteration,
            loopIndex: 1,
            taskId: `task-${iter.iteration}`,
            processId: iter.processId ?? '',
            startedAt: '2026-05-29T00:00:00.000Z',
            status: 'completed',
        })),
    };
}

function makeTempDataDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-route-utils-'));
    tempDirs.push(dir);
    return dir;
}

function writeRepoPreferences(
    dataDir: string,
    workspaceId: string,
    prefs: Record<string, unknown>,
): void {
    const repoDir = path.join(dataDir, 'repos', workspaceId);
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'preferences.json'), JSON.stringify(prefs), 'utf-8');
}
