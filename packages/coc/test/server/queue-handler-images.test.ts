/**
 * Queue Handler Image Tests
 *
 * Tests for:
 * - validateAndParseTask promoting top-level `images` into `payload.images`
 * - serializeTask stripping inline images (returning imagesCount/hasImages)
 * - GET /api/queue/:id/images endpoint for externalized image blobs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as crypto from 'crypto';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

// 1x1 PNG data URL for testing
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

function makeTask(overrides: Record<string, any> = {}) {
    return {
        type: 'custom',
        priority: 'normal',
        displayName: 'Test task',
        payload: { data: { prompt: 'test' } },
        config: {},
        ...overrides,
    };
}

/** Write a persistence file so the server loads a pre-existing task on startup. */
function seedPersistence(dataDir: string, task: Record<string, unknown>): void {
    const repoId = crypto.createHash('sha256')
        .update(path.resolve(process.cwd()))
        .digest('hex')
        .substring(0, 16);
    const queuesDir = path.join(dataDir, 'queues');
    fs.mkdirSync(queuesDir, { recursive: true });
    const state = {
        version: 3,
        savedAt: new Date().toISOString(),
        repoRootPath: process.cwd(),
        repoId,
        pending: [task],
        history: [],
        isPaused: false,
    };
    fs.writeFileSync(
        path.join(queuesDir, `repo-${repoId}.json`),
        JSON.stringify(state),
        'utf-8',
    );
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Handler — image promotion', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-images-test-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    it('should promote top-level images array into payload.images', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [PNG_DATA_URL, PNG_DATA_URL],
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task).toBeDefined();
        // serializeTask strips inline images; verify metadata instead
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(2);
        expect(body.task.payload.hasImages).toBe(true);
    });

    it('should not set payload.images when images is an empty array', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [],
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(0);
        expect(body.task.payload.hasImages).toBe(false);
    });

    it('should not set payload.images when images field is absent', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask());

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(0);
        expect(body.task.payload.hasImages).toBe(false);
    });

    it('should filter non-string values from images array', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [123, null, PNG_DATA_URL, true],
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        // Only one valid string survived filtering; stripped by serializeTask
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(1);
        expect(body.task.payload.hasImages).toBe(true);
    });

    it('should not overwrite payload.images if already present', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [PNG_DATA_URL],
            payload: { data: { prompt: 'test' }, images: ['existing'] },
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        // payload.images existed in the original payload, stripped by serializeTask
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(1);
        expect(body.task.payload.hasImages).toBe(true);
    });
});

describe('GET /api/queue/:id/images', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-images-api-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    /** Helper: get first queued task ID from the list endpoint */
    async function getFirstQueuedTaskId(baseUrl: string): Promise<string> {
        const res = await request(`${baseUrl}/api/queue`);
        const body = JSON.parse(res.body);
        return body.queued[0].id;
    }

    it('should return images from externalized blob file', async () => {
        // Write blob file at a known path
        const blobDir = path.join(dataDir, 'blobs');
        fs.mkdirSync(blobDir, { recursive: true });
        const blobPath = path.join(blobDir, 'seeded-task.images.json');
        fs.writeFileSync(blobPath, JSON.stringify([PNG_DATA_URL, PNG_DATA_URL]), 'utf-8');

        // Pre-seed persistence with a task that has imagesFilePath
        seedPersistence(dataDir, {
            id: 'seeded-task',
            type: 'custom',
            priority: 'normal',
            status: 'queued',
            createdAt: Date.now(),
            payload: { data: { prompt: 'test' }, imagesFilePath: blobPath, imagesCount: 2 },
            config: {},
            displayName: 'Test task with images',
        });

        const srv = await startServer();
        // Restored task gets a new ID; find it via the list endpoint
        const taskId = await getFirstQueuedTaskId(srv.url);

        const imgRes = await request(`${srv.url}/api/queue/${taskId}/images`);
        expect(imgRes.status).toBe(200);
        const imgBody = JSON.parse(imgRes.body);
        expect(imgBody.images).toEqual([PNG_DATA_URL, PNG_DATA_URL]);
    });

    it('should return empty array for task without images', async () => {
        const srv = await startServer();

        const enqueueRes = await postJSON(`${srv.url}/api/queue`, makeTask());
        expect(enqueueRes.status).toBe(201);
        const taskId = JSON.parse(enqueueRes.body).task.id;

        const imgRes = await request(`${srv.url}/api/queue/${taskId}/images`);
        expect(imgRes.status).toBe(200);
        const imgBody = JSON.parse(imgRes.body);
        expect(imgBody.images).toEqual([]);
    });

    it('should return 404 for non-existent task', async () => {
        const srv = await startServer();

        const imgRes = await request(`${srv.url}/api/queue/bogus-id-12345/images`);
        expect(imgRes.status).toBe(404);
    });

    it('should return empty array when blob file is missing on disk', async () => {
        // Pre-seed with imagesFilePath pointing to a non-existent file
        seedPersistence(dataDir, {
            id: 'missing-blob-task',
            type: 'custom',
            priority: 'normal',
            status: 'queued',
            createdAt: Date.now(),
            payload: { data: { prompt: 'test' }, imagesFilePath: path.join(dataDir, 'blobs', 'nonexistent.images.json'), imagesCount: 1 },
            config: {},
            displayName: 'Test task missing blob',
        });

        const srv = await startServer();
        const taskId = await getFirstQueuedTaskId(srv.url);

        const imgRes = await request(`${srv.url}/api/queue/${taskId}/images`);
        expect(imgRes.status).toBe(200);
        const imgBody = JSON.parse(imgRes.body);
        expect(imgBody.images).toEqual([]);
    });
});

describe('Queue Handler — legacy enqueue image forwarding', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-legacy-images-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    it('should forward images from legacy enqueue body to the task', async () => {
        const srv = await startServer();

        // Legacy enqueue path: POST /api/queue/enqueue with { prompt, images }
        const res = await request(`${srv.url}/api/queue/enqueue`, {
            method: 'POST',
            body: JSON.stringify({
                prompt: 'Describe this screenshot',
                images: [PNG_DATA_URL],
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(201);
        // Verify the task was queued and images were promoted
        const listRes = await request(`${srv.url}/api/queue`);
        const listBody = JSON.parse(listRes.body);
        const task = listBody.queued[0];
        expect(task).toBeDefined();
        // serializeTask strips inline images; verify metadata
        expect(task.payload.imagesCount).toBe(1);
        expect(task.payload.hasImages).toBe(true);
    });

    it('should not include images in legacy enqueue when images is empty', async () => {
        const srv = await startServer();

        const res = await request(`${srv.url}/api/queue/enqueue`, {
            method: 'POST',
            body: JSON.stringify({
                prompt: 'No images here',
                images: [],
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(201);
        const listRes = await request(`${srv.url}/api/queue`);
        const listBody = JSON.parse(listRes.body);
        const task = listBody.queued[0];
        expect(task).toBeDefined();
        expect(task.payload.imagesCount).toBe(0);
        expect(task.payload.hasImages).toBe(false);
    });
});

describe('serializeTask — image stripping', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-serialize-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    it('should strip images array and expose imagesCount/hasImages', async () => {
        const srv = await startServer();

        const enqueueRes = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [PNG_DATA_URL, PNG_DATA_URL],
        }));
        expect(enqueueRes.status).toBe(201);
        const taskId = JSON.parse(enqueueRes.body).task.id;

        const getRes = await request(`${srv.url}/api/queue/${taskId}`);
        expect(getRes.status).toBe(200);
        const body = JSON.parse(getRes.body);
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(2);
        expect(body.task.payload.hasImages).toBe(true);
    });

    it('should not leak imagesFilePath to client', async () => {
        // Pre-seed with imagesFilePath set on the task
        seedPersistence(dataDir, {
            id: 'leak-check',
            type: 'custom',
            priority: 'normal',
            status: 'queued',
            createdAt: Date.now(),
            payload: { data: { prompt: 'test' }, imagesFilePath: '/absolute/server/path.json', imagesCount: 3 },
            config: {},
            displayName: 'Leak check task',
        });

        const srv = await startServer();
        // Get restored task ID from list
        const listRes = await request(`${srv.url}/api/queue`);
        const taskId = JSON.parse(listRes.body).queued[0].id;

        const getRes = await request(`${srv.url}/api/queue/${taskId}`);
        expect(getRes.status).toBe(200);
        const body = JSON.parse(getRes.body);
        expect(body.task.payload.imagesFilePath).toBeUndefined();
        expect(body.task.payload.hasImages).toBe(true);
        expect(body.task.payload.imagesCount).toBe(3);
    });

    it('should show hasImages false and imagesCount 0 for task without images', async () => {
        const srv = await startServer();

        const enqueueRes = await postJSON(`${srv.url}/api/queue`, makeTask());
        expect(enqueueRes.status).toBe(201);
        const taskId = JSON.parse(enqueueRes.body).task.id;

        const getRes = await request(`${srv.url}/api/queue/${taskId}`);
        expect(getRes.status).toBe(200);
        const body = JSON.parse(getRes.body);
        expect(body.task.payload.images).toBeUndefined();
        expect(body.task.payload.imagesCount).toBe(0);
        expect(body.task.payload.hasImages).toBe(false);
    });
});
