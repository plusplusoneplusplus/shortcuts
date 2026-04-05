/**
 * Paste Externalized Metadata Tests
 *
 * Tests that the follow-up message API correctly sets pasteExternalized
 * on conversation turns and includes it in the 202 response when the
 * message content exceeds the paste threshold.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, PASTE_THRESHOLD } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function makeProc(id: string): AIProcess {
    return {
        id,
        type: 'clarification',
        promptPreview: 'test',
        fullPrompt: 'test prompt',
        status: 'completed',
        startTime: new Date(),
        sdkSessionId: `sess-${id}`,
        conversationTurns: [
            { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('pasteExternalized metadata in follow-up API', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-ext-api-test-'));
        store = new FileProcessStore({ dataDir });

        const mockBridge = createMockBridge();
        const routes: Route[] = [];
        registerApiRoutes(routes, store, mockBridge);

        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);

        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });

        const address = server.address() as { port: number };
        baseUrl = `http://localhost:${address.port}`;
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => {
                server!.close(() => resolve());
            });
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns pasteExternalized: true in 202 response for large messages', async () => {
        const proc = makeProc('proc-large');
        await store.addProcess(proc);

        const largeContent = 'x'.repeat(PASTE_THRESHOLD + 100);
        const res = await postJSON(`${baseUrl}/api/processes/proc-large/message`, {
            content: largeContent,
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.pasteExternalized).toBe(true);
    });

    it('does not include pasteExternalized for small messages', async () => {
        const proc = makeProc('proc-small');
        await store.addProcess(proc);

        const res = await postJSON(`${baseUrl}/api/processes/proc-small/message`, {
            content: 'A short message',
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.pasteExternalized).toBeUndefined();
    });

    it('sets pasteExternalized on the persisted conversation turn for large messages', async () => {
        const proc = makeProc('proc-persist');
        await store.addProcess(proc);

        const largeContent = 'y'.repeat(PASTE_THRESHOLD + 500);
        await postJSON(`${baseUrl}/api/processes/proc-persist/message`, {
            content: largeContent,
        });

        const updated = await store.getProcess('proc-persist');
        const lastUserTurn = updated?.conversationTurns?.find(
            t => t.role === 'user' && t.turnIndex === 2,
        );
        expect(lastUserTurn).toBeTruthy();
        expect(lastUserTurn!.pasteExternalized).toBe(true);
    });

    it('does not set pasteExternalized on persisted turn for small messages', async () => {
        const proc = makeProc('proc-noflag');
        await store.addProcess(proc);

        await postJSON(`${baseUrl}/api/processes/proc-noflag/message`, {
            content: 'Short question',
        });

        const updated = await store.getProcess('proc-noflag');
        const lastUserTurn = updated?.conversationTurns?.find(
            t => t.role === 'user' && t.turnIndex === 2,
        );
        expect(lastUserTurn).toBeTruthy();
        expect(lastUserTurn!.pasteExternalized).toBeUndefined();
    });

    it('sets pasteExternalized at exactly threshold + 1', async () => {
        const proc = makeProc('proc-boundary');
        await store.addProcess(proc);

        const content = 'z'.repeat(PASTE_THRESHOLD + 1);
        const res = await postJSON(`${baseUrl}/api/processes/proc-boundary/message`, {
            content,
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.pasteExternalized).toBe(true);
    });

    it('does not set pasteExternalized at exactly the threshold', async () => {
        const proc = makeProc('proc-exact');
        await store.addProcess(proc);

        const content = 'z'.repeat(PASTE_THRESHOLD);
        const res = await postJSON(`${baseUrl}/api/processes/proc-exact/message`, {
            content,
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.pasteExternalized).toBeUndefined();
    });
});
