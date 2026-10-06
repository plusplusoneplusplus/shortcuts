/**
 * Tests that POST /api/processes/:id/cancel:
 * 1. Calls bridge.cancelProcess to abort the live AI session
 * 2. Surfaces unavailable cancellation and abort errors without false success
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';

// ============================================================================
// Helpers
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

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/cancel — bridge.cancelProcess integration', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;
    let mockBridge: QueueExecutorBridge;

    async function startWithBridge(bridge: QueueExecutorBridge): Promise<void> {
        const routes: Route[] = [];
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

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-process-api-'));
        store = new FileProcessStore({ dataDir });
        mockBridge = createMockBridge();
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function addRunningProcess(id: string): Promise<void> {
        const proc: AIProcess = {
            id,
            type: 'queue-ai-clarification',
            promptPreview: 'test',
            fullPrompt: 'test prompt',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: `sdk-${id}`,
        };
        await store.addProcess(proc);
    }

    it('should call bridge.cancelProcess with the process id', async () => {
        await startWithBridge(mockBridge);
        await addRunningProcess('run-1');

        const res = await postJSON(`${baseUrl}/api/processes/run-1/cancel`);
        expect(res.status).toBe(200);

        expect(mockBridge.cancelProcess).toHaveBeenCalledWith('run-1');
        const body = JSON.parse(res.body);
        expect(body.process.status).toBe('cancelled');
    });

    it('should set cancelling status before awaiting abort', async () => {
        let intermediateStatus: string | undefined;
        const slowBridge = createMockBridge({
            cancelProcess: vi.fn(async (id: string) => {
                const proc = await store.getProcess(id);
                intermediateStatus = proc?.status;
            }),
        });
        await startWithBridge(slowBridge);
        await addRunningProcess('run-slow');

        const res = await postJSON(`${baseUrl}/api/processes/run-slow/cancel`);
        expect(res.status).toBe(200);
        expect(intermediateStatus).toBe('cancelling');
        const body = JSON.parse(res.body);
        expect(body.process.status).toBe('cancelled');
    });

    it('surfaces abort failure and retains cancelling status', async () => {
        const failingBridge = createMockBridge({
            cancelProcess: vi.fn().mockRejectedValue(new Error('abort failed')),
        });
        await startWithBridge(failingBridge);
        await addRunningProcess('run-err');

        const res = await postJSON(`${baseUrl}/api/processes/run-err/cancel`);
        expect(res.status).toBe(500);
        expect(JSON.parse(res.body)).toHaveProperty('error');
        expect((await store.getProcess('run-err'))?.status).toBe('cancelling');
    });

    it('reports unavailable cancellation without changing process status', async () => {
        const noCancelBridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            isSessionAlive: vi.fn().mockResolvedValue(true),
        };
        await startWithBridge(noCancelBridge);
        await addRunningProcess('run-nocancel');

        const res = await postJSON(`${baseUrl}/api/processes/run-nocancel/cancel`);
        expect(res.status).toBe(503);
        expect(JSON.parse(res.body).code).toBe('CANCEL_UNAVAILABLE');
        expect((await store.getProcess('run-nocancel'))?.status).toBe('running');
    });

    it('retains REST terminal conflict behavior', async () => {
        await startWithBridge(mockBridge);
        await addRunningProcess('terminal');
        await store.updateProcess('terminal', { status: 'completed' });
        const res = await postJSON(`${baseUrl}/api/processes/terminal/cancel`);
        expect(res.status).toBe(409);
        expect(mockBridge.cancelProcess).not.toHaveBeenCalled();
    });
});
