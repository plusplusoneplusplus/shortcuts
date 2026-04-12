/**
 * Tests for GET /api/processes/search — Full-text conversation search endpoint.
 *
 * Verifies query handling, filter pass-through, pagination, empty-query behavior,
 * and graceful degradation when the store lacks searchConversations support.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/api-handler';
import type { QueueExecutorBridge } from '../../src/server/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import type { ConversationSearchResult, SearchFilter } from '@plusplusoneplusplus/forge';

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    reqUrl: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(reqUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function makeSearchResult(overrides: Partial<ConversationSearchResult> = {}): ConversationSearchResult {
    return {
        processId: 'proc-1',
        turnIndex: 0,
        role: 'user',
        snippet: 'matching <b>keyword</b> in text',
        rank: -1.5,
        processTitle: 'Test process',
        promptPreview: 'test prompt',
        processStatus: 'completed',
        processType: 'chat',
        workspaceId: 'ws-1',
        startTime: '2025-06-01T10:00:00Z',
        ...overrides,
    };
}

// ============================================================================
// Tests — store WITH searchConversations
// ============================================================================

describe('GET /api/processes/search', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let mockSearch: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        store = createMockProcessStore();

        // Attach a mock searchConversations to the store
        mockSearch = vi.fn<(query: string, filter?: SearchFilter) => Promise<{ results: ConversationSearchResult[]; total: number }>>();
        (store as any).searchConversations = mockSearch;

        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn(async () => {}),
            isSessionAlive: vi.fn(async () => false),
        };

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns matching results for a keyword query', async () => {
        const expected = [makeSearchResult({ processId: 'p1' }), makeSearchResult({ processId: 'p2' })];
        mockSearch.mockResolvedValueOnce({ results: expected, total: 2 });

        const resp = await request(`${baseUrl}/api/processes/search?q=keyword`);
        expect(resp.status).toBe(200);

        const body = resp.json();
        expect(body.results).toHaveLength(2);
        expect(body.total).toBe(2);
        expect(body.query).toBe('keyword');
        expect(body.limit).toBe(50);
        expect(body.offset).toBe(0);
    });

    it('returns empty results when q is missing', async () => {
        mockSearch.mockClear();
        const resp = await request(`${baseUrl}/api/processes/search`);
        expect(resp.status).toBe(200);

        const body = resp.json();
        expect(body.results).toEqual([]);
        expect(body.total).toBe(0);
        expect(body.query).toBe('');
        expect(mockSearch).not.toHaveBeenCalled();
    });

    it('returns empty results when q is empty string', async () => {
        mockSearch.mockClear();
        const resp = await request(`${baseUrl}/api/processes/search?q=`);
        expect(resp.status).toBe(200);

        const body = resp.json();
        expect(body.results).toEqual([]);
        expect(body.total).toBe(0);
        expect(mockSearch).not.toHaveBeenCalled();
    });

    it('returns empty results when q is whitespace only', async () => {
        mockSearch.mockClear();
        const resp = await request(`${baseUrl}/api/processes/search?q=%20%20`);
        expect(resp.status).toBe(200);

        const body = resp.json();
        expect(body.results).toEqual([]);
        expect(body.total).toBe(0);
        expect(mockSearch).not.toHaveBeenCalled();
    });

    it('passes workspace filter to store', async () => {
        mockSearch.mockResolvedValueOnce({ results: [], total: 0 });

        await request(`${baseUrl}/api/processes/search?q=test&workspace=ws-abc`);

        expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({
            workspaceId: 'ws-abc',
        }));
    });

    it('passes status filter to store', async () => {
        mockSearch.mockResolvedValueOnce({ results: [], total: 0 });

        await request(`${baseUrl}/api/processes/search?q=test&status=completed`);

        expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({
            status: ['completed'],
        }));
    });

    it('passes type filter to store', async () => {
        mockSearch.mockResolvedValueOnce({ results: [], total: 0 });

        await request(`${baseUrl}/api/processes/search?q=test&type=chat`);

        expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({
            type: 'chat',
        }));
    });

    it('respects limit and offset pagination params', async () => {
        mockSearch.mockResolvedValueOnce({ results: [makeSearchResult()], total: 100 });

        const resp = await request(`${baseUrl}/api/processes/search?q=test&limit=5&offset=10`);
        expect(resp.status).toBe(200);

        const body = resp.json();
        expect(body.limit).toBe(5);
        expect(body.offset).toBe(10);
        expect(body.total).toBe(100);

        expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({
            limit: 5,
            offset: 10,
        }));
    });

    it('uses default limit=50 and offset=0 when not specified', async () => {
        mockSearch.mockResolvedValueOnce({ results: [], total: 0 });

        await request(`${baseUrl}/api/processes/search?q=test`);

        expect(mockSearch).toHaveBeenCalledWith('test', expect.objectContaining({
            limit: 50,
            offset: 0,
        }));
    });

    it('response shape includes all documented fields', async () => {
        mockSearch.mockResolvedValueOnce({ results: [makeSearchResult()], total: 1 });

        const resp = await request(`${baseUrl}/api/processes/search?q=test`);
        const body = resp.json();

        expect(body).toHaveProperty('results');
        expect(body).toHaveProperty('total');
        expect(body).toHaveProperty('query');
        expect(body).toHaveProperty('limit');
        expect(body).toHaveProperty('offset');
    });
});

// ============================================================================
// Tests — store WITHOUT searchConversations
// ============================================================================

describe('GET /api/processes/search — store without FTS support', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const store = createMockProcessStore();
        // Do NOT attach searchConversations — simulates non-SQLite store

        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn(async () => {}),
            isSessionAlive: vi.fn(async () => false),
        };

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns 400 when store does not support searchConversations', async () => {
        const resp = await request(`${baseUrl}/api/processes/search?q=anything`);
        expect(resp.status).toBe(400);

        const body = resp.json();
        expect(body.error).toContain('Full-text search not supported');
    });

    it('still returns empty results for missing q param (no store call needed)', async () => {
        const resp = await request(`${baseUrl}/api/processes/search`);
        expect(resp.status).toBe(200);

        const body = resp.json();
        expect(body.results).toEqual([]);
        expect(body.total).toBe(0);
    });
});
