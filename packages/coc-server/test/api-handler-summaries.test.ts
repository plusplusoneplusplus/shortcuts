/**
 * API Handler — Process Summaries Endpoint Tests
 *
 * Tests for GET /api/processes/summaries — lightweight index-only process list.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock git services to avoid actual git CLI calls
// ============================================================================

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(() => ({})),
        GitRangeService: vi.fn().mockImplementation(() => ({})),
        WorkingTreeService: vi.fn().mockImplementation(() => ({})),
    };
});

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
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

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/processes/summaries', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore({
            initialProcesses: [
                createProcessFixture({ id: 'p1', status: 'completed', promptPreview: 'Hello', title: 'Chat about tests' }),
                createProcessFixture({ id: 'p2', status: 'running', promptPreview: 'World' }),
                createProcessFixture({ id: 'p3', status: 'failed', promptPreview: 'Oops', error: 'timeout' }),
            ],
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, store);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('should return summaries array with total, limit, offset', async () => {
        const res = await request(`${baseUrl}/api/processes/summaries`);
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body).toHaveProperty('summaries');
        expect(body).toHaveProperty('total');
        expect(body).toHaveProperty('limit');
        expect(body).toHaveProperty('offset');
        expect(Array.isArray(body.summaries)).toBe(true);
        expect(body.total).toBe(3);
    });

    it('should return lightweight entries without conversation data', async () => {
        const res = await request(`${baseUrl}/api/processes/summaries`);
        const body = res.json();
        for (const entry of body.summaries) {
            expect(entry).toHaveProperty('id');
            expect(entry).toHaveProperty('status');
            expect(entry).not.toHaveProperty('fullPrompt');
            expect(entry).not.toHaveProperty('conversationTurns');
        }
    });

    it('should include title when present', async () => {
        const res = await request(`${baseUrl}/api/processes/summaries`);
        const body = res.json();
        const p1 = body.summaries.find((s: any) => s.id === 'p1');
        expect(p1.title).toBe('Chat about tests');
    });

    it('should support status filter', async () => {
        const res = await request(`${baseUrl}/api/processes/summaries?status=running`);
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body.total).toBe(1);
        expect(body.summaries[0].id).toBe('p2');
    });

    it('should support pagination via limit and offset', async () => {
        const res = await request(`${baseUrl}/api/processes/summaries?limit=2&offset=0`);
        expect(res.status).toBe(200);
        const body = res.json();
        expect(body.summaries.length).toBeLessThanOrEqual(2);
        expect(body.limit).toBe(2);
        expect(body.offset).toBe(0);
    });
});
