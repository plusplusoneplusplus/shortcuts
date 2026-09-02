/**
 * Unit tests for GET /api/stats/token-usage:
 * - Happy path with two processes, no `days` param
 * - ?days=7 passes option through to aggregator
 * - Store error → 500 { error: ... }
 * - Empty process list → { entries: [], models: [], totalDays: 0 }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as http from 'http';
import { registerStatsRoutes } from '../../src/server/admin/stats-handler';
import type { Route } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore, AIProcess, TokenUsageStatsResponse } from '@plusplusoneplusplus/forge';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
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

/** Invoke a registered GET route handler by pattern. */
async function invokePattern(
    routes: Route[],
    pattern: string,
    url: string
): Promise<{ status: number; body: unknown }> {
    const route = routes.find((r) => r.method === 'GET' && r.pattern === pattern);
    if (!route) throw new Error('Route not registered');
    const { res, capturedStatus, capturedBody } = fakeRes();
    await Promise.resolve(route.handler(fakeReq(url), res));
    return { status: capturedStatus(), body: capturedBody() };
}

/** Invoke the token-usage route handler. */
async function invoke(routes: Route[], url: string): Promise<{ status: number; body: unknown }> {
    return invokePattern(routes, '/api/stats/token-usage', url);
}

// ============================================================================
// Tests
// ============================================================================

describe('registerStatsRoutes — GET /api/stats/token-usage', () => {
    let aggregateTokenUsageStats: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('@plusplusoneplusplus/forge');
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

    it('4. getAllProcesses is called with exclude: ["conversation"]', async () => {
        const getAllProcesses = vi.fn().mockResolvedValue([]);
        const store = makeStore({ getAllProcesses });
        aggregateTokenUsageStats.mockReturnValue({
            entries: [],
            models: [],
            generatedAt: new Date().toISOString(),
            totalDays: 0,
        });

        const routes: Route[] = [];
        registerStatsRoutes(routes, store);

        await invoke(routes, '/api/stats/token-usage');

        expect(getAllProcesses).toHaveBeenCalledOnce();
        expect(getAllProcesses).toHaveBeenCalledWith({ exclude: ['conversation'] });
    });

    it('5. empty process list → { entries: [], models: [], totalDays: 0 }', async () => {
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

// ============================================================================
// GET /api/stats/turn-performance
// ============================================================================

import type { TurnPerformanceStore } from '../../src/server/storage/turn-performance-store';
import type { TurnPerformanceEvent, TurnPerformanceStatsResponse } from '@plusplusoneplusplus/forge';

function makeTurnEvent(overrides: Partial<TurnPerformanceEvent> = {}): TurnPerformanceEvent {
    return {
        id: 'p1:0',
        processId: 'p1',
        turnIndex: 0,
        workspaceId: 'ws-1',
        provider: 'claude',
        model: 'claude-sonnet-5',
        effortTier: null,
        mode: 'autopilot',
        kind: 'chat',
        enqueuedAt: '2026-08-20T10:00:00.000Z',
        startedAt: '2026-08-20T10:00:01.000Z',
        firstOutputAt: '2026-08-20T10:00:03.000Z',
        endedAt: '2026-08-20T10:00:11.000Z',
        ttftMs: 2000,
        queueWaitMs: 1000,
        generationMs: 8000,
        wallMs: 10000,
        inputTokens: 100,
        outputTokens: 400,
        totalTokens: 500,
        tpsGeneration: 50,
        tpsWall: 40,
        status: 'completed',
        ...overrides,
    };
}

function makeTurnPerformanceStore(events: TurnPerformanceEvent[] = []): {
    store: TurnPerformanceStore;
    queryEvents: ReturnType<typeof vi.fn>;
} {
    const queryEvents = vi.fn().mockReturnValue(events);
    return {
        store: { queryEvents } as unknown as TurnPerformanceStore,
        queryEvents,
    };
}

async function invokeTurnPerf(
    routes: Route[],
    url: string
): Promise<{ status: number; body: unknown }> {
    return invokePattern(routes, '/api/stats/turn-performance', url);
}

describe('registerStatsRoutes — GET /api/stats/turn-performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('1. happy path — 200 with aggregated shape and default groupBy=provider', async () => {
        const { store: tpStore, queryEvents } = makeTurnPerformanceStore([
            makeTurnEvent(),
            makeTurnEvent({ id: 'p2:0', processId: 'p2', provider: 'copilot', ttftMs: 4000 }),
        ]);

        const routes: Route[] = [];
        registerStatsRoutes(routes, makeStore(), () => tpStore);

        const { status, body } = await invokeTurnPerf(routes, '/api/stats/turn-performance');

        expect(status).toBe(200);
        const result = body as TurnPerformanceStatsResponse;
        expect(result.groupBy).toEqual(['provider']);
        expect(result.days).toBeNull();
        expect(result.totalEvents).toBe(2);
        expect(result.groups.map((g) => g.key)).toEqual([
            { provider: 'claude' },
            { provider: 'copilot' },
        ]);
        expect(result.groups[0].ttftMs.p50).toBe(2000);
        expect(result.excludedEvents).toEqual({ nonCompleted: 0, noFirstToken: 0, noTokenUsage: 0 });
        expect(queryEvents).toHaveBeenCalledWith({ days: undefined, processId: undefined, firstTurnOnly: false });
    });

    it('2. days / firstTurnOnly / processId are forwarded to the store query', async () => {
        const { store: tpStore, queryEvents } = makeTurnPerformanceStore();

        const routes: Route[] = [];
        registerStatsRoutes(routes, makeStore(), () => tpStore);

        const { status, body } = await invokeTurnPerf(
            routes,
            '/api/stats/turn-performance?days=7&firstTurnOnly=1&processId=p42'
        );

        expect(status).toBe(200);
        expect((body as TurnPerformanceStatsResponse).days).toBe(7);
        expect(queryEvents).toHaveBeenCalledWith({ days: 7, processId: 'p42', firstTurnOnly: true });
    });

    it('3. repeated and comma-separated groupBy produce a composite key', async () => {
        const { store: tpStore } = makeTurnPerformanceStore([makeTurnEvent()]);

        const routes: Route[] = [];
        registerStatsRoutes(routes, makeStore(), () => tpStore);

        for (const qs of ['groupBy=provider&groupBy=model', 'groupBy=provider,model']) {
            const { status, body } = await invokeTurnPerf(routes, `/api/stats/turn-performance?${qs}`);
            expect(status).toBe(200);
            const result = body as TurnPerformanceStatsResponse;
            expect(result.groupBy).toEqual(['provider', 'model']);
            expect(result.groups[0].key).toEqual({ provider: 'claude', model: 'claude-sonnet-5' });
        }
    });

    it('4. bogus groupBy → 400 listing valid dimensions', async () => {
        const { store: tpStore, queryEvents } = makeTurnPerformanceStore();

        const routes: Route[] = [];
        registerStatsRoutes(routes, makeStore(), () => tpStore);

        const { status, body } = await invokeTurnPerf(routes, '/api/stats/turn-performance?groupBy=bogus');

        expect(status).toBe(400);
        const err = (body as { error: string }).error;
        expect(err).toContain('bogus');
        expect(err).toContain('provider');
        expect(err).toContain('day');
        expect(queryEvents).not.toHaveBeenCalled();
    });

    it('5. no turn-performance store wired → 200 with empty aggregate', async () => {
        const routes: Route[] = [];
        registerStatsRoutes(routes, makeStore());

        const { status, body } = await invokeTurnPerf(routes, '/api/stats/turn-performance');

        expect(status).toBe(200);
        const result = body as TurnPerformanceStatsResponse;
        expect(result.groups).toEqual([]);
        expect(result.totalEvents).toBe(0);
    });

    it('6. store query error → 500 { error }', async () => {
        const queryEvents = vi.fn(() => { throw new Error('db locked'); });
        const tpStore = { queryEvents } as unknown as TurnPerformanceStore;

        const routes: Route[] = [];
        registerStatsRoutes(routes, makeStore(), () => tpStore);

        const { status, body } = await invokeTurnPerf(routes, '/api/stats/turn-performance');

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'db locked' });
    });
});
