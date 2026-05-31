import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { registerGenericClassificationRoutes } from '../../../../src/server/repos/generic-classification-handler';
import type { Route } from '../../../../src/server/types';

// Mock dependencies
vi.mock('../../../../src/server/repos/classification-store', () => ({
    readClassification: vi.fn(),
    readPending: vi.fn(),
    writePending: vi.fn(),
    clearPending: vi.fn(),
}));

vi.mock('../../../../src/server/repos/pr-classification-handler', () => ({
    buildClassificationPrompt: vi.fn(() => 'mock prompt'),
}));

import {
    readClassification,
    readPending,
    clearPending,
} from '../../../../src/server/repos/classification-store';

const mockedReadClassification = vi.mocked(readClassification);
const mockedReadPending = vi.mocked(readPending);
const mockedClearPending = vi.mocked(clearPending);

// Helper to build a mock bridge with configurable getTask behaviour
function makeMockBridge(getTaskImpl?: (id: string) => any) {
    return {
        getOrCreateBridge: vi.fn(),
        getRepoIdForPath: vi.fn(() => 'repo1'),
        getTask: vi.fn(getTaskImpl ?? (() => undefined)),
        registry: {
            getQueueForRepo: vi.fn(() => ({
                enqueue: vi.fn(() => 'task-123'),
            })),
        },
    } as any;
}

// Minimal request/response helpers
function makeGetReq(url: string): IncomingMessage {
    return { url, headers: { host: 'localhost:4000' } } as IncomingMessage;
}

function makeCapturingRes(): { res: ServerResponse; getData: () => any; statusCode: () => number | undefined } {
    let responseData: any;
    let code: number | undefined;
    const res = {
        writeHead: vi.fn((c: number) => { code = c; }),
        end: vi.fn((data: string) => { try { responseData = JSON.parse(data); } catch { /* ok */ } }),
    } as unknown as ServerResponse;
    return { res, getData: () => responseData, statusCode: () => code };
}

describe('registerGenericClassificationRoutes', () => {
    let routes: Route[];
    const mockStore = {} as any;
    const mockRepoTreeService = {
        resolveRepo: vi.fn(() => Promise.resolve({ localPath: '/tmp/repo' })),
    } as any;

    beforeEach(() => {
        routes = [];
        vi.clearAllMocks();
    });

    function setup(getTaskImpl?: (id: string) => any) {
        const bridge = makeMockBridge(getTaskImpl);
        registerGenericClassificationRoutes(routes, {
            dataDir: '/tmp/data',
            store: mockStore,
            bridge,
            repoTreeService: mockRepoTreeService,
        });
        return bridge;
    }

    it('registers POST and GET routes', () => {
        setup();
        expect(routes).toHaveLength(2);
        expect(routes[0].method).toBe('POST');
        expect(routes[1].method).toBe('GET');
    });

    it('POST pattern matches /api/repos/:repoId/classify-diff', () => {
        setup();
        const pattern = routes[0].pattern;
        expect('/api/repos/my-repo/classify-diff').toMatch(pattern);
        expect('/api/repos/my-repo/classify-diff/extra').not.toMatch(pattern);
    });

    it('GET pattern matches /api/repos/:repoId/classify-diff', () => {
        setup();
        const pattern = routes[1].pattern;
        expect('/api/repos/my-repo/classify-diff').toMatch(pattern);
    });

    // =========================================================================
    // GET handler
    // =========================================================================

    describe('GET handler', () => {
        it('returns cached result when available', async () => {
            setup();
            const mockResult = {
                result: { classifications: [{ file: 'a.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'test' }] },
                processId: 'proc-1',
                createdAt: '2026-01-01T00:00:00Z',
                headSha: 'abc123',
            };
            mockedReadClassification.mockReturnValue(mockResult as any);

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=pr&identifier=42%3Aabc123'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('ready');
            expect(getData().result).toEqual(mockResult.result);
        });

        it('returns running when pending marker has an alive task', async () => {
            // alive task: status = 'running'
            setup(() => ({ id: 'proc-2', status: 'running' }));
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'proc-2', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=commit&identifier=abc1234'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('running');
            expect(getData().processId).toBe('proc-2');
            expect(mockedClearPending).not.toHaveBeenCalled();
        });

        it('returns running when pending marker task is queued', async () => {
            setup(() => ({ id: 'proc-q', status: 'queued' }));
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'proc-q', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=pr&identifier=5%3Asha123'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('running');
            expect(mockedClearPending).not.toHaveBeenCalled();
        });

        it('self-heals: clears stale marker and returns none when task is not found', async () => {
            // task not found → undefined → stale
            setup(() => undefined);
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'gone-task', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=commit&identifier=deadbeef'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('none');
            expect(mockedClearPending).toHaveBeenCalled();
        });

        it('self-heals: clears stale marker and returns none when task has failed', async () => {
            setup(() => ({ id: 'proc-3', status: 'failed' }));
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'proc-3', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=pr&identifier=10%3Afail123'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('none');
            expect(mockedClearPending).toHaveBeenCalled();
        });

        it('self-heals: clears stale marker and returns none when task is cancelled', async () => {
            setup(() => ({ id: 'proc-4', status: 'cancelled' }));
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'proc-4', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=branch-range&identifier=main..feat'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('none');
            expect(mockedClearPending).toHaveBeenCalled();
        });

        it('fail-safe: keeps running when bridge.getTask throws', async () => {
            setup(() => { throw new Error('queue unavailable'); });
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'proc-5', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=commit&identifier=abc999'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('running');
            expect(mockedClearPending).not.toHaveBeenCalled();
        });

        it('returns none when nothing cached or pending', async () => {
            setup();
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue(undefined);

            const { res, getData } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?type=branch-range&identifier=main..feature'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('none');
        });

        it('returns 400 for missing type parameter', async () => {
            setup();
            const { res, statusCode } = makeCapturingRes();
            await routes[1].handler(
                makeGetReq('/api/repos/repo1/classify-diff?identifier=abc'),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(statusCode()).toBe(400);
        });
    });

    // =========================================================================
    // POST handler — stale-marker healing
    // =========================================================================

    describe('POST handler — stale-marker healing', () => {
        function makePostReq(body: object): IncomingMessage {
            const emitter = new EventEmitter() as any;
            emitter.method = 'POST';
            emitter.url = '/api/repos/repo1/classify-diff';
            emitter.headers = { host: 'localhost:4000', 'content-type': 'application/json' };
            setImmediate(() => {
                emitter.emit('data', Buffer.from(JSON.stringify(body)));
                emitter.emit('end');
            });
            return emitter as IncomingMessage;
        }

        it('short-circuits with running when pending task is alive', async () => {
            setup(() => ({ id: 'task-alive', status: 'running' }));
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'task-alive', startedAt: '2026-01-01' });

            const { res, getData } = makeCapturingRes();
            await routes[0].handler(
                makePostReq({ type: 'pr', identifier: '42:abc123', workspaceId: 'ws1' }),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(getData().status).toBe('running');
            expect(getData().processId).toBe('task-alive');
            expect(mockedClearPending).not.toHaveBeenCalled();
        });

        it('clears stale marker and re-enqueues when task is not found', async () => {
            setup(() => undefined);
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'stale-task', startedAt: '2026-01-01' });

            const { res, getData, statusCode } = makeCapturingRes();
            await routes[0].handler(
                makePostReq({ type: 'pr', identifier: '42:abc123', workspaceId: 'ws1' }),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            // Should have cleared the stale marker and enqueued a new task
            expect(mockedClearPending).toHaveBeenCalled();
            expect(getData().status).toBe('started');
            expect(statusCode()).toBe(202);
        });

        it('clears stale marker and re-enqueues when task has failed', async () => {
            setup(() => ({ id: 'failed-task', status: 'failed' }));
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'failed-task', startedAt: '2026-01-01' });

            const { res, getData, statusCode } = makeCapturingRes();
            await routes[0].handler(
                makePostReq({ type: 'commit', identifier: 'abc1234', workspaceId: 'ws1' }),
                res,
                ['/api/repos/repo1/classify-diff', 'repo1'],
            );

            expect(mockedClearPending).toHaveBeenCalled();
            expect(getData().status).toBe('started');
            expect(statusCode()).toBe(202);
        });
    });
});

