/**
 * Tests for memory-routes — HTTP handler unit tests using in-process HTTP.
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
    });
});

describe('PUT /api/memory/config', () => {
    it('saves and returns updated config', async () => {
        const { status, body } = await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'custom'),
            backend: 'sqlite',
        });
        expect(status).toBe(200);
        expect(body.backend).toBe('sqlite');
    });

    it('persists config so GET returns updated values', async () => {
        await apiPut('/api/memory/config', {
            storageDir: path.join(tmpDir, 'saved'),
            backend: 'vector',
        });
        const { body } = await apiGet('/api/memory/config');
        expect(body.backend).toBe('vector');
    });
});

// ── Explore-cache browsing routes ─────────────────────────────────────────────

function seedExploreCacheRaw(storageDir: string, level: 'system' | 'git-remote' | 'repo', hash: string | undefined, count: number): void {
    let rawDir: string;
    if (level === 'system') rawDir = path.join(storageDir, 'explore-cache', 'raw');
    else if (level === 'git-remote') rawDir = path.join(storageDir, 'git-remotes', hash!, 'explore-cache', 'raw');
    else rawDir = path.join(storageDir, 'repos', hash!, 'explore-cache', 'raw');

    fs.mkdirSync(rawDir, { recursive: true });
    for (let i = 0; i < count; i++) {
        const entry = {
            id: `raw-entry-${i}`,
            toolName: 'grep',
            question: `Question ${i}`,
            answer: `Answer ${i}`,
            args: { pattern: `p-${i}` },
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
        };
        fs.writeFileSync(path.join(rawDir, `${Date.now() + i}-grep.json`), JSON.stringify(entry, null, 2));
    }
}

function seedExploreCacheConsolidated(storageDir: string, level: 'system' | 'git-remote' | 'repo', hash: string | undefined): void {
    let consolidatedDir: string;
    if (level === 'system') consolidatedDir = path.join(storageDir, 'explore-cache', 'consolidated');
    else if (level === 'git-remote') consolidatedDir = path.join(storageDir, 'git-remotes', hash!, 'explore-cache', 'consolidated');
    else consolidatedDir = path.join(storageDir, 'repos', hash!, 'explore-cache', 'consolidated');

    const entriesDir = path.join(consolidatedDir, 'entries');
    fs.mkdirSync(entriesDir, { recursive: true });

    const indexEntry = {
        id: 'c-1',
        question: 'How does auth work?',
        topics: ['auth', 'security'],
        toolSources: ['grep'],
        createdAt: new Date().toISOString(),
        hitCount: 3,
    };
    fs.writeFileSync(path.join(consolidatedDir, 'index.json'), JSON.stringify([indexEntry]));
    fs.writeFileSync(path.join(entriesDir, 'c-1.md'), 'Auth is handled via JWT tokens.');
}

describe('GET /api/memory/explore-cache/levels', () => {
    it('returns system, repos, and gitRemotes overview', async () => {
        const storageDir = path.join(tmpDir, 'ec-levels');
        await apiPut('/api/memory/config', { storageDir });

        seedExploreCacheRaw(storageDir, 'system', undefined, 2);
        seedExploreCacheRaw(storageDir, 'repo', 'repohash1', 1);
        seedExploreCacheRaw(storageDir, 'git-remote', 'remotehash1', 3);

        const { status, body } = await apiGet('/api/memory/explore-cache/levels');
        expect(status).toBe(200);
        expect(body.system.rawCount).toBe(2);
        expect(body.repos).toHaveLength(1);
        expect(body.repos[0].hash).toBe('repohash1');
        expect(body.repos[0].rawCount).toBe(1);
        expect(body.gitRemotes).toHaveLength(1);
        expect(body.gitRemotes[0].hash).toBe('remotehash1');
        expect(body.gitRemotes[0].rawCount).toBe(3);
    });

    it('returns empty arrays when no explore-cache exists', async () => {
        const storageDir = path.join(tmpDir, 'ec-empty');
        await apiPut('/api/memory/config', { storageDir });

        const { status, body } = await apiGet('/api/memory/explore-cache/levels');
        expect(status).toBe(200);
        expect(body.system.rawCount).toBe(0);
        expect(body.repos).toEqual([]);
        expect(body.gitRemotes).toEqual([]);
    });
});

describe('GET /api/memory/explore-cache/raw', () => {
    it('lists raw files at system level', async () => {
        const storageDir = path.join(tmpDir, 'ec-raw-list');
        await apiPut('/api/memory/config', { storageDir });
        seedExploreCacheRaw(storageDir, 'system', undefined, 3);

        const { status, body } = await apiGet('/api/memory/explore-cache/raw?level=system');
        expect(status).toBe(200);
        expect(body.files).toHaveLength(3);
        expect(body.level).toBe('system');
    });

    it('lists files at git-remote level', async () => {
        const storageDir = path.join(tmpDir, 'ec-raw-remote');
        await apiPut('/api/memory/config', { storageDir });
        seedExploreCacheRaw(storageDir, 'git-remote', 'rhash', 2);

        const { status, body } = await apiGet('/api/memory/explore-cache/raw?level=git-remote&hash=rhash');
        expect(status).toBe(200);
        expect(body.files).toHaveLength(2);
    });

    it('returns 400 for invalid level', async () => {
        const storageDir = path.join(tmpDir, 'ec-raw-bad');
        await apiPut('/api/memory/config', { storageDir });

        const { status } = await apiGet('/api/memory/explore-cache/raw?level=invalid');
        expect(status).toBe(400);
    });
});

describe('GET /api/memory/explore-cache/raw/:filename', () => {
    it('reads a single raw Q&A entry', async () => {
        const storageDir = path.join(tmpDir, 'ec-raw-single');
        await apiPut('/api/memory/config', { storageDir });
        seedExploreCacheRaw(storageDir, 'system', undefined, 1);

        const { body: listBody } = await apiGet('/api/memory/explore-cache/raw?level=system');
        const filename = listBody.files[0];

        const { status, body } = await apiGet(`/api/memory/explore-cache/raw/${encodeURIComponent(filename)}?level=system`);
        expect(status).toBe(200);
        expect(body.toolName).toBe('grep');
        expect(typeof body.question).toBe('string');
        expect(typeof body.answer).toBe('string');
    });

    it('returns 404 for non-existent file', async () => {
        const storageDir = path.join(tmpDir, 'ec-raw-404');
        await apiPut('/api/memory/config', { storageDir });

        const { status } = await apiGet('/api/memory/explore-cache/raw/nonexistent.json?level=system');
        expect(status).toBe(404);
    });
});

describe('GET /api/memory/explore-cache/consolidated', () => {
    it('lists consolidated index entries', async () => {
        const storageDir = path.join(tmpDir, 'ec-con-list');
        await apiPut('/api/memory/config', { storageDir });
        seedExploreCacheConsolidated(storageDir, 'system', undefined);

        const { status, body } = await apiGet('/api/memory/explore-cache/consolidated?level=system');
        expect(status).toBe(200);
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].id).toBe('c-1');
        expect(body.entries[0].question).toBe('How does auth work?');
        expect(body.entries[0]).not.toHaveProperty('answer');
    });

    it('returns empty entries when no consolidated data', async () => {
        const storageDir = path.join(tmpDir, 'ec-con-empty');
        await apiPut('/api/memory/config', { storageDir });

        const { status, body } = await apiGet('/api/memory/explore-cache/consolidated?level=system');
        expect(status).toBe(200);
        expect(body.entries).toEqual([]);
    });
});

describe('GET /api/memory/explore-cache/consolidated/:id', () => {
    it('reads a consolidated entry with answer', async () => {
        const storageDir = path.join(tmpDir, 'ec-con-id');
        await apiPut('/api/memory/config', { storageDir });
        seedExploreCacheConsolidated(storageDir, 'system', undefined);

        const { status, body } = await apiGet('/api/memory/explore-cache/consolidated/c-1?level=system');
        expect(status).toBe(200);
        expect(body.id).toBe('c-1');
        expect(body.question).toBe('How does auth work?');
        expect(body.answer).toBe('Auth is handled via JWT tokens.');
    });

    it('returns 404 for non-existent id', async () => {
        const storageDir = path.join(tmpDir, 'ec-con-404');
        await apiPut('/api/memory/config', { storageDir });

        const { status } = await apiGet('/api/memory/explore-cache/consolidated/nonexistent?level=system');
        expect(status).toBe(404);
    });
});
