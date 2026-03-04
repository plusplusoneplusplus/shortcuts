/**
 * API Handler — Child Process Routes Tests
 *
 * Verifies GET /api/processes/:id/children and
 * GET /api/processes?parentProcessId=X query parameter support.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { QueueExecutorBridge } from '../src/api-handler';
import type { Route } from '../src/types';
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
// Test Fixtures
// ============================================================================

function seedProcesses(store: MockProcessStore) {
    const parent = createProcessFixture({
        id: 'parent-1',
        type: 'pipeline',
        status: 'running',
        promptPreview: 'parent pipeline',
    });

    const child1 = createProcessFixture({
        id: 'parent-1-m0',
        type: 'pipeline-item' as any,
        status: 'completed',
        parentProcessId: 'parent-1',
        promptPreview: 'child 0',
        conversationTurns: [
            { role: 'user', content: 'hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'world', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    });

    const child2 = createProcessFixture({
        id: 'parent-1-m1',
        type: 'pipeline-item' as any,
        status: 'failed',
        parentProcessId: 'parent-1',
        promptPreview: 'child 1',
        conversationTurns: [
            { role: 'user', content: 'request', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ],
    });

    const unrelated = createProcessFixture({
        id: 'unrelated-1',
        type: 'clarification',
        status: 'completed',
        promptPreview: 'unrelated process',
    });

    store.processes.set(parent.id, parent);
    store.processes.set(child1.id, child1);
    store.processes.set(child2.id, child2);
    store.processes.set(unrelated.id, unrelated);
}

// ============================================================================
// Tests
// ============================================================================

describe('Child process API routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let bridge: QueueExecutorBridge;

    beforeAll(async () => {
        store = createMockProcessStore();
        seedProcesses(store);

        bridge = {
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
    // GET /api/processes/:id/children
    // ========================================================================

    describe('GET /api/processes/:id/children', () => {
        it('returns only child processes for the given parent', async () => {
            const resp = await request(`${baseUrl}/api/processes/parent-1/children`);
            expect(resp.status).toBe(200);

            const data = resp.json();
            expect(data.total).toBe(2);
            expect(data.children).toHaveLength(2);

            const ids = data.children.map((c: any) => c.id).sort();
            expect(ids).toEqual(['parent-1-m0', 'parent-1-m1']);
        });

        it('filters children by status', async () => {
            const resp = await request(`${baseUrl}/api/processes/parent-1/children?status=failed`);
            expect(resp.status).toBe(200);

            const data = resp.json();
            expect(data.total).toBe(1);
            expect(data.children[0].id).toBe('parent-1-m1');
        });

        it('returns empty array for non-existent parent (not 404)', async () => {
            const resp = await request(`${baseUrl}/api/processes/no-such-parent/children`);
            expect(resp.status).toBe(200);

            const data = resp.json();
            expect(data).toEqual({ children: [], total: 0 });
        });

        it('strips conversationTurns by default', async () => {
            const resp = await request(`${baseUrl}/api/processes/parent-1/children`);
            expect(resp.status).toBe(200);

            const data = resp.json();
            for (const child of data.children) {
                expect(child.conversationTurns).toBeUndefined();
            }
        });

        it('includes conversationTurns when exclude is overridden', async () => {
            // Pass exclude=none (not a valid field) to override the default exclusion
            const resp = await request(`${baseUrl}/api/processes/parent-1/children?exclude=toolCalls`);
            expect(resp.status).toBe(200);

            const data = resp.json();
            // With exclude=toolCalls, conversation data should still be present
            const completedChild = data.children.find((c: any) => c.id === 'parent-1-m0');
            expect(completedChild).toBeDefined();
            expect(completedChild.conversationTurns).toBeDefined();
        });
    });

    // ========================================================================
    // GET /api/processes?parentProcessId=X
    // ========================================================================

    describe('GET /api/processes?parentProcessId=X', () => {
        it('returns matching children via query parameter', async () => {
            const resp = await request(`${baseUrl}/api/processes?parentProcessId=parent-1`);
            expect(resp.status).toBe(200);

            const data = resp.json();
            expect(data.processes).toHaveLength(2);

            const ids = data.processes.map((p: any) => p.id).sort();
            expect(ids).toEqual(['parent-1-m0', 'parent-1-m1']);
        });
    });
});
