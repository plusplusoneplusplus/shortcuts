/**
 * Tests for memory-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerMemoryRoutes } from '../src/memory/memory-routes';
import type { Route } from '../src/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let server: http.Server;
let baseUrl: string;

function makeServer(dataDir: string): http.Server {
    const routes: Route[] = [];
    registerMemoryRoutes(routes, dataDir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiGet(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json();
    return { status: res.status, body };
}

async function apiPut(path: string, data: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    return { status: res.status, body };
}

async function apiPost(path: string, data: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    return { status: res.status, body };
}

async function apiPatch(path: string, data: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    return { status: res.status, body };
}

async function apiDelete(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
    const body = await res.json();
    return { status: res.status, body };
}

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-routes-test-'));
    server = makeServer(tmpDir);
    await startServer();
});

afterEach(async () => {
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/memory/config', () => {
    it('returns default config', async () => {
        const { status, body } = await apiGet('/api/memory/config');
        expect(status).toBe(200);
        expect(body.backend).toBe('file');
        expect(typeof body.storageDir).toBe('string');
        expect(typeof body.maxEntries).toBe('number');
        expect(typeof body.ttlDays).toBe('number');
        expect(typeof body.autoInject).toBe('boolean');
    });
});

describe('PUT /api/memory/config', () => {
    it('saves and returns updated config', async () => {
        const { status, body } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'custom'),
            backend: 'sqlite',
            maxEntries: 500,
            ttlDays: 60,
            autoInject: true,
        });
        expect(status).toBe(200);
        expect(body.backend).toBe('sqlite');
        expect(body.maxEntries).toBe(500);
        expect(body.autoInject).toBe(true);
    });

    it('persists config so GET returns updated values', async () => {
        await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'saved'),
            backend: 'vector',
            maxEntries: 200,
            ttlDays: 14,
            autoInject: false,
        });
        const { body } = await apiGet('/api/memory/config');
        expect(body.backend).toBe('vector');
        expect(body.maxEntries).toBe(200);
    });
});

describe('POST /api/memory/entries', () => {
    it('creates an entry and returns 201', async () => {
        // Use the configured storageDir (default from tmpDir)
        // First set storageDir to a sub-folder we control
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', {
            storageDir,
            backend: 'file',
            maxEntries: 100,
            ttlDays: 0,
            autoInject: false,
        });

        const { status, body } = await apiPost('/api/memory/entries', {
            content: 'Test memory',
            tags: ['tag1'],
            source: 'test',
        });
        expect(status).toBe(201);
        expect(body.id).toBeTruthy();
        expect(body.content).toBe('Test memory');
        expect(body.tags).toEqual(['tag1']);
    });

    it('returns 400 when content is missing', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiPost('/api/memory/entries', { tags: [] });
        expect(status).toBe(400);
    });
});

describe('GET /api/memory/entries', () => {
    it('returns paginated list', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        await apiPost('/api/memory/entries', { content: 'entry1', tags: [], source: 'manual' });
        await apiPost('/api/memory/entries', { content: 'entry2', tags: [], source: 'manual' });

        const { status, body } = await apiGet('/api/memory/entries');
        expect(status).toBe(200);
        expect(body.total).toBe(2);
        expect(Array.isArray(body.entries)).toBe(true);
    });
});

describe('GET /api/memory/entries/:id', () => {
    it('returns full entry by id', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { body: created } = await apiPost('/api/memory/entries', {
            content: 'Full content here',
            tags: ['a'],
            source: 'test',
        });
        const { status, body } = await apiGet(`/api/memory/entries/${created.id}`);
        expect(status).toBe(200);
        expect(body.content).toBe('Full content here');
    });

    it('returns 404 for unknown id', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiGet('/api/memory/entries/nonexistent');
        expect(status).toBe(404);
    });
});

describe('PATCH /api/memory/entries/:id', () => {
    it('updates tags', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { body: created } = await apiPost('/api/memory/entries', {
            content: 'patch me',
            tags: ['old'],
            source: 'manual',
        });
        const { status, body } = await apiPatch(`/api/memory/entries/${created.id}`, {
            tags: ['new', 'updated'],
        });
        expect(status).toBe(200);
        expect(body.tags).toEqual(['new', 'updated']);
    });

    it('returns 404 for unknown id', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiPatch('/api/memory/entries/nonexistent', { tags: [] });
        expect(status).toBe(404);
    });
});

describe('DELETE /api/memory/entries/:id', () => {
    it('deletes an entry', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { body: created } = await apiPost('/api/memory/entries', {
            content: 'delete me',
            tags: [],
            source: 'manual',
        });
        const { status, body } = await apiDelete(`/api/memory/entries/${created.id}`);
        expect(status).toBe(200);
        expect(body.success).toBe(true);

        // Should be gone now
        const { status: getStatus } = await apiGet(`/api/memory/entries/${created.id}`);
        expect(getStatus).toBe(404);
    });

    it('returns 404 for unknown id', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiDelete('/api/memory/entries/nonexistent');
        expect(status).toBe(404);
    });
});
