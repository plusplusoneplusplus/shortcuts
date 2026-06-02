/**
 * Pending Messages API Tests
 *
 * Tests that:
 * 1. POST /api/processes/:id/pending-messages appends a message and returns 201
 * 2. DELETE /api/processes/:id/pending-messages/:msgId removes the message and returns 204
 * 3. 404 for non-existent process
 * 4. 400 for missing content
 * 5. Messages persist on the process record
 * 6. DELETE is idempotent (missing msgId still returns 204)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import { createMockBridge } from '../helpers/mock-sdk-service';
import type { Route } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// HTTP Helpers
// ============================================================================

function postJSON(
    url: string,
    data: unknown = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const body = JSON.stringify(data);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function httpDelete(
    url: string,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'DELETE',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('error', reject);
        req.end();
    });
}

function httpGet(
    url: string,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('error', reject);
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Pending Messages API', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;

    async function startServer(): Promise<void> {
        const routes: Route[] = [];
        const bridge = createMockBridge();
        registerApiRoutes(routes, store, bridge);
        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        const address = server!.address() as { port: number };
        baseUrl = `http://localhost:${address.port}`;
    }

    async function addProcess(id: string, status: 'running' | 'completed' = 'running'): Promise<void> {
        const proc: AIProcess = {
            id,
            type: 'queue-ai-clarification',
            promptPreview: 'test prompt',
            fullPrompt: 'test prompt full',
            status,
            startTime: new Date(),
            sdkSessionId: `sdk-${id}`,
        };
        await store.addProcess(proc);
    }

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-messages-api-'));
        store = new FileProcessStore({ dataDir });
        await startServer();
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // POST /api/processes/:id/pending-messages
    // ========================================================================

    describe('POST /api/processes/:id/pending-messages', () => {
        it('appends a pending message and returns 201', async () => {
            await addProcess('proc-1');

            const res = await postJSON(`${baseUrl}/api/processes/proc-1/pending-messages`, {
                content: 'Fix the bug',
                mode: 'ask',
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.message).toBeDefined();
            expect(body.message.id).toBeTruthy();
            expect(body.message.content).toBe('Fix the bug');
            expect(body.message.mode).toBe('ask');
            expect(body.message.createdAt).toBeTruthy();
        });

        it('persists the message on the process record', async () => {
            await addProcess('proc-2');

            await postJSON(`${baseUrl}/api/processes/proc-2/pending-messages`, {
                content: 'Message 1',
            });
            await postJSON(`${baseUrl}/api/processes/proc-2/pending-messages`, {
                content: 'Message 2',
                mode: 'plan',
            });

            const proc = await store.getProcess('proc-2');
            expect(proc?.pendingMessages).toHaveLength(2);
            expect(proc?.pendingMessages?.[0].content).toBe('Message 1');
            expect(proc?.pendingMessages?.[1].content).toBe('Message 2');
            expect(proc?.pendingMessages?.[1].mode).toBe('ask');
        });

        it('returns 404 for non-existent process', async () => {
            const res = await postJSON(`${baseUrl}/api/processes/nonexistent/pending-messages`, {
                content: 'test',
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 for missing content', async () => {
            await addProcess('proc-3');

            const res = await postJSON(`${baseUrl}/api/processes/proc-3/pending-messages`, {
                mode: 'ask',
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 for empty content', async () => {
            await addProcess('proc-4');

            const res = await postJSON(`${baseUrl}/api/processes/proc-4/pending-messages`, {
                content: '',
            });
            expect(res.status).toBe(400);
        });

        it('works without mode field', async () => {
            await addProcess('proc-5');

            const res = await postJSON(`${baseUrl}/api/processes/proc-5/pending-messages`, {
                content: 'No mode specified',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.message.mode).toBeUndefined();
        });

        it('works on completed processes', async () => {
            await addProcess('proc-done', 'completed');

            const res = await postJSON(`${baseUrl}/api/processes/proc-done/pending-messages`, {
                content: 'Message for completed process',
            });
            expect(res.status).toBe(201);
        });
    });

    // ========================================================================
    // DELETE /api/processes/:id/pending-messages/:msgId
    // ========================================================================

    describe('DELETE /api/processes/:id/pending-messages/:msgId', () => {
        it('removes a pending message and returns 204', async () => {
            await addProcess('proc-del-1');

            const postRes = await postJSON(`${baseUrl}/api/processes/proc-del-1/pending-messages`, {
                content: 'To be removed',
            });
            const { message } = JSON.parse(postRes.body);

            const delRes = await httpDelete(`${baseUrl}/api/processes/proc-del-1/pending-messages/${message.id}`);
            expect(delRes.status).toBe(204);

            const proc = await store.getProcess('proc-del-1');
            expect(proc?.pendingMessages).toHaveLength(0);
        });

        it('removes only the targeted message', async () => {
            await addProcess('proc-del-2');

            const res1 = await postJSON(`${baseUrl}/api/processes/proc-del-2/pending-messages`, {
                content: 'Keep this',
            });
            const res2 = await postJSON(`${baseUrl}/api/processes/proc-del-2/pending-messages`, {
                content: 'Remove this',
            });
            const msg2 = JSON.parse(res2.body).message;

            await httpDelete(`${baseUrl}/api/processes/proc-del-2/pending-messages/${msg2.id}`);

            const proc = await store.getProcess('proc-del-2');
            expect(proc?.pendingMessages).toHaveLength(1);
            expect(proc?.pendingMessages?.[0].content).toBe('Keep this');
        });

        it('returns 204 even if msgId does not exist (idempotent)', async () => {
            await addProcess('proc-del-3');

            const delRes = await httpDelete(`${baseUrl}/api/processes/proc-del-3/pending-messages/nonexistent-id`);
            expect(delRes.status).toBe(204);
        });

        it('returns 404 for non-existent process', async () => {
            const delRes = await httpDelete(`${baseUrl}/api/processes/nonexistent/pending-messages/some-id`);
            expect(delRes.status).toBe(404);
        });
    });

    // ========================================================================
    // End-to-end: pending messages visible via GET /api/processes/:id
    // ========================================================================

    describe('Pending messages in process detail', () => {
        it('pendingMessages appear in GET /api/processes/:id response', async () => {
            await addProcess('proc-e2e');

            await postJSON(`${baseUrl}/api/processes/proc-e2e/pending-messages`, {
                content: 'Queued while busy',
                mode: 'autopilot',
            });

            const getRes = await httpGet(`${baseUrl}/api/processes/proc-e2e`);
            expect(getRes.status).toBe(200);
            const body = JSON.parse(getRes.body);
            expect(body.process.pendingMessages).toHaveLength(1);
            expect(body.process.pendingMessages[0].content).toBe('Queued while busy');
            expect(body.process.pendingMessages[0].mode).toBe('autopilot');
        });

        it('empty pendingMessages when none queued', async () => {
            await addProcess('proc-empty');

            const getRes = await httpGet(`${baseUrl}/api/processes/proc-empty`);
            const body = JSON.parse(getRes.body);
            // Should be undefined (not set) on processes without pending messages
            expect(body.process.pendingMessages).toBeUndefined();
        });
    });
});
