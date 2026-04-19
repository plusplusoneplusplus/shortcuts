/**
 * Tests for Memory REST API Edge Cases.
 *
 * Tests focus on edge cases not covered in the existing memory-routes.test.ts:
 * - Strict validation for PUT /api/memory/config
 * - Required config fields verification
 * - Removed routes return 404
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

describe('GET /api/memory/config — required fields', () => {
    it('returns config with storageDir and backend', async () => {
        const { status, body } = await apiGet('/api/memory/config');
        expect(status).toBe(200);
        expect(typeof body.storageDir).toBe('string');
        expect(typeof body.backend).toBe('string');
    });
});

describe('PUT /api/memory/config — valid config persisted', () => {
    it('saves backend and storageDir', async () => {
        const { status, body } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'store'),
            backend: 'sqlite',
        });
        expect(status).toBe(200);
        expect(body.backend).toBe('sqlite');
        expect(body.storageDir).toBe(path.join(tmpDir, 'store'));
    });
});

describe('GET /api/memory/observations/:filename — nonexistent file', () => {
    it('returns 404 since observation routes are removed', async () => {
        const { status } = await apiGet('/api/memory/observations/no-such-file.md?level=system');
        expect(status).toBe(404);
    });
});
