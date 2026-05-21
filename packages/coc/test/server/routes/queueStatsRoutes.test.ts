import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { registerQueueStatsRoutes } from '../../../src/server/routes/queue-stats';
import type { Route } from '../../../src/server/types';

function createResponseCapture() {
    let statusCode: number | undefined;
    let responseData: any;
    const res = {
        writeHead: vi.fn((code: number) => { statusCode = code; }),
        end: vi.fn((data: string) => { responseData = JSON.parse(data); }),
    } as unknown as ServerResponse;
    return {
        res,
        get statusCode() { return statusCode; },
        get data() { return responseData; },
    };
}

function createQueueManager({
    queued = [],
    running = [],
    stats,
}: {
    queued?: any[];
    running?: any[];
    stats?: any;
}) {
    const queueItems = queued;
    return {
        getQueueItems: vi.fn(() => queueItems),
        getQueued: vi.fn(() => queued),
        getRunning: vi.fn(() => running),
        getStats: vi.fn(() => ({
            queued: queued.length,
            running: running.length,
            completed: 0,
            failed: 0,
            cancelled: 0,
            total: queued.length + running.length,
            isPaused: false,
            isDraining: false,
            isAutopilotPaused: false,
            ...stats,
        })),
    };
}

function createTask(overrides: Partial<any>) {
    return {
        id: 'task-1',
        repoId: 'repo-1',
        type: 'chat',
        priority: 'normal',
        status: 'queued',
        createdAt: 1,
        payload: { kind: 'chat', mode: 'ask', prompt: 'hello' },
        config: {},
        ...overrides,
    };
}

describe('registerQueueStatsRoutes', () => {
    it('aggregates repo-specific queued and running tasks for global GET /api/queue', async () => {
        const globalManager = createQueueManager({});
        const repoOneManager = createQueueManager({
            queued: [
                createTask({
                    id: 'classification-queued',
                    repoId: 'repo-1',
                    type: 'pr-classification',
                    payload: {
                        kind: 'pr-classification',
                        workspaceId: 'repo-1',
                        repoId: 'repo-1',
                        prId: '42',
                        headSha: 'abc1234',
                        prompt: 'classify',
                    },
                    displayName: 'Classify PR #42 [abc1234]',
                }),
            ],
        });
        const repoTwoManager = createQueueManager({
            running: [
                createTask({
                    id: 'chat-running',
                    repoId: 'repo-2',
                    status: 'running',
                    startedAt: 2,
                    processId: 'queue_chat-running',
                }),
            ],
        });
        const allQueues = new Map<string, any>([
            ['global', globalManager],
            ['repo-one', repoOneManager],
            ['repo-two', repoTwoManager],
        ]);
        const routes: Route[] = [];
        registerQueueStatsRoutes(routes, {
            bridge: {
                registry: {
                    getQueueForRepo: vi.fn(() => globalManager),
                    getAllQueues: vi.fn(() => allQueues),
                },
            } as any,
            store: undefined,
            globalWorkspaceRootPath: 'global',
            state: { globalPaused: false, globalAutopilotPaused: false, resumeInProgress: new Set() },
        });

        const route = routes.find(r => r.method === 'GET' && r.pattern === '/api/queue');
        expect(route).toBeDefined();

        const capture = createResponseCapture();
        await route!.handler(
            { url: '/api/queue', headers: { host: 'localhost:4000' } } as IncomingMessage,
            capture.res,
        );

        expect(capture.statusCode).toBe(200);
        expect(capture.data.queued).toEqual([
            expect.objectContaining({
                id: 'classification-queued',
                repoId: 'repo-1',
                type: 'pr-classification',
                displayName: 'Classify PR #42 [abc1234]',
            }),
        ]);
        expect(capture.data.running).toEqual([
            expect.objectContaining({
                id: 'chat-running',
                repoId: 'repo-2',
                type: 'chat',
                status: 'running',
            }),
        ]);
        expect(capture.data.stats).toEqual(expect.objectContaining({
            queued: 1,
            running: 1,
            total: 2,
        }));
    });

    it('keeps repo-scoped GET /api/queue?repoId=... limited to the requested repo', async () => {
        const repoOneManager = createQueueManager({
            queued: [
                createTask({
                    id: 'repo-one-task',
                    repoId: 'repo-1',
                }),
            ],
        });
        const repoTwoManager = createQueueManager({
            queued: [
                createTask({
                    id: 'repo-two-task',
                    repoId: 'repo-2',
                }),
            ],
        });
        const routes: Route[] = [];
        registerQueueStatsRoutes(routes, {
            bridge: {
                getManagerByRepoId: vi.fn((repoId: string) => repoId === 'repo-1' ? repoOneManager : repoTwoManager),
                registry: {
                    getQueueForRepo: vi.fn(),
                    getAllQueues: vi.fn(() => new Map<string, any>()),
                },
            } as any,
            store: undefined,
            globalWorkspaceRootPath: undefined,
            state: { globalPaused: false, globalAutopilotPaused: false, resumeInProgress: new Set() },
        });

        const route = routes.find(r => r.method === 'GET' && r.pattern === '/api/queue');
        expect(route).toBeDefined();

        const capture = createResponseCapture();
        await route!.handler(
            { url: '/api/queue?repoId=repo-1', headers: { host: 'localhost:4000' } } as IncomingMessage,
            capture.res,
        );

        expect(capture.statusCode).toBe(200);
        expect(capture.data.queued).toEqual([
            expect.objectContaining({ id: 'repo-one-task', repoId: 'repo-1' }),
        ]);
        expect(capture.data.queued).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'repo-two-task' })]),
        );
    });
});
