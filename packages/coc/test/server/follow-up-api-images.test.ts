/**
 * Follow-Up API Image Attachment Tests
 *
 * Tests for POST /api/processes/:id/message with optional images parameter.
 * Verifies images are decoded and forwarded as attachments via the bridge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess, Attachment } from '@plusplusoneplusplus/pipeline-core';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

// 1x1 red PNG pixel, base64-encoded
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
                        headers: res.headers,
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

function createProcess(id: string): AIProcess {
    return {
        id,
        type: 'clarification',
        promptPreview: 'test',
        fullPrompt: 'test prompt',
        status: 'completed',
        startTime: new Date(),
        sdkSessionId: `sess-${id}`,
        conversationTurns: [],
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/message — image attachments', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;
    let mockExecuteFollowUp: ReturnType<typeof vi.fn>;
    let mockBridge: QueueExecutorBridge;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-up-images-test-'));
        store = new FileProcessStore({ dataDir });

        mockExecuteFollowUp = vi.fn().mockResolvedValue(undefined);
        mockBridge = {
            executeFollowUp: mockExecuteFollowUp,
            isSessionAlive: vi.fn().mockResolvedValue(true),
        };

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

    it('should forward attachments when images array contains a valid data URL', async () => {
        await store.addProcess(createProcess('img-1'));

        const res = await postJSON(`${baseUrl}/api/processes/img-1/message`, {
            content: 'Look at this image',
            images: [PNG_DATA_URL],
        });

        expect(res.status).toBe(202);
        expect(mockExecuteFollowUp).toHaveBeenCalledOnce();

        const [id, message, attachments] = mockExecuteFollowUp.mock.calls[0];
        expect(id).toBe('img-1');
        expect(message).toBe('Look at this image');
        expect(attachments).toBeDefined();
        expect(attachments).toHaveLength(1);
        expect(attachments[0].type).toBe('file');
    });

    it('should pass undefined attachments when no images field is present', async () => {
        await store.addProcess(createProcess('img-2'));

        const res = await postJSON(`${baseUrl}/api/processes/img-2/message`, {
            content: 'No images here',
        });

        expect(res.status).toBe(202);
        expect(mockExecuteFollowUp).toHaveBeenCalledOnce();

        const [, , attachments] = mockExecuteFollowUp.mock.calls[0];
        expect(attachments).toBeUndefined();
    });

    it('should pass undefined attachments when images is an empty array', async () => {
        await store.addProcess(createProcess('img-3'));

        const res = await postJSON(`${baseUrl}/api/processes/img-3/message`, {
            content: 'Empty images',
            images: [],
        });

        expect(res.status).toBe(202);
        expect(mockExecuteFollowUp).toHaveBeenCalledOnce();

        const [, , attachments] = mockExecuteFollowUp.mock.calls[0];
        expect(attachments).toBeUndefined();
    });

    it('should pass undefined attachments when all images are invalid', async () => {
        await store.addProcess(createProcess('img-4'));

        const res = await postJSON(`${baseUrl}/api/processes/img-4/message`, {
            content: 'Bad images',
            images: ['not-a-data-url', 'also-invalid'],
        });

        expect(res.status).toBe(202);
        expect(mockExecuteFollowUp).toHaveBeenCalledOnce();

        const [, , attachments] = mockExecuteFollowUp.mock.calls[0];
        expect(attachments).toBeUndefined();
    });

    it('should filter out non-string values from images array', async () => {
        await store.addProcess(createProcess('img-5'));

        const res = await postJSON(`${baseUrl}/api/processes/img-5/message`, {
            content: 'Mixed types',
            images: [123, null, PNG_DATA_URL, true],
        });

        expect(res.status).toBe(202);
        expect(mockExecuteFollowUp).toHaveBeenCalledOnce();

        const [, , attachments] = mockExecuteFollowUp.mock.calls[0];
        expect(attachments).toBeDefined();
        expect(attachments).toHaveLength(1);
    });
});
