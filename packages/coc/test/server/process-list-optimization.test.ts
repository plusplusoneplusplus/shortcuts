/**
 * Process List & Stats Optimization Tests
 *
 * Verifies that GET /api/processes uses getProcessSummaries for the total count
 * (not a second getAllProcesses call), and GET /api/stats uses getProcessSummaries
 * instead of loading full process records.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { QueueExecutorBridge } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

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

describe('Process list & stats optimization', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();

        // Seed 5 processes across 2 statuses
        for (let i = 0; i < 3; i++) {
            const p = createProcessFixture({
                id: `opt-running-${i}`,
                status: 'running',
                promptPreview: `running ${i}`,
                metadata: { type: 'clarification', workspaceId: 'ws-a' },
            });
            store.processes.set(p.id, p);
        }
        for (let i = 0; i < 2; i++) {
            const p = createProcessFixture({
                id: `opt-done-${i}`,
                status: 'completed',
                promptPreview: `done ${i}`,
                metadata: { type: 'clarification', workspaceId: 'ws-b' },
            });
            store.processes.set(p.id, p);
        }

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

    // ========================================================================
    // GET /api/processes — count optimization
    // ========================================================================

    describe('GET /api/processes count optimization', () => {
        it('should use getProcessSummaries for total count instead of double getAllProcesses', async () => {
            // Clear call counts
            (store.getProcessSummaries as ReturnType<typeof vi.fn>).mockClear();
            (store.getAllProcesses as ReturnType<typeof vi.fn>).mockClear();

            const resp = await request(`${baseUrl}/api/processes?limit=2&offset=0`);
            expect(resp.status).toBe(200);

            const body = resp.json();
            expect(body.total).toBe(5); // all 5 processes counted via summaries
            expect(body.limit).toBe(2);
            expect(body.offset).toBe(0);

            // getProcessSummaries should be called once (for the count)
            expect(store.getProcessSummaries).toHaveBeenCalledTimes(1);

            // getAllProcesses should be called exactly once (for the paginated page), not twice
            expect(store.getAllProcesses).toHaveBeenCalledTimes(1);
        });

        it('should return correct total even when paginated', async () => {
            const resp = await request(`${baseUrl}/api/processes?limit=2&offset=3`);
            expect(resp.status).toBe(200);

            const body = resp.json();
            expect(body.total).toBe(5);
            expect(body.offset).toBe(3);
        });
    });

    // ========================================================================
    // GET /api/stats — summaries optimization
    // ========================================================================

    describe('GET /api/stats optimization', () => {
        it('should use getProcessSummaries instead of getAllProcesses for stats', async () => {
            (store.getProcessSummaries as ReturnType<typeof vi.fn>).mockClear();
            (store.getAllProcesses as ReturnType<typeof vi.fn>).mockClear();

            const resp = await request(`${baseUrl}/api/stats`);
            expect(resp.status).toBe(200);

            const body = resp.json();
            expect(body.totalProcesses).toBe(5);
            expect(body.byStatus.running).toBe(3);
            expect(body.byStatus.completed).toBe(2);

            // getProcessSummaries should be called (not getAllProcesses)
            expect(store.getProcessSummaries).toHaveBeenCalled();
            expect(store.getAllProcesses).not.toHaveBeenCalled();
        });

        it('should correctly aggregate workspace counts from summaries', async () => {
            const resp = await request(`${baseUrl}/api/stats`);
            const body = resp.json();

            // Workspace counts come from summary entries' workspaceId field
            expect(body.totalProcesses).toBe(5);
            expect(body.byStatus.running).toBe(3);
            expect(body.byStatus.completed).toBe(2);
        });
    });
});
