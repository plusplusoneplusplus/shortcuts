/**
 * Tests for memory-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerMemoryRoutes } from '../src/memory/memory-routes';
import type { MemoryRouteOptions } from '../src/memory/memory-routes';
import type { Route } from '../src/types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../src/memory/memory-config-handler';

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let server: http.Server;
let baseUrl: string;

function makeServer(dataDir: string, options?: MemoryRouteOptions): http.Server {
    const routes: Route[] = [];
    registerMemoryRoutes(routes, dataDir, options);
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

// ── Helper for seeding raw files ──────────────────────────────────────────────

function seedRawFiles(storageDir: string, count: number): void {
    const rawDir = path.join(storageDir, 'explore-cache', 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    for (let i = 0; i < count; i++) {
        const entry = {
            id: `entry-${i}`,
            toolName: 'grep',
            question: `Find pattern ${i}`,
            answer: `Result ${i}`,
            args: { pattern: `p-${i}` },
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
        };
        fs.writeFileSync(
            path.join(rawDir, `${Date.now() + i}-grep.json`),
            JSON.stringify(entry, null, 2),
            'utf-8',
        );
    }
}

function makeConsolidatedJson(count: number): string {
    const entries = Array.from({ length: count }, (_, i) => ({
        id: `c-${i}`,
        question: `Q ${i}`,
        answer: `A ${i}`,
        topics: ['test'],
        toolSources: ['grep'],
        createdAt: new Date().toISOString(),
        hitCount: 1,
    }));
    return JSON.stringify(entries);
}

// ── POST /api/memory/aggregate-tool-calls ─────────────────────────────────────

describe('POST /api/memory/aggregate-tool-calls', () => {
    it('returns 503 when no aiInvoker is configured (no options)', async () => {
        // server is created with no options in beforeEach → no aiInvoker
        const res = await fetch(`${baseUrl}/api/memory/aggregate-tool-calls`, { method: 'POST' });
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error).toBe('AI invoker not configured');
    });

    it('returns 200 aggregated: false when raw dir is empty', async () => {
        await stopServer();

        const storageDir = path.join(tmpDir, 'storage2');
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir });

        const mockInvoker: AIInvoker = vi.fn();
        server = makeServer(tmpDir, { aggregateToolCallsAIInvoker: mockInvoker });
        await startServer();

        const res = await fetch(`${baseUrl}/api/memory/aggregate-tool-calls`, { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.aggregated).toBe(false);
        expect(body.reason).toBe('no raw entries');
        expect(mockInvoker).not.toHaveBeenCalled();
    });

    it('returns 200 aggregated: true when raw files exist', async () => {
        await stopServer();

        const storageDir = path.join(tmpDir, 'storage3');
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir });

        const N = 3;
        seedRawFiles(storageDir, N);

        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: makeConsolidatedJson(2),
        });
        server = makeServer(tmpDir, { aggregateToolCallsAIInvoker: mockInvoker });
        await startServer();

        const res = await fetch(`${baseUrl}/api/memory/aggregate-tool-calls`, { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.aggregated).toBe(true);
        expect(body.rawCount).toBe(N);
        expect(typeof body.consolidatedCount).toBe('number');
    });
});

// ── Observation browsing routes ───────────────────────────────────────────────

/**
 * Helper to seed pipeline-core memory observation files at a given level.
 * Writes .md files with YAML frontmatter directly to the raw/ directory.
 */
function seedObservation(
    storageDir: string,
    level: 'system' | 'git-remote' | 'repo',
    hash: string | undefined,
    pipeline: string,
    timestamp: string,
    content: string,
): void {
    let rawDir: string;
    if (level === 'system') rawDir = path.join(storageDir, 'system', 'raw');
    else if (level === 'git-remote') rawDir = path.join(storageDir, 'git-remotes', hash!, 'raw');
    else rawDir = path.join(storageDir, 'repos', hash!, 'raw');

    fs.mkdirSync(rawDir, { recursive: true });
    const ts = timestamp.replace(/:/g, '-');
    const filename = `${ts}-${pipeline}.md`;
    const fileContent = `---\npipeline: ${pipeline}\ntimestamp: ${timestamp}\n---\n\n${content}\n`;
    fs.writeFileSync(path.join(rawDir, filename), fileContent, 'utf-8');
}

describe('GET /api/memory/observations/levels', () => {
    it('returns overview with global, repos, and gitRemotes', async () => {
        const storageDir = path.join(tmpDir, 'obs-storage');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        seedObservation(storageDir, 'system', undefined, 'review', '2026-01-01T00:00:00.000Z', 'global obs');
        seedObservation(storageDir, 'repo', 'repohash1', 'analyze', '2026-02-01T00:00:00.000Z', 'repo obs');
        seedObservation(storageDir, 'git-remote', 'remotehash1', 'scan', '2026-03-01T00:00:00.000Z', 'remote obs');

        const { status, body } = await apiGet('/api/memory/observations/levels');
        expect(status).toBe(200);
        expect(body.global.rawCount).toBe(1);
        expect(body.repos).toHaveLength(1);
        expect(body.repos[0].hash).toBe('repohash1');
        expect(body.repos[0].rawCount).toBe(1);
        expect(body.gitRemotes).toHaveLength(1);
        expect(body.gitRemotes[0].hash).toBe('remotehash1');
        expect(body.gitRemotes[0].rawCount).toBe(1);
    });

    it('returns empty arrays when no observations exist', async () => {
        const storageDir = path.join(tmpDir, 'obs-empty');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status, body } = await apiGet('/api/memory/observations/levels');
        expect(status).toBe(200);
        expect(body.global.rawCount).toBe(0);
        expect(body.repos).toEqual([]);
        expect(body.gitRemotes).toEqual([]);
    });
});

describe('GET /api/memory/observations', () => {
    it('lists files at system level', async () => {
        const storageDir = path.join(tmpDir, 'obs-list');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });
        seedObservation(storageDir, 'system', undefined, 'p1', '2026-01-01T00:00:00.000Z', 'obs1');
        seedObservation(storageDir, 'system', undefined, 'p2', '2026-02-01T00:00:00.000Z', 'obs2');

        const { status, body } = await apiGet('/api/memory/observations?level=system');
        expect(status).toBe(200);
        expect(body.files).toHaveLength(2);
        expect(body.level).toBe('system');
    });

    it('lists files at git-remote level', async () => {
        const storageDir = path.join(tmpDir, 'obs-list-remote');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });
        seedObservation(storageDir, 'git-remote', 'rhash', 'scan', '2026-01-01T00:00:00.000Z', 'remote obs');

        const { status, body } = await apiGet('/api/memory/observations?level=git-remote&hash=rhash');
        expect(status).toBe(200);
        expect(body.files).toHaveLength(1);
        expect(body.level).toBe('git-remote');
    });

    it('returns 400 for invalid level', async () => {
        const storageDir = path.join(tmpDir, 'obs-bad-level');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiGet('/api/memory/observations?level=invalid');
        expect(status).toBe(400);
    });
});

describe('GET /api/memory/observations/:filename', () => {
    it('reads a single observation file', async () => {
        const storageDir = path.join(tmpDir, 'obs-single');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });
        seedObservation(storageDir, 'system', undefined, 'review', '2026-05-01T00:00:00.000Z', 'found an issue');

        // First get the filename
        const { body: listBody } = await apiGet('/api/memory/observations?level=system');
        const filename = listBody.files[0];

        const { status, body } = await apiGet(`/api/memory/observations/${encodeURIComponent(filename)}?level=system`);
        expect(status).toBe(200);
        expect(body.metadata.pipeline).toBe('review');
        expect(body.content).toBe('found an issue');
    });

    it('reads consolidated memory', async () => {
        const storageDir = path.join(tmpDir, 'obs-consolidated');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        // Write a consolidated.md
        const consolidatedDir = path.join(storageDir, 'system');
        fs.mkdirSync(consolidatedDir, { recursive: true });
        fs.writeFileSync(path.join(consolidatedDir, 'consolidated.md'), '# Facts\n- Fact 1', 'utf-8');

        const { status, body } = await apiGet('/api/memory/observations/consolidated?level=system');
        expect(status).toBe(200);
        expect(body.content).toContain('Fact 1');
    });

    it('returns 404 for non-existent file', async () => {
        const storageDir = path.join(tmpDir, 'obs-404');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiGet('/api/memory/observations/nonexistent.md?level=system');
        expect(status).toBe(404);
    });

    it('returns 400 for invalid level', async () => {
        const storageDir = path.join(tmpDir, 'obs-bad');
        await apiPut('/api/memory/config', { storageDir, backend: 'file', maxEntries: 100, ttlDays: 0, autoInject: false });

        const { status } = await apiGet('/api/memory/observations/file.md?level=invalid');
        expect(status).toBe(400);
    });
});
