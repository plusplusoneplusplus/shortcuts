/**
 * Tests for repo-memory-handler — HTTP handler unit tests.
 *
 * Covers all repo-scoped memory endpoints:
 *   GET  /api/repos/:repoId/memory/feed
 *   POST /api/repos/:repoId/memory/notes
 *   DELETE /api/repos/:repoId/memory/feed/:id
 *   GET  /api/repos/:repoId/memory/stats
 *   POST /api/repos/:repoId/memory/aggregate (SSE)
 *   POST /api/repos/:repoId/memory/aggregate/accept
 *   POST /api/repos/:repoId/memory/aggregate/revert
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import {
    registerRepoMemoryRoutes,
    computeDiff,
    type FeedItem,
    type RepoMemoryRouteOptions,
} from '../../src/server/memory/repo-memory-handler';
import type { Route } from '../../src/server/types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as PipelineMemoryStore } from '@plusplusoneplusplus/forge';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../../src/server/memory/memory-config-handler';
import { FileMemoryStore } from '../../src/server/memory/memory-store';
import { getRepoDataPath } from '../../src/server/paths';

// ── Constants ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test-1';
const REPO_PATH = '/repos/test-project';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let server: http.Server;
let baseUrl: string;

function makeStore(rootPath = REPO_PATH): ProcessStore {
    return {
        getWorkspaces: vi.fn().mockResolvedValue([{ id: WORKSPACE_ID, rootPath }]),
        addProcess: vi.fn(),
        updateProcess: vi.fn(),
        getProcess: vi.fn(),
        getAllProcesses: vi.fn().mockResolvedValue([]),
        removeProcess: vi.fn(),
        clearProcesses: vi.fn(),
        registerWorkspace: vi.fn(),
        removeWorkspace: vi.fn(),
        updateWorkspace: vi.fn(),
        getWikis: vi.fn().mockResolvedValue([]),
        registerWiki: vi.fn(),
        removeWiki: vi.fn(),
        updateWiki: vi.fn(),
        clearAllWorkspaces: vi.fn(),
        clearAllWikis: vi.fn(),
        getStorageStats: vi.fn().mockResolvedValue({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
        onProcessOutput: vi.fn().mockReturnValue(() => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
    } as unknown as ProcessStore;
}

function makeServer(dataDir: string, options?: Partial<RepoMemoryRouteOptions>): http.Server {
    const routes: Route[] = [];
    const store = options?.store ?? makeStore();
    registerRepoMemoryRoutes(routes, dataDir, { store, ...options });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(s: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const addr = s.address() as { port: number };
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });
}

async function stopServer(s: http.Server): Promise<void> {
    return new Promise(resolve => s.close(() => resolve()));
}

async function apiGet(url: string): Promise<{ status: number; body: any }> {
    const res = await fetch(url);
    const body = await res.json();
    return { status: res.status, body };
}

async function apiPost(url: string, data: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    return { status: res.status, body };
}

async function apiDelete(url: string): Promise<{ status: number; body: any }> {
    const res = await fetch(url, { method: 'DELETE' });
    const body = await res.json();
    return { status: res.status, body };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-memory-handler-test-'));
    // Point memory storage to isolated tmpDir to avoid cross-test contamination
    writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') });
    server = makeServer(tmpDir);
    baseUrl = await startServer(server);
});

afterEach(async () => {
    await stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── computeDiff ───────────────────────────────────────────────────────────────

describe('computeDiff', () => {
    it('returns empty array for identical strings', () => {
        const diff = computeDiff('hello\nworld', 'hello\nworld');
        expect(diff.every(d => d.type === 'unchanged')).toBe(true);
    });

    it('adds when prev is empty', () => {
        const diff = computeDiff('', 'new line');
        expect(diff).toEqual([{ type: 'add', text: 'new line' }]);
    });

    it('removes when next is empty', () => {
        const diff = computeDiff('old line', '');
        expect(diff).toEqual([{ type: 'remove', text: 'old line' }]);
    });

    it('detects add and remove', () => {
        const diff = computeDiff('a\nb\nc', 'a\nd\nc');
        const types = diff.map(d => d.type);
        expect(types).toContain('remove');
        expect(types).toContain('add');
        expect(types).toContain('unchanged');
    });

    it('preserves text content in diff lines', () => {
        const diff = computeDiff('', 'line1\nline2');
        expect(diff.map(d => d.text)).toEqual(['line1', 'line2']);
    });
});

// ── GET /api/repos/:repoId/memory/feed ────────────────────────────────────────

describe('GET /api/repos/:repoId/memory/feed', () => {
    it('returns empty feed when repo has no memory', async () => {
        const { status, body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed`);
        expect(status).toBe(200);
        expect(body.items).toEqual([]);
        expect(body.totalCount).toBe(0);
        expect(body.consolidatedAt).toBeNull();
    });

    it('returns 404 when workspace not found', async () => {
        const s = makeServer(tmpDir, {
            store: {
                getWorkspaces: vi.fn().mockResolvedValue([]),
            } as unknown as ProcessStore,
        });
        const url = await startServer(s);
        const { status } = await apiGet(`${url}/api/repos/unknown/memory/feed`);
        await stopServer(s);
        expect(status).toBe(404);
    });

    it('includes user notes in feed', async () => {
        // Create a note in the repo-scoped store
        const noteStore = new FileMemoryStore(getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory'));
        noteStore.create({ content: 'test note', tags: ['api'], source: 'manual' });

        const { status, body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed`);
        expect(status).toBe(200);
        expect(body.items).toHaveLength(1);
        const item: FeedItem = body.items[0];
        expect(item.type).toBe('note');
        expect(item.content).toBe('test note');
        expect(item.tags).toEqual(['api']);
        expect(item.source).toBe('manual');
        expect(body.totalCount).toBe(1);
    });

    it('includes pipeline observations in feed', async () => {
        // Write an observation directly to the pipeline memory store
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);
        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);
        await pipelineStore.writeRaw('repo', repoHash, {
            pipeline: 'code-review',
            timestamp: '2026-01-01T00:00:00.000Z',
        }, 'use snake_case');

        const { status, body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed`);
        expect(status).toBe(200);
        expect(body.items).toHaveLength(1);
        const item: FeedItem = body.items[0];
        expect(item.type).toBe('observation');
        expect(item.source).toBe('code-review');
        expect(item.content).toContain('use snake_case');
        expect(item.tags).toEqual([]);
    });

    it('merges and sorts by createdAt descending', async () => {
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);
        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);

        // Older observation
        await pipelineStore.writeRaw('repo', repoHash, {
            pipeline: 'analyze',
            timestamp: '2026-01-01T00:00:00.000Z',
        }, 'old fact');

        // Newer note
        const noteStore = new FileMemoryStore(getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory'));
        noteStore.create({ content: 'new note', tags: [], source: 'manual' });

        const { body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed`);
        expect(body.items).toHaveLength(2);
        // newer note should be first
        expect(body.items[0].type).toBe('note');
        expect(body.items[1].type).toBe('observation');
    });
});

// ── POST /api/repos/:repoId/memory/notes ─────────────────────────────────────

describe('POST /api/repos/:repoId/memory/notes', () => {
    it('creates a note and returns 201 FeedItem', async () => {
        const { status, body } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`,
            { content: 'use PascalCase for classes', tags: ['naming'] },
        );
        expect(status).toBe(201);
        expect(body.type).toBe('note');
        expect(body.content).toBe('use PascalCase for classes');
        expect(body.tags).toEqual(['naming']);
        expect(body.source).toBe('manual');
        expect(typeof body.id).toBe('string');
        expect(typeof body.createdAt).toBe('string');
    });

    it('creates note without tags', async () => {
        const { status, body } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`,
            { content: 'prefer composition over inheritance' },
        );
        expect(status).toBe(201);
        expect(body.tags).toEqual([]);
    });

    it('returns 400 when content is missing', async () => {
        const { status } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`,
            { tags: ['foo'] },
        );
        expect(status).toBe(400);
    });

    it('returns 400 when content is empty string', async () => {
        const { status } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`,
            { content: '   ' },
        );
        expect(status).toBe(400);
    });

    it('persists note so it appears in feed', async () => {
        await apiPost(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`, { content: 'persisted' });
        const { body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed`);
        expect(body.items).toHaveLength(1);
        expect(body.items[0].content).toBe('persisted');
    });
});

// ── DELETE /api/repos/:repoId/memory/feed/:id ─────────────────────────────────

describe('DELETE /api/repos/:repoId/memory/feed/:id', () => {
    it('deletes a note and returns success', async () => {
        const { body: created } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`,
            { content: 'to be deleted' },
        );

        const { status, body } = await apiDelete(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed/${created.id}?type=note`,
        );
        expect(status).toBe(200);
        expect(body.success).toBe(true);

        // Verify removed from feed
        const { body: feed } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed`);
        expect(feed.items).toHaveLength(0);
    });

    it('returns 404 for non-existent note', async () => {
        const { status } = await apiDelete(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed/no-such-id?type=note`,
        );
        expect(status).toBe(404);
    });

    it('returns 400 when type query param is missing', async () => {
        const { status } = await apiDelete(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed/some-id`,
        );
        expect(status).toBe(400);
    });

    it('returns 400 when type is invalid', async () => {
        const { status } = await apiDelete(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed/some-id?type=invalid`,
        );
        expect(status).toBe(400);
    });

    it('deletes an observation', async () => {
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);
        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);
        const filename = await pipelineStore.writeRaw('repo', repoHash, {
            pipeline: 'test-pipeline',
            timestamp: new Date().toISOString(),
        }, 'some observation');

        const { status, body } = await apiDelete(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed/${encodeURIComponent(filename)}?type=observation`,
        );
        expect(status).toBe(200);
        expect(body.success).toBe(true);
    });

    it('returns 404 for non-existent observation', async () => {
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);

        const { status } = await apiDelete(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/feed/no-such.md?type=observation`,
        );
        expect(status).toBe(404);
    });
});

// ── GET /api/repos/:repoId/memory/stats ──────────────────────────────────────

describe('GET /api/repos/:repoId/memory/stats', () => {
    it('returns zero counts for empty repo', async () => {
        const { status, body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/stats`);
        expect(status).toBe(200);
        expect(body.observationCount).toBe(0);
        expect(body.noteCount).toBe(0);
        expect(body.consolidatedAt).toBeNull();
    });

    it('counts notes correctly', async () => {
        await apiPost(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`, { content: 'note 1' });
        await apiPost(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/notes`, { content: 'note 2' });

        const { body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/stats`);
        expect(body.noteCount).toBe(2);
        expect(body.observationCount).toBe(0);
    });

    it('counts observations correctly', async () => {
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);
        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);
        await pipelineStore.writeRaw('repo', repoHash, { pipeline: 'p1', timestamp: new Date().toISOString() }, 'obs 1');
        await pipelineStore.writeRaw('repo', repoHash, { pipeline: 'p2', timestamp: new Date().toISOString() }, 'obs 2');

        const { body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/stats`);
        expect(body.observationCount).toBe(2);
    });

    it('returns consolidatedAt from pipeline memory index', async () => {
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);
        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);
        const ts = '2026-03-01T10:00:00.000Z';
        await pipelineStore.updateIndex('repo', repoHash, { lastAggregation: ts });

        const { body } = await apiGet(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/stats`);
        expect(body.consolidatedAt).toBe(ts);
    });

    it('returns stats even when workspace path is unknown', async () => {
        const s = makeServer(tmpDir, {
            store: {
                getWorkspaces: vi.fn().mockResolvedValue([]),
            } as unknown as ProcessStore,
        });
        const url = await startServer(s);
        const { status, body } = await apiGet(`${url}/api/repos/${WORKSPACE_ID}/memory/stats`);
        await stopServer(s);
        expect(status).toBe(200);
        expect(body.observationCount).toBe(0);
    });
});

// ── POST /api/repos/:repoId/memory/aggregate (SSE) ────────────────────────────

describe('POST /api/repos/:repoId/memory/aggregate', () => {
    it('returns SSE error event when AI invoker is not configured', async () => {
        const s = makeServer(tmpDir, { aiInvoker: undefined });
        const url = await startServer(s);

        const res = await fetch(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const text = await res.text();
        expect(text).toContain('event: error');
        expect(text).toContain('AI invoker not configured');
        await stopServer(s);
    });

    it('returns SSE complete with no data reason when nothing to aggregate', async () => {
        const mockAI = vi.fn().mockResolvedValue({ success: true, response: 'consolidated' });
        const s = makeServer(tmpDir, { aiInvoker: mockAI });
        const url = await startServer(s);

        const res = await fetch(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        const text = await res.text();
        expect(text).toContain('event: complete');
        expect(text).toContain('no data');
        expect(mockAI).not.toHaveBeenCalled();
        await stopServer(s);
    });

    it('calls AI and returns complete event with consolidated and diff', async () => {
        const newContent = '# Consolidated\n- fact one';
        const mockAI = vi.fn().mockResolvedValue({ success: true, response: newContent });

        // Seed a note
        const noteStore = new FileMemoryStore(getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory'));
        noteStore.create({ content: 'use TypeScript', tags: ['lang'], source: 'manual' });

        const s = makeServer(tmpDir, { aiInvoker: mockAI });
        const url = await startServer(s);

        const res = await fetch(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources: ['notes'] }),
        });

        const text = await res.text();
        expect(text).toContain('event: complete');
        expect(text).toContain('fact one');
        expect(mockAI).toHaveBeenCalledOnce();
        await stopServer(s);
    });

    it('passes model parameter to AI invoker', async () => {
        const mockAI = vi.fn().mockResolvedValue({ success: true, response: 'ok' });
        const noteStore = new FileMemoryStore(getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory'));
        noteStore.create({ content: 'note', tags: [], source: 'manual' });

        const s = makeServer(tmpDir, { aiInvoker: mockAI });
        const url = await startServer(s);

        const res = await fetch(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4', sources: ['notes'] }),
        });
        // Consume body to ensure the SSE handler completes before asserting
        await res.text();

        expect(mockAI).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ model: 'gpt-4' }));
        await stopServer(s);
    });

    it('returns SSE error when AI call fails', async () => {
        const mockAI = vi.fn().mockResolvedValue({ success: false, error: 'AI unavailable' });
        const noteStore = new FileMemoryStore(getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory'));
        noteStore.create({ content: 'note', tags: [], source: 'manual' });

        const s = makeServer(tmpDir, { aiInvoker: mockAI });
        const url = await startServer(s);

        const res = await fetch(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources: ['notes'] }),
        });

        const text = await res.text();
        expect(text).toContain('event: error');
        expect(text).toContain('AI unavailable');
        await stopServer(s);
    });

    it('writes consolidated.md after successful aggregation', async () => {
        const newContent = '# Memory\n- typescript preferred';
        const mockAI = vi.fn().mockResolvedValue({ success: true, response: newContent });
        const noteStore = new FileMemoryStore(getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory'));
        noteStore.create({ content: 'note', tags: [], source: 'manual' });

        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);

        const s = makeServer(tmpDir, { aiInvoker: mockAI });
        const url = await startServer(s);

        await fetch(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources: ['notes'] }),
        });

        // Give time for async writes
        await new Promise(r => setTimeout(r, 100));

        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);
        const consolidated = await pipelineStore.readConsolidated('repo', repoHash);
        expect(consolidated).toBe(newContent);
        await stopServer(s);
    });
});

// ── POST /api/repos/:repoId/memory/aggregate/accept ──────────────────────────

describe('POST /api/repos/:repoId/memory/aggregate/accept', () => {
    it('returns success even when no backup exists', async () => {
        const { status, body } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/aggregate/accept`,
            {},
        );
        expect(status).toBe(200);
        expect(body.success).toBe(true);
    });

    it('removes the backup file on accept', async () => {
        // Create a fake backup
        const memDir = getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        const prevPath = path.join(memDir, 'consolidated.prev.md');
        fs.writeFileSync(prevPath, 'old content', 'utf-8');

        await apiPost(`${baseUrl}/api/repos/${WORKSPACE_ID}/memory/aggregate/accept`, {});
        expect(fs.existsSync(prevPath)).toBe(false);
    });
});

// ── POST /api/repos/:repoId/memory/aggregate/revert ──────────────────────────

describe('POST /api/repos/:repoId/memory/aggregate/revert', () => {
    it('returns 404 when no backup exists', async () => {
        const { status } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/aggregate/revert`,
            {},
        );
        expect(status).toBe(404);
    });

    it('restores consolidated.md from backup', async () => {
        const config = { ...DEFAULT_MEMORY_CONFIG, storageDir: path.join(tmpDir, 'memory') };
        writeMemoryConfig(tmpDir, config);

        const pipelineStore = new PipelineMemoryStore({ dataDir: config.storageDir });
        const repoHash = pipelineStore.computeRepoHash(REPO_PATH);

        // Write current consolidated
        await pipelineStore.writeConsolidated('repo', '# New version', repoHash);

        // Create backup
        const memDir = getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, 'consolidated.prev.md'), '# Old version', 'utf-8');

        const { status, body } = await apiPost(
            `${baseUrl}/api/repos/${WORKSPACE_ID}/memory/aggregate/revert`,
            {},
        );
        expect(status).toBe(200);
        expect(body.success).toBe(true);

        const restored = await pipelineStore.readConsolidated('repo', repoHash);
        expect(restored).toBe('# Old version');

        // Backup should be removed after revert
        expect(fs.existsSync(path.join(memDir, 'consolidated.prev.md'))).toBe(false);
    });

    it('returns 404 when workspace not found', async () => {
        // Create backup but workspace is not in store
        const memDir = getRepoDataPath(tmpDir, WORKSPACE_ID, 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, 'consolidated.prev.md'), 'old', 'utf-8');

        const s = makeServer(tmpDir, {
            store: { getWorkspaces: vi.fn().mockResolvedValue([]) } as unknown as ProcessStore,
        });
        const url = await startServer(s);
        const { status } = await apiPost(`${url}/api/repos/${WORKSPACE_ID}/memory/aggregate/revert`, {});
        await stopServer(s);
        expect(status).toBe(404);
    });
});
