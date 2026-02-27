/**
 * Queue Handler Image Promotion Tests
 *
 * Tests that validateAndParseTask promotes top-level `images` into
 * `payload.images` for use by executeWithAI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
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
        expect(body.task.payload.images).toBeDefined();
        expect(body.task.payload.images).toHaveLength(2);
        expect(body.task.payload.images[0]).toBe(PNG_DATA_URL);
    });

    it('should not set payload.images when images is an empty array', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [],
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task.payload.images).toBeUndefined();
    });

    it('should not set payload.images when images field is absent', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask());

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task.payload.images).toBeUndefined();
    });

    it('should filter non-string values from images array', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [123, null, PNG_DATA_URL, true],
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task.payload.images).toEqual([PNG_DATA_URL]);
    });

    it('should not overwrite payload.images if already present', async () => {
        const srv = await startServer();

        const res = await postJSON(`${srv.url}/api/queue`, makeTask({
            images: [PNG_DATA_URL],
            payload: { data: { prompt: 'test' }, images: ['existing'] },
        }));

        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.task.payload.images).toEqual(['existing']);
    });
});
