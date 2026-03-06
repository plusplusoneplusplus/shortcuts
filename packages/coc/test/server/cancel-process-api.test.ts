/**
 * Cancel Process API Tests
 *
 * Tests that POST /api/processes/:id/cancel:
 * 1. Calls bridge.cancelProcess to abort the live AI session
 * 2. Still works when bridge has no cancelProcess (backwards compat)
 * 3. Does not propagate bridge errors to the HTTP response
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue-executor-bridge';
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

        // Allow fire-and-forget to settle
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(mockBridge.cancelProcess).toHaveBeenCalledWith('run-1');
    });

    it('should still return 200 even if bridge.cancelProcess rejects', async () => {
        const failingBridge = createMockBridge({
            cancelProcess: vi.fn().mockRejectedValue(new Error('abort failed')),
        });
        await startWithBridge(failingBridge);
        await addRunningProcess('run-err');

        const res = await postJSON(`${baseUrl}/api/processes/run-err/cancel`);
        // HTTP response should not be affected by the fire-and-forget rejection
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.process.status).toBe('cancelled');
    });

    it('should return 200 when bridge has no cancelProcess method', async () => {
        const noCancelBridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            isSessionAlive: vi.fn().mockResolvedValue(true),
        };
        await startWithBridge(noCancelBridge);
        await addRunningProcess('run-nocancel');

        const res = await postJSON(`${baseUrl}/api/processes/run-nocancel/cancel`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.process.status).toBe('cancelled');
    });
});
