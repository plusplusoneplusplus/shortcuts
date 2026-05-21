/**
 * Buffered Follow-Up Attachments — Regression Test
 *
 * Verifies that when a follow-up message with attachments (image/file) is sent
 * while the previous task is still running, the buffered pendingMessage and
 * the eventual drained queued task both preserve all attachment execution
 * metadata (attachments, imageTempDir, images, fileAttachmentMeta, mode,
 * model, and selected skill context).
 *
 * Bug: prior to the fix, drainPendingMessages() emitted a queued chat task
 * containing only `prompt` (and `mode`), so attached screenshots/files never
 * reached the AI executor for buffered follow-ups.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockBridge, createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

// Mock SDK service so CLITaskExecutor construction doesn't probe the real one.
const sdkMocks = createMockSDKService();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function postJSON(url: string, data: unknown = {}): Promise<{ status: number; body: string }> {
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
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// 1×1 transparent PNG data URL — small but valid image payload.
const TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// ---------------------------------------------------------------------------
// API buffering — ensures pendingMessages carries attachment metadata
// ---------------------------------------------------------------------------

describe('Buffered follow-up attachments — POST /api/processes/:id/message', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffered-attach-'));
        store = new FileProcessStore({ dataDir });
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('buffers attachments, imageTempDir, images, fileAttachmentMeta, mode, model, and skillNames on the pending message', async () => {
        const bridge = createMockBridge();
        (bridge as any).findTaskByProcessId = vi.fn().mockReturnValue({
            id: 'task-1',
            type: 'chat',
            status: 'running',
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);
        const handler = createRequestHandler({ routes, spaHtml: generateDashboardHtml(), store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        baseUrl = `http://localhost:${(server!.address() as { port: number }).port}`;

        const proc: AIProcess = {
            id: 'proc-buffer-attach',
            type: 'clarification',
            promptPreview: 'first',
            fullPrompt: 'first',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-buffer-attach',
            conversationTurns: [
                { role: 'user', content: 'First message', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        };
        await store.addProcess(proc);

        const res = await postJSON(`${baseUrl}/api/processes/proc-buffer-attach/message`, {
            content: 'attached',
            mode: 'autopilot',
            model: 'gpt-5-mini',
            skillNames: ['impl'],
            attachments: [
                {
                    name: 'screenshot.png',
                    mimeType: 'image/png',
                    size: 95,
                    dataUrl: TINY_PNG_DATA_URL,
                },
            ],
        });

        expect(res.status).toBe(202);

        const updated = await store.getProcess('proc-buffer-attach');
        expect(updated?.pendingMessages).toHaveLength(1);
        const pending = updated!.pendingMessages![0];
        expect(pending.content).toBe('attached');
        expect(pending.mode).toBe('autopilot');
        expect(pending.model).toBe('gpt-5-mini');
        expect(pending.skillNames).toEqual(['impl']);
        expect(pending.images).toBeDefined();
        expect(pending.images!.length).toBe(1);
        expect(pending.images![0]).toContain('data:image/png;base64,');
        expect(pending.attachments).toBeDefined();
        expect(pending.attachments!.length).toBe(1);
        expect(pending.imageTempDir).toBeDefined();
        expect(typeof pending.imageTempDir).toBe('string');
        expect(pending.fileAttachmentMeta).toBeDefined();
        expect(pending.fileAttachmentMeta![0]).toMatchObject({
            name: 'screenshot.png',
            mimeType: 'image/png',
            category: 'image',
        });

        // Cleanup the temp dir created by the route.
        if (pending.imageTempDir && fs.existsSync(pending.imageTempDir)) {
            fs.rmSync(pending.imageTempDir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// drainPendingMessages — ensures the queued task carries attachment metadata
// ---------------------------------------------------------------------------

describe('drainPendingMessages copies attachment metadata into the follow-up task', () => {
    it('emits a queued task whose payload preserves attachments, imageTempDir, images, fileAttachmentMeta, mode, model, and skill context', async () => {
        const store = createMockProcessStore();
        const queueManager = new TaskQueueManager();
        const executor = new CLITaskExecutor(store);
        executor.setQueueManager(queueManager);

        const fakeAttachment = { type: 'file' as const, path: '/tmp/coc-attach-x/screenshot.png', displayName: 'screenshot.png' };
        const proc: AIProcess = {
            id: 'proc-drain',
            type: 'clarification',
            promptPreview: 'first',
            fullPrompt: 'first',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-drain',
            conversationTurns: [
                { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'response', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
            pendingMessages: [
                {
                    id: 'pending-1',
                    content: 'attached',
                    displayContent: '/impl attached',
                    images: [TINY_PNG_DATA_URL],
                    attachments: [fakeAttachment],
                    imageTempDir: '/tmp/coc-attach-x',
                    fileAttachmentMeta: [
                        { name: 'screenshot.png', mimeType: 'image/png', size: 95, category: 'image' },
                    ],
                    skillNames: ['impl'],
                    mode: 'autopilot',
                    model: 'gpt-5-mini',
                    createdAt: new Date().toISOString(),
                },
            ],
        };
        await store.addProcess(proc);

        await (executor as any).drainPendingMessages('proc-drain', 'task-original');

        const queued = queueManager.getQueued();
        expect(queued).toHaveLength(1);
        const task = queued[0] as QueuedTask;
        const payload = task.payload as any;

        expect(payload.kind).toBe('chat');
        expect(payload.processId).toBe('proc-drain');
        expect(payload.prompt).toBe('attached');
        expect(payload.mode).toBe('autopilot');
        expect(payload.model).toBe('gpt-5-mini');
        expect(payload.attachments).toEqual([fakeAttachment]);
        expect(payload.imageTempDir).toBe('/tmp/coc-attach-x');
        expect(payload.images).toEqual([TINY_PNG_DATA_URL]);
        expect(payload.fileAttachmentMeta).toEqual([
            { name: 'screenshot.png', mimeType: 'image/png', size: 95, category: 'image' },
        ]);
        expect(payload.context?.skills).toEqual(['impl']);

        // Pending list is drained after successful enqueue.
        const after = await store.getProcess('proc-drain');
        expect(after?.pendingMessages ?? []).toHaveLength(0);
    });
});
