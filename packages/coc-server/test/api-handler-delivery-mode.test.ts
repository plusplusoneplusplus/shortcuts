/**
 * API Handler — deliveryMode Tests
 *
 * Verifies that POST /api/processes/:id/message accepts, validates, and
 * defaults the `deliveryMode` field, and emits `message-queued` SSE events.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { QueueExecutorBridge } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore, createCompletedProcessWithSession } from './helpers/mock-process-store';
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

describe('POST /api/processes/:id/message — deliveryMode', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let bridge: QueueExecutorBridge;

    beforeAll(async () => {
        store = createMockProcessStore({
            initialProcesses: [
                createCompletedProcessWithSession('proc-dm', 'session-1'),
            ],
        });

        bridge = {
            executeFollowUp: vi.fn(async () => {}),
            isSessionAlive: vi.fn(async () => true),
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

    beforeEach(() => {
        // Reset process state for each test
        store.processes.set('proc-dm', createCompletedProcessWithSession('proc-dm', 'session-1'));
        vi.mocked(store.emitProcessEvent).mockClear();
        vi.mocked(bridge.executeFollowUp).mockClear();
    });

    it('defaults to enqueue when deliveryMode is absent', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'hello' }),
        });

        expect(resp.status).toBe(202);
        // Bridge should receive 'enqueue' as deliveryMode
        expect(bridge.executeFollowUp).toHaveBeenCalledWith(
            'proc-dm',
            'hello',
            undefined,
            undefined,
            'enqueue',
        );
    });

    it('passes deliveryMode: immediate to bridge', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'steer me', deliveryMode: 'immediate' }),
        });

        expect(resp.status).toBe(202);
        expect(bridge.executeFollowUp).toHaveBeenCalledWith(
            'proc-dm',
            'steer me',
            undefined,
            undefined,
            'immediate',
        );
    });

    it('passes deliveryMode: enqueue to bridge explicitly', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'queue me', deliveryMode: 'enqueue' }),
        });

        expect(resp.status).toBe(202);
        expect(bridge.executeFollowUp).toHaveBeenCalledWith(
            'proc-dm',
            'queue me',
            undefined,
            undefined,
            'enqueue',
        );
    });

    it('returns 400 for invalid deliveryMode', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'bad mode', deliveryMode: 'invalid' }),
        });

        expect(resp.status).toBe(400);
        const body = resp.json();
        expect(body.error).toMatch(/deliveryMode/i);
    });

    it('returns 400 for numeric deliveryMode', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'bad type', deliveryMode: 42 }),
        });

        expect(resp.status).toBe(400);
    });

    it('emits message-queued SSE event with correct payload for enqueue', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'queued msg' }),
        });

        expect(resp.status).toBe(202);
        const { turnIndex } = resp.json();

        // message-queued event should have been emitted via store.emitProcessEvent
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-dm', expect.objectContaining({
            type: 'message-queued',
            turnIndex,
            deliveryMode: 'enqueue',
            queuePosition: 1,
        }));
    });

    it('emits message-queued SSE event with queuePosition 0 for immediate', async () => {
        const resp = await request(`${baseUrl}/api/processes/proc-dm/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'immediate msg', deliveryMode: 'immediate' }),
        });

        expect(resp.status).toBe(202);
        const { turnIndex } = resp.json();

        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-dm', expect.objectContaining({
            type: 'message-queued',
            turnIndex,
            deliveryMode: 'immediate',
            queuePosition: 0,
        }));
    });
});
