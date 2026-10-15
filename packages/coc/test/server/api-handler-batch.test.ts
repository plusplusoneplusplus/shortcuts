/**
 * Tests for:
 * - POST /api/git-info/batch — batch git-info fetch
 * - POST /api/workspaces/:id/git/changes/stage-batch — batch stage
 * - POST /api/workspaces/:id/git/changes/unstage-batch — batch unstage
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { gitInfoCache } from '../../src/server/git/git-info-cache';

const gitServiceMocks = vi.hoisted(() => ({
    detectRemoteUrl: vi.fn(),
    getRepositoryStatus: vi.fn(),
}));

// ============================================================================
// Test Constants
// ============================================================================

const WORKSPACE_1 = {
    id: 'ws-1',
    name: 'project-a',
    rootPath: process.platform === 'win32' ? 'C:\\projects\\a' : '/projects/a',
    remoteUrl: 'https://github.com/user/a',
    isGitRepo: true,
};

const WORKSPACE_2 = {
    id: 'ws-2',
    name: 'project-b',
    rootPath: process.platform === 'win32' ? 'C:\\projects\\b' : '/projects/b',
    remoteUrl: 'https://github.com/user/b',
    isGitRepo: true,
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

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        detectRemoteUrl: gitServiceMocks.detectRemoteUrl,
        BranchService: vi.fn().mockImplementation(function () { return ({
            getRepositoryStatus: gitServiceMocks.getRepositoryStatus,
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(async () => 'main'),
        }); }),
        WorkingTreeService: vi.fn().mockImplementation(function () { return ({
            getAllChanges: vi.fn(async () => []),
            stageFile: vi.fn(async function () { return ({ success: true }); }),
            unstageFile: vi.fn(async function () { return ({ success: true }); }),
            stageFiles: vi.fn(async function () { return ({ success: true, staged: 2, errors: [] }); }),
            unstageFiles: vi.fn(async function () { return ({ success: true, unstaged: 2, errors: [] }); }),
            discardChanges: vi.fn(async function () { return ({ success: true }); }),
            getFileDiff: vi.fn(async () => ''),
            deleteUntrackedFile: vi.fn(async function () { return ({ success: true }); }),
        }); }),
    };
});

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/git-info/batch', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeEach(() => {
        gitInfoCache.clear();
        gitServiceMocks.getRepositoryStatus.mockReset().mockResolvedValue({
            branch: 'main', isDetached: false, dirty: true, ahead: 1, behind: 0,
            trackingBranch: 'origin/main', unborn: false,
        });
    });

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
        expect(data.results['ws-1'].remoteUrl).toBe(WORKSPACE_1.remoteUrl);
        // ahead/behind name their comparison base so clients never guess 0/0.
        expect(data.results['ws-1'].upstream).toBe('origin/main');
        expect(data.results['ws-1'].detached).toBe(false);
        expect(data.results['ws-2']).toBeDefined();
        expect(gitServiceMocks.detectRemoteUrl).not.toHaveBeenCalled();
    });

    it('manual single and batch status reads bypass fresh server metadata', async () => {
        const initial = await request(`${baseUrl}/api/workspaces/ws-1/git-info`);
        expect(initial.json().branch).toBe('main');
        gitServiceMocks.getRepositoryStatus.mockResolvedValue({
            branch: 'feature', dirty: false, ahead: 4, behind: 2, trackingBranch: 'origin/feature',
        });
        expect((await request(`${baseUrl}/api/workspaces/ws-1/git-info`)).json().branch).toBe('main');
        const fresh = await request(`${baseUrl}/api/workspaces/ws-1/git-info?refresh=true`);
        expect(fresh.status).toBe(200);
        expect(fresh.json()).toMatchObject({ branch: 'feature', dirty: false, ahead: 4, behind: 2 });
        gitServiceMocks.getRepositoryStatus.mockResolvedValue({ branch: 'next', dirty: true });
        const batch = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST', body: JSON.stringify({ workspaceIds: ['ws-1', 'ws-2'], refresh: true }),
        });
        expect(batch.json().results['ws-1'].branch).toBe('next');
        expect(batch.json().results['ws-2'].branch).toBe('next');
    });

    it('manual failures are unavailable, with successful batch members preserved', async () => {
        await request(`${baseUrl}/api/workspaces/ws-1/git-info`);
        gitServiceMocks.getRepositoryStatus.mockResolvedValueOnce(null);
        const single = await request(`${baseUrl}/api/workspaces/ws-1/git-info?refresh=true`);
        expect(single.status).toBe(503);
        expect(single.json()).toEqual({ error: 'Could not read Git status.' });
        gitServiceMocks.getRepositoryStatus.mockResolvedValueOnce(null);
        const batch = await request(`${baseUrl}/api/git-info/batch`, {
            method: 'POST', body: JSON.stringify({ workspaceIds: ['ws-1', 'ws-2'], refresh: true }),
        });
        expect(batch.json().results['ws-1']).toBeNull();
        expect(batch.json().results['ws-2'].branch).toBe('main');
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
