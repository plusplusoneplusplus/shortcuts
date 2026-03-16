/**
 * Stats Handler Tests
 *
 * Unit tests for GET /api/stats/token-usage:
 * - Happy path with two processes, no `days` param
 * - ?days=7 passes option through to aggregator
 * - Store error → 500 { error: ... }
 * - Empty process list → { entries: [], models: [], totalDays: 0 }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as http from 'http';
import { registerStatsRoutes } from '../../src/server/stats-handler';
import type { Route } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore, AIProcess, TokenUsageStatsResponse } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        aggregateTokenUsageStats: vi.fn(),
    };
});

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal fake IncomingMessage with just a `url`. */
function fakeReq(url: string): http.IncomingMessage {
    return { url } as unknown as http.IncomingMessage;
}

/** Capture calls to sendJson by intercepting res.writeHead / res.end. */
function fakeRes(): {
    res: http.ServerResponse;
    capturedStatus: () => number;
    capturedBody: () => unknown;
} {
    let status = 200;
    let body: unknown = undefined;

    const res = {
        writeHead: (code: number) => {
            status = code;
        },
        setHeader: () => {},
        end: (data?: string) => {
            if (data) {
                try {
                    body = JSON.parse(data);
                } catch {
                    body = data;
                }
            }
        },
    } as unknown as http.ServerResponse;

    return {
        res,
        capturedStatus: () => status,
        capturedBody: () => body,
    };
}

/** Build a minimal fake ProcessStore. */
function makeStore(override: Partial<ProcessStore> = {}): ProcessStore {
    return {
        getAllProcesses: vi.fn().mockResolvedValue([]),
        addProcess: vi.fn(),
        updateProcess: vi.fn(),
        getProcess: vi.fn(),
        removeProcess: vi.fn(),
        clearProcesses: vi.fn(),
        getWorkspaces: vi.fn(),
        registerWorkspace: vi.fn(),
        removeWorkspace: vi.fn(),
        updateWorkspace: vi.fn(),
        getWikis: vi.fn(),
        registerWiki: vi.fn(),
        removeWiki: vi.fn(),
        updateWiki: vi.fn(),
        clearAllWorkspaces: vi.fn(),
        clearAllWikis: vi.fn(),
        getStorageStats: vi.fn(),
        onProcessOutput: vi.fn(),
        emitProcessOutput: vi.fn(),
        ...override,
    } as unknown as ProcessStore;
}

/** Invoke the first registered route handler (GET /api/stats/token-usage). */
async function invoke(routes: Route[], url: string): Promise<{ status: number; body: unknown }> {
    const route = routes.find(
        (r) => r.method === 'GET' && r.pattern === '/api/stats/token-usage'
    );
    if (!route) throw new Error('Route not registered');
    const { res, capturedStatus, capturedBody } = fakeRes();
    await Promise.resolve(route.handler(fakeReq(url), res));
    return { status: capturedStatus(), body: capturedBody() };
}

// ============================================================================
// Tests
// ============================================================================

describe('registerStatsRoutes — GET /api/stats/token-usage', () => {
    let aggregateTokenUsageStats: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('@plusplusoneplusplus/pipeline-core');
        aggregateTokenUsageStats = mod.aggregateTokenUsageStats as ReturnType<typeof vi.fn>;
    });

    it('1. happy path — two processes, no days param', async () => {
        const mockProcesses: Partial<AIProcess>[] = [
            { id: 'p1', startTime: new Date(), status: 'completed', promptPreview: '', fullPrompt: '' },
            { id: 'p2', startTime: new Date(), status: 'completed', promptPreview: '', fullPrompt: '' },
        ];
        const store = makeStore({
            getAllProcesses: vi.fn().mockResolvedValue(mockProcesses),
        });

        const expectedResponse: TokenUsageStatsResponse = {
            entries: [
                {
                    date: '2026-01-01',
                    byModel: { 'gpt-4': { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15, turnCount: 1 } },
                    dayTotal: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15, turnCount: 1 },
                },
            ],
            models: ['gpt-4'],
            generatedAt: new Date().toISOString(),
            totalDays: 1,
        };
        aggregateTokenUsageStats.mockReturnValue(expectedResponse);

        const routes: Route[] = [];
        registerStatsRoutes(routes, store);

        const { status, body } = await invoke(routes, '/api/stats/token-usage');

        expect(status).toBe(200);
        const result = body as TokenUsageStatsResponse;
        expect(result).toHaveProperty('entries');
        expect(result).toHaveProperty('models');
        expect(result).toHaveProperty('generatedAt');
        expect(result).toHaveProperty('totalDays');

        // aggregateTokenUsageStats called with (serialized processes, {})
        expect(aggregateTokenUsageStats).toHaveBeenCalledOnce();
        const [, opts] = aggregateTokenUsageStats.mock.calls[0];
        expect(opts).toEqual({});
    });

    it('2. ?days=7 passes option through to aggregator', async () => {
        const store = makeStore({
            getAllProcesses: vi.fn().mockResolvedValue([]),
        });
        aggregateTokenUsageStats.mockReturnValue({
            entries: [],
            models: [],
            generatedAt: new Date().toISOString(),
            totalDays: 0,
        });

        const routes: Route[] = [];
        registerStatsRoutes(routes, store);

        await invoke(routes, '/api/stats/token-usage?days=7');

        expect(aggregateTokenUsageStats).toHaveBeenCalledOnce();
        const [, opts] = aggregateTokenUsageStats.mock.calls[0];
        expect(opts).toEqual({ days: 7 });
    });

    it('3. store error → 500 { error: ... }', async () => {
        const store = makeStore({
            getAllProcesses: vi.fn().mockRejectedValue(new Error('disk failure')),
        });

        const routes: Route[] = [];
        registerStatsRoutes(routes, store);

        const { status, body } = await invoke(routes, '/api/stats/token-usage');

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'disk failure' });
    });

    it('4. empty process list → { entries: [], models: [], totalDays: 0 }', async () => {
        const store = makeStore({
            getAllProcesses: vi.fn().mockResolvedValue([]),
        });
        aggregateTokenUsageStats.mockReturnValue({
            entries: [],
            models: [],
            generatedAt: new Date().toISOString(),
            totalDays: 0,
        });

        const routes: Route[] = [];
        registerStatsRoutes(routes, store);

        const { status, body } = await invoke(routes, '/api/stats/token-usage');

        expect(status).toBe(200);
        const result = body as TokenUsageStatsResponse;
        expect(result.entries).toEqual([]);
        expect(result.models).toEqual([]);
        expect(result.totalDays).toBe(0);
    });
});
