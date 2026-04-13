/**
 * SDK Session ID Lookup Tests
 *
 * Verifies GET /api/processes?sdkSessionId= uses the optimized
 * getProcessBySdkSessionId() on SqliteProcessStore instead of
 * loading all processes, and falls back to getAllProcesses().find()
 * when the method is not available.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/api-handler';
import type { QueueExecutorBridge } from '../../src/server/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

function request(
    url: string,
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
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
        req.end();
    });
}

describe('GET /api/processes?sdkSessionId — optimized lookup', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();

        const p1 = createProcessFixture({
            id: 'p1',
            sdkSessionId: 'session-aaa',
            metadata: { type: 'clarification', workspaceId: 'ws-a' },
        });
        const p2 = createProcessFixture({
            id: 'p2',
            sdkSessionId: 'session-bbb',
            metadata: { type: 'clarification', workspaceId: 'ws-a' },
        });
        store.processes.set(p1.id, p1);
        store.processes.set(p2.id, p2);

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

    it('uses getProcessBySdkSessionId when available on store', async () => {
        const getProcessBySdkSessionId = vi.fn(() => store.processes.get('p1'));
        (store as any).getProcessBySdkSessionId = getProcessBySdkSessionId;

        (store.getAllProcesses as ReturnType<typeof vi.fn>).mockClear();

        const resp = await request(`${baseUrl}/api/processes?sdkSessionId=session-aaa`);
        expect(resp.status).toBe(200);
        const body = resp.json();
        expect(body.process.id).toBe('p1');

        expect(getProcessBySdkSessionId).toHaveBeenCalledWith('session-aaa');
        expect(store.getAllProcesses).not.toHaveBeenCalled();

        delete (store as any).getProcessBySdkSessionId;
    });

    it('falls back to getAllProcesses when getProcessBySdkSessionId is absent', async () => {
        delete (store as any).getProcessBySdkSessionId;
        (store.getAllProcesses as ReturnType<typeof vi.fn>).mockClear();

        const resp = await request(`${baseUrl}/api/processes?sdkSessionId=session-bbb`);
        expect(resp.status).toBe(200);
        const body = resp.json();
        expect(body.process.id).toBe('p2');

        expect(store.getAllProcesses).toHaveBeenCalled();
    });

    it('returns 404 when sdkSessionId not found', async () => {
        const resp = await request(`${baseUrl}/api/processes?sdkSessionId=nonexistent`);
        expect(resp.status).toBe(404);
    });

    it('uses getProcessCount for total when getProcessSummaries is available', async () => {
        (store.getProcessSummaries as ReturnType<typeof vi.fn>).mockClear();
        (store.getAllProcesses as ReturnType<typeof vi.fn>).mockClear();

        const resp = await request(`${baseUrl}/api/processes?limit=10`);
        expect(resp.status).toBe(200);
        const body = resp.json();
        expect(body.total).toBe(2);

        expect(store.getProcessSummaries).toHaveBeenCalled();
    });
});
