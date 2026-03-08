/**
 * API Handler — Batch Endpoint Tests
 *
 * Tests for:
 * - POST /api/git-info/batch — batch git-info fetch
 * - POST /api/workspaces/:id/git/changes/stage-batch — batch stage
 * - POST /api/workspaces/:id/git/changes/unstage-batch — batch unstage
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Test Constants
// ============================================================================

const WORKSPACE_1 = {
    id: 'ws-1',
    name: 'project-a',
    rootPath: process.platform === 'win32' ? 'C:\\projects\\a' : '/projects/a',
    remoteUrl: 'https://github.com/user/a',
};

const WORKSPACE_2 = {
    id: 'ws-2',
    name: 'project-b',
    rootPath: process.platform === 'win32' ? 'C:\\projects\\b' : '/projects/b',
    remoteUrl: 'https://github.com/user/b',
};

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Mock git services to avoid actual git CLI calls
// ============================================================================

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(() => ({
            hasUncommittedChanges: vi.fn(() => true),
            getBranchStatus: vi.fn(() => ({ ahead: 1, behind: 0, branch: 'main' })),
        })),
        GitRangeService: vi.fn().mockImplementation(() => ({
            getCurrentBranch: vi.fn(() => 'main'),
        })),
        WorkingTreeService: vi.fn().mockImplementation(() => ({
            getAllChanges: vi.fn(async () => []),
            stageFile: vi.fn(async () => ({ success: true })),
            unstageFile: vi.fn(async () => ({ success: true })),
            stageFiles: vi.fn(async () => ({ success: true, staged: 2, errors: [] })),
            unstageFiles: vi.fn(async () => ({ success: true, unstaged: 2, errors: [] })),
            discardChanges: vi.fn(async () => ({ success: true })),
            getFileDiff: vi.fn(async () => ''),
            deleteUntrackedFile: vi.fn(async () => ({ success: true })),
        })),
    };
});

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/git-info/batch', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([WORKSPACE_1, WORKSPACE_2]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns git-info for all requested workspaces', async () => {
        const resp = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST',
            body: JSON.stringify({ workspaceIds: ['ws-1', 'ws-2'] }),
        });

        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.results).toBeDefined();
        expect(data.results['ws-1']).toBeDefined();
        expect(data.results['ws-1'].branch).toBe('main');
        expect(data.results['ws-1'].dirty).toBe(true);
        expect(data.results['ws-1'].isGitRepo).toBe(true);
        expect(data.results['ws-2']).toBeDefined();
    });

    it('returns null for unknown workspace IDs', async () => {
        const resp = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST',
            body: JSON.stringify({ workspaceIds: ['ws-1', 'ws-nonexistent'] }),
        });

        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.results['ws-1']).toBeDefined();
        expect(data.results['ws-nonexistent']).toBeNull();
    });

    it('returns empty results for empty array', async () => {
        const resp = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST',
            body: JSON.stringify({ workspaceIds: [] }),
        });

        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.results).toEqual({});
    });

    it('returns 400 when workspaceIds is not an array', async () => {
        const resp = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST',
            body: JSON.stringify({ workspaceIds: 'not-an-array' }),
        });

        expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
        const resp = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST',
            body: 'not-json',
        });

        expect(resp.status).toBe(400);
    });
});

describe('POST /api/workspaces/:id/git/changes/stage-batch', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([WORKSPACE_1]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('stages multiple files and returns result', async () => {
        const resp = await request(`${baseUrl}/api/workspaces/ws-1/git/changes/stage-batch`, {
            method: 'POST',
            body: JSON.stringify({ filePaths: ['src/a.ts', 'src/b.ts'] }),
        });

        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.success).toBe(true);
        expect(data.staged).toBe(2);
        expect(data.errors).toEqual([]);
    });

    it('returns 404 for unknown workspace', async () => {
        const resp = await request(`${baseUrl}/api/workspaces/ws-unknown/git/changes/stage-batch`, {
            method: 'POST',
            body: JSON.stringify({ filePaths: ['src/a.ts'] }),
        });

        expect(resp.status).toBe(404);
    });

    it('returns 400 when filePaths is missing', async () => {
        const resp = await request(`${baseUrl}/api/workspaces/ws-1/git/changes/stage-batch`, {
            method: 'POST',
            body: JSON.stringify({}),
        });

        expect(resp.status).toBe(400);
    });
});

describe('POST /api/workspaces/:id/git/changes/unstage-batch', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([WORKSPACE_1]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('unstages multiple files and returns result', async () => {
        const resp = await request(`${baseUrl}/api/workspaces/ws-1/git/changes/unstage-batch`, {
            method: 'POST',
            body: JSON.stringify({ filePaths: ['src/a.ts', 'src/b.ts'] }),
        });

        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.success).toBe(true);
        expect(data.unstaged).toBe(2);
        expect(data.errors).toEqual([]);
    });

    it('returns 404 for unknown workspace', async () => {
        const resp = await request(`${baseUrl}/api/workspaces/ws-unknown/git/changes/unstage-batch`, {
            method: 'POST',
            body: JSON.stringify({ filePaths: ['src/a.ts'] }),
        });

        expect(resp.status).toBe(404);
    });

    it('returns 400 when filePaths is not an array', async () => {
        const resp = await request(`${baseUrl}/api/workspaces/ws-1/git/changes/unstage-batch`, {
            method: 'POST',
            body: JSON.stringify({ filePaths: 'not-an-array' }),
        });

        expect(resp.status).toBe(400);
    });
});
