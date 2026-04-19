/**
 * Tests for Memory REST API Edge Cases.
 *
 * Section 9: Memory REST API Edge Cases
 * Tests focus on edge cases not covered in the existing memory-routes.test.ts:
 * - Sort order verification for entries
 * - Strict validation for PUT /api/memory/config (invalid maxEntries/ttlDays)
 * - PATCH partial update semantics
 * - Validation boundary conditions
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerMemoryRoutes } from '../../src/server/memory/memory-routes';
import type { Route } from '../../src/server/types';

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

const DEFAULT_STORAGE = (dir: string): object => ({
    storageDir: path.join(dir, 'storage'),
    backend: 'file',
    maxEntries: 100,
    ttlDays: 0,
    autoInject: false,
});

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-api-edge-test-'));
    server = makeServer(tmpDir);
    await startServer();
});

afterEach(async () => {
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/memory/entries — sort order', () => {
    it('returns entries sorted by createdAt descending (newest first)', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));

        // Create three entries; their createdAt will be in ascending insertion order
        const r1 = await apiPost('/api/memory/entries', { content: 'first', tags: [], source: 'manual' });
        const r2 = await apiPost('/api/memory/entries', { content: 'second', tags: [], source: 'manual' });
        const r3 = await apiPost('/api/memory/entries', { content: 'third', tags: [], source: 'manual' });

        const { status, body } = await apiGet('/api/memory/entries');
        expect(status).toBe(200);
        expect(body.total).toBe(3);

        const entries = body.entries as Array<{ id: string; createdAt: string }>;
        // Verify descending sort: each entry should have createdAt >= the next
        for (let i = 0; i < entries.length - 1; i++) {
            expect(new Date(entries[i].createdAt).getTime()).toBeGreaterThanOrEqual(
                new Date(entries[i + 1].createdAt).getTime(),
            );
        }

        // The last created entry (r3) should be first in the list
        expect(entries[0].id).toBe(r3.body.id);
        expect(entries[entries.length - 1].id).toBe(r1.body.id);
    });
});

describe('POST /api/memory/entries — validation', () => {
    it('returns 400 when content is missing', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status } = await apiPost('/api/memory/entries', { tags: ['x'] });
        expect(status).toBe(400);
    });

    it('returns 400 when content is empty string', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status } = await apiPost('/api/memory/entries', { content: '', tags: [] });
        expect(status).toBe(400);
    });

    it('returns 400 when content is whitespace only', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status } = await apiPost('/api/memory/entries', { content: '   ', tags: [] });
        expect(status).toBe(400);
    });

    it('summary is optional — 201 without summary field', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status, body } = await apiPost('/api/memory/entries', {
            content: 'No summary provided',
            tags: [],
            source: 'test',
        });
        expect(status).toBe(201);
        expect(body.id).toBeTruthy();
        expect(body.summary).toBeUndefined();
    });
});

describe('GET /api/memory/entries/:id — edge cases', () => {
    it('returns 404 for nonexistent id', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status } = await apiGet('/api/memory/entries/does-not-exist-abc123');
        expect(status).toBe(404);
    });
});

describe('PATCH /api/memory/entries/:id — partial update', () => {
    it('partial update with only tags → only tags field changed, content preserved', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { body: created } = await apiPost('/api/memory/entries', {
            content: 'original content stays',
            tags: ['old-tag'],
            source: 'manual',
        });

        const { status, body } = await apiPatch(`/api/memory/entries/${created.id}`, {
            tags: ['new-tag1', 'new-tag2'],
        });

        expect(status).toBe(200);
        expect(body.tags).toEqual(['new-tag1', 'new-tag2']);
        // content should be unchanged — verify by fetching the full entry
        const { body: full } = await apiGet(`/api/memory/entries/${created.id}`);
        expect(full.content).toBe('original content stays');
    });

    it('returns 404 for PATCH on nonexistent id', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status } = await apiPatch('/api/memory/entries/nonexistent-xyz', { tags: [] });
        expect(status).toBe(404);
    });
});

describe('DELETE /api/memory/entries/:id — edge cases', () => {
    it('DELETE → subsequent GET returns 404', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { body: created } = await apiPost('/api/memory/entries', {
            content: 'to delete',
            tags: [],
            source: 'manual',
        });

        const { status: deleteStatus } = await apiDelete(`/api/memory/entries/${created.id}`);
        expect(deleteStatus).toBe(200);

        const { status: getStatus } = await apiGet(`/api/memory/entries/${created.id}`);
        expect(getStatus).toBe(404);
    });

    it('returns 404 for DELETE on nonexistent id', async () => {
        await apiPut('/api/memory/config', DEFAULT_STORAGE(tmpDir));
        const { status } = await apiDelete('/api/memory/entries/nonexistent-abc');
        expect(status).toBe(404);
    });
});

describe('GET /api/memory/config — required fields', () => {
    it('returns config with all expected fields', async () => {
        const { status, body } = await apiGet('/api/memory/config');
        expect(status).toBe(200);
        expect(typeof body.storageDir).toBe('string');
        expect(typeof body.backend).toBe('string');
        expect(typeof body.maxEntries).toBe('number');
        expect(typeof body.ttlDays).toBe('number');
        expect(typeof body.autoInject).toBe('boolean');
    });
});

describe('PUT /api/memory/config — strict validation', () => {
    it('maxEntries: -1 → 400 (invalid value)', async () => {
        const { status } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'store'),
            backend: 'file',
            maxEntries: -1,
            ttlDays: 30,
            autoInject: false,
        });
        expect(status).toBe(400);
    });

    it('maxEntries: 0 → 400 (must be positive)', async () => {
        const { status } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'store'),
            backend: 'file',
            maxEntries: 0,
            ttlDays: 30,
            autoInject: false,
        });
        expect(status).toBe(400);
    });

    it('ttlDays: -1 → 400 (invalid value)', async () => {
        const { status } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'store'),
            backend: 'file',
            maxEntries: 500,
            ttlDays: -1,
            autoInject: false,
        });
        expect(status).toBe(400);
    });

    it('ttlDays: 0 → 200 (zero is valid, means no TTL)', async () => {
        const { status, body } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'store'),
            backend: 'file',
            maxEntries: 500,
            ttlDays: 0,
            autoInject: false,
        });
        expect(status).toBe(200);
        expect(body.ttlDays).toBe(0);
    });

    it('valid config → 200 and fields persisted', async () => {
        const { status, body } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'store'),
            backend: 'file',
            maxEntries: 1000,
            ttlDays: 90,
            autoInject: true,
        });
        expect(status).toBe(200);
        expect(body.maxEntries).toBe(1000);
        expect(body.ttlDays).toBe(90);
        expect(body.autoInject).toBe(true);
    });
});

describe('GET /api/memory/observations/:filename — nonexistent file', () => {
    it('returns 404 since observation routes are removed', async () => {
        const { status } = await apiGet('/api/memory/observations/no-such-file.md?level=system');
        expect(status).toBe(404);
    });
});
