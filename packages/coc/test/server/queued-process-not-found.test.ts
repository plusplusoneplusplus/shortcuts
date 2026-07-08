/**
 * Queued Process Not Found — Synthetic Process Response Tests
 *
 * Verifies that GET /api/processes/:id and GET /api/processes/:id/output
 * return synthetic responses for queued tasks that don't yet have a process record,
 * rather than returning 404.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { QueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';

// ============================================================================
// Helpers
// ============================================================================

function getJSON(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        http.get(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            }
        ).on('error', reject);
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Queued process synthetic response', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;

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

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queued-process-'));
        store = new FileProcessStore({ dataDir });
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    describe('GET /api/processes/:id', () => {
        it('should return 200 with synthetic process for a queued task', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue({
                    id: 'task-abc',
                    type: 'chat',
                    status: 'queued',
                    priority: 'normal',
                    createdAt: 1700000000000,
                    payload: { prompt: 'Hello world' },
                    config: {},
                    displayName: 'Hello world',
                    folderPath: '/tmp/repo',
                }),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_task-abc`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.process.id).toBe('queue_task-abc');
            expect(body.process.status).toBe('queued');
            expect(body.process.type).toBe('chat');
            expect(body.process.title).toBe('Hello world');
            expect(body.process.workingDirectory).toBe('/tmp/repo');
            expect(body.children).toEqual([]);
            expect(body.total).toBe(0);
        });

        it('should return 404 for queue_ prefixed ID with no matching task', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue(undefined),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_nonexistent`);
            expect(res.status).toBe(404);
        });

        it('should return 404 for non-queue process ID that does not exist', async () => {
            const mockBridge = createMockBridge();
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/unknown-id`);
            expect(res.status).toBe(404);
        });

        it('should use workingDirectory from payload when folderPath is absent', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue({
                    id: 'task-wd',
                    type: 'chat',
                    status: 'queued',
                    priority: 'normal',
                    createdAt: 1700000000000,
                    payload: { prompt: 'test', workingDirectory: '/custom/path' },
                    config: {},
                }),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_task-wd`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.process.workingDirectory).toBe('/custom/path');
        });

        it('should carry the chat mode in synthetic metadata so a fresh autopilot chat does not fall back to ask', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue({
                    id: 'task-autopilot',
                    type: 'chat',
                    status: 'queued',
                    priority: 'normal',
                    createdAt: 1700000000000,
                    payload: { kind: 'chat', mode: 'autopilot', prompt: 'do it', workspaceId: 'ws-1' },
                    config: {},
                }),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_task-autopilot`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.process.metadata.mode).toBe('autopilot');
            expect(body.process.metadata.workspaceId).toBe('ws-1');
            expect(body.process.metadata.queueTaskId).toBe('task-autopilot');
        });

        it('should omit an invalid payload mode from synthetic metadata', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue({
                    id: 'task-badmode',
                    type: 'chat',
                    status: 'queued',
                    priority: 'normal',
                    createdAt: 1700000000000,
                    payload: { kind: 'chat', mode: 'bogus', prompt: 'hi' },
                    config: {},
                }),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_task-badmode`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.process.metadata.mode).toBeUndefined();
        });
    });

    describe('GET /api/processes/:id/output', () => {
        it('should return 200 with empty content for a queued task', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue({
                    id: 'task-out',
                    type: 'chat',
                    status: 'queued',
                    priority: 'normal',
                    createdAt: 1700000000000,
                    payload: {},
                    config: {},
                }),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_task-out/output`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.content).toBe('');
            expect(body.format).toBe('markdown');
        });

        it('should return 404 for queue_ prefixed ID with no matching task', async () => {
            const mockBridge = createMockBridge({
                getTask: vi.fn().mockReturnValue(undefined),
            });
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/queue_nonexistent/output`);
            expect(res.status).toBe(404);
        });

        it('should return 404 for non-queue process ID that does not exist', async () => {
            const mockBridge = createMockBridge();
            await startWithBridge(mockBridge);

            const res = await getJSON(`${baseUrl}/api/processes/unknown-id/output`);
            expect(res.status).toBe(404);
        });
    });
});
