import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { registerGenericClassificationRoutes } from '../../../../src/server/repos/generic-classification-handler';
import type { Route } from '../../../../src/server/types';

// Mock dependencies
vi.mock('../../../../src/server/repos/classification-store', () => ({
    readClassification: vi.fn(),
    readPending: vi.fn(),
    writePending: vi.fn(),
}));

vi.mock('../../../../src/server/repos/pr-classification-handler', () => ({
    buildClassificationPrompt: vi.fn(() => 'mock prompt'),
}));

import { readClassification, readPending } from '../../../../src/server/repos/classification-store';

const mockedReadClassification = vi.mocked(readClassification);
const mockedReadPending = vi.mocked(readPending);

describe('registerGenericClassificationRoutes', () => {
    let routes: Route[];
    const mockStore = {} as any;
    const mockBridge = {
        getOrCreateBridge: vi.fn(),
        getRepoIdForPath: vi.fn(() => 'repo1'),
        registry: {
            getQueueForRepo: vi.fn(() => ({
                enqueue: vi.fn(() => 'task-123'),
            })),
        },
    } as any;
    const mockRepoTreeService = {
        resolveRepo: vi.fn(() => Promise.resolve({ localPath: '/tmp/repo' })),
    } as any;

    beforeEach(() => {
        routes = [];
        vi.clearAllMocks();
        registerGenericClassificationRoutes(routes, {
            dataDir: '/tmp/data',
            store: mockStore,
            bridge: mockBridge,
            repoTreeService: mockRepoTreeService,
        });
    });

    it('registers POST and GET routes', () => {
        expect(routes).toHaveLength(2);
        expect(routes[0].method).toBe('POST');
        expect(routes[1].method).toBe('GET');
    });

    it('POST pattern matches /api/repos/:repoId/classify-diff', () => {
        const pattern = routes[0].pattern;
        expect('/api/repos/my-repo/classify-diff').toMatch(pattern);
        expect('/api/repos/my-repo/classify-diff/extra').not.toMatch(pattern);
    });

    it('GET pattern matches /api/repos/:repoId/classify-diff', () => {
        const pattern = routes[1].pattern;
        expect('/api/repos/my-repo/classify-diff').toMatch(pattern);
    });

    describe('GET handler', () => {
        it('returns cached result when available', async () => {
            const mockResult = {
                result: { classifications: [{ file: 'a.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'test' }] },
                processId: 'proc-1',
                createdAt: '2026-01-01T00:00:00Z',
                headSha: 'abc123',
            };
            mockedReadClassification.mockReturnValue(mockResult as any);

            const handler = routes[1].handler;
            const req = {
                url: '/api/repos/repo1/classify-diff?type=pr&identifier=42%3Aabc123',
                headers: { host: 'localhost:4000' },
            } as IncomingMessage;

            let responseData: any;
            const res = {
                writeHead: vi.fn(),
                end: vi.fn((data: string) => { responseData = JSON.parse(data); }),
            } as unknown as ServerResponse;

            await handler(req, res, ['/api/repos/repo1/classify-diff', 'repo1']);

            expect(responseData.status).toBe('ready');
            expect(responseData.result).toEqual(mockResult.result);
        });

        it('returns running when pending', async () => {
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue({ processId: 'proc-2', startedAt: '2026-01-01' });

            const handler = routes[1].handler;
            const req = {
                url: '/api/repos/repo1/classify-diff?type=commit&identifier=abc1234',
                headers: { host: 'localhost:4000' },
            } as IncomingMessage;

            let responseData: any;
            const res = {
                writeHead: vi.fn(),
                end: vi.fn((data: string) => { responseData = JSON.parse(data); }),
            } as unknown as ServerResponse;

            await handler(req, res, ['/api/repos/repo1/classify-diff', 'repo1']);

            expect(responseData.status).toBe('running');
            expect(responseData.processId).toBe('proc-2');
        });

        it('returns none when nothing cached', async () => {
            mockedReadClassification.mockReturnValue(undefined);
            mockedReadPending.mockReturnValue(undefined);

            const handler = routes[1].handler;
            const req = {
                url: '/api/repos/repo1/classify-diff?type=branch-range&identifier=main..feature',
                headers: { host: 'localhost:4000' },
            } as IncomingMessage;

            let responseData: any;
            const res = {
                writeHead: vi.fn(),
                end: vi.fn((data: string) => { responseData = JSON.parse(data); }),
            } as unknown as ServerResponse;

            await handler(req, res, ['/api/repos/repo1/classify-diff', 'repo1']);

            expect(responseData.status).toBe('none');
        });

        it('returns 400 for missing type parameter', async () => {
            const handler = routes[1].handler;
            const req = {
                url: '/api/repos/repo1/classify-diff?identifier=abc',
                headers: { host: 'localhost:4000' },
            } as IncomingMessage;

            let statusCode: number | undefined;
            const res = {
                writeHead: vi.fn((code: number) => { statusCode = code; }),
                end: vi.fn(),
            } as unknown as ServerResponse;

            await handler(req, res, ['/api/repos/repo1/classify-diff', 'repo1']);

            expect(statusCode).toBe(400);
        });
    });
});
