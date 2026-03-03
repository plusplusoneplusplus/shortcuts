/**
 * Git Branches API Endpoint Tests
 *
 * Tests for the branch management API routes:
 * - GET /api/workspaces/:id/git/branches
 * - GET /api/workspaces/:id/git/branch-status
 * - POST /api/workspaces/:id/git/branches (create)
 * - POST /api/workspaces/:id/git/branches/switch
 * - POST /api/workspaces/:id/git/branches/rename
 * - DELETE /api/workspaces/:id/git/branches/:name
 * - POST /api/workspaces/:id/git/push
 * - POST /api/workspaces/:id/git/pull
 * - POST /api/workspaces/:id/git/fetch
 * - POST /api/workspaces/:id/git/merge
 * - POST /api/workspaces/:id/git/stash
 * - POST /api/workspaces/:id/git/stash/pop
 *
 * Uses mocked BranchService via vi.mock to avoid actual git calls.
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
// Mock BranchService
// ============================================================================

const mockGetLocalBranchesPaginated = vi.fn();
const mockGetRemoteBranchesPaginated = vi.fn();
const mockGetBranchStatus = vi.fn();
const mockHasUncommittedChanges = vi.fn();
const mockCreateBranch = vi.fn();
const mockSwitchBranch = vi.fn();
const mockDeleteBranch = vi.fn();
const mockRenameBranch = vi.fn();
const mockPush = vi.fn();
const mockPull = vi.fn();
const mockFetch = vi.fn();
const mockMergeBranch = vi.fn();
const mockStashChanges = vi.fn();
const mockPopStash = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(() => ({
            getLocalBranchesPaginated: mockGetLocalBranchesPaginated,
            getRemoteBranchesPaginated: mockGetRemoteBranchesPaginated,
            getBranchStatus: mockGetBranchStatus,
            hasUncommittedChanges: mockHasUncommittedChanges,
            createBranch: mockCreateBranch,
            switchBranch: mockSwitchBranch,
            deleteBranch: mockDeleteBranch,
            renameBranch: mockRenameBranch,
            push: mockPush,
            pull: mockPull,
            fetch: mockFetch,
            mergeBranch: mockMergeBranch,
            stashChanges: mockStashChanges,
            popStash: mockPopStash,
        })),
    };
});

// Mock child_process to prevent real git calls from other routes
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSync(...args),
}));

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
// Test Suite
// ============================================================================

describe('Git Branches API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const WORKSPACE_ID = 'ws-branch-test';
    const WORKSPACE_ROOT = '/test/repo';

    const base = () => `http://127.0.0.1:${port}`;

    const MOCK_LOCAL_RESULT = {
        branches: [
            { name: 'main', isCurrent: true, isRemote: false, lastCommitSubject: 'init', lastCommitDate: '2025-01-01' },
            { name: 'feature/x', isCurrent: false, isRemote: false, lastCommitSubject: 'add x', lastCommitDate: '2025-01-02' },
        ],
        totalCount: 2,
        hasMore: false,
    };

    const MOCK_REMOTE_RESULT = {
        branches: [
            { name: 'origin/main', isCurrent: false, isRemote: true, remoteName: 'origin', lastCommitSubject: 'init', lastCommitDate: '2025-01-01' },
        ],
        totalCount: 1,
        hasMore: false,
    };

    const MOCK_BRANCH_STATUS = {
        name: 'main',
        isDetached: false,
        ahead: 1,
        behind: 0,
        trackingBranch: 'origin/main',
        hasUncommittedChanges: true,
    };

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Test Repo', rootPath: WORKSPACE_ROOT },
        ]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        mockGetLocalBranchesPaginated.mockReset();
        mockGetRemoteBranchesPaginated.mockReset();
        mockGetBranchStatus.mockReset();
        mockHasUncommittedChanges.mockReset();
        mockCreateBranch.mockReset();
        mockSwitchBranch.mockReset();
        mockDeleteBranch.mockReset();
        mockRenameBranch.mockReset();
        mockPush.mockReset();
        mockPull.mockReset();
        mockFetch.mockReset();
        mockMergeBranch.mockReset();
        mockStashChanges.mockReset();
        mockPopStash.mockReset();
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/git/branches
    // -----------------------------------------------------------------------

    describe('GET /api/workspaces/:id/git/branches', () => {
        it('should list local branches when type=local', async () => {
            mockGetLocalBranchesPaginated.mockReturnValue(MOCK_LOCAL_RESULT);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches?type=local`);
            const json = res.json();

            expect(res.status).toBe(200);
            expect(json.local).toEqual(MOCK_LOCAL_RESULT);
            expect(json.remote).toBeUndefined();
        });

        it('should list remote branches when type=remote', async () => {
            mockGetRemoteBranchesPaginated.mockReturnValue(MOCK_REMOTE_RESULT);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches?type=remote`);
            const json = res.json();

            expect(res.status).toBe(200);
            expect(json.remote).toEqual(MOCK_REMOTE_RESULT);
            expect(json.local).toBeUndefined();
        });

        it('should list all branches by default', async () => {
            mockGetLocalBranchesPaginated.mockReturnValue(MOCK_LOCAL_RESULT);
            mockGetRemoteBranchesPaginated.mockReturnValue(MOCK_REMOTE_RESULT);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`);
            const json = res.json();

            expect(res.status).toBe(200);
            expect(json.local).toEqual(MOCK_LOCAL_RESULT);
            expect(json.remote).toEqual(MOCK_REMOTE_RESULT);
        });

        it('should forward pagination params to service', async () => {
            mockGetLocalBranchesPaginated.mockReturnValue(MOCK_LOCAL_RESULT);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches?type=local&limit=25&offset=10`);

            expect(mockGetLocalBranchesPaginated).toHaveBeenCalledWith(
                WORKSPACE_ROOT,
                { limit: 25, offset: 10, searchPattern: undefined },
            );
        });

        it('should forward search param to service', async () => {
            mockGetLocalBranchesPaginated.mockReturnValue(MOCK_LOCAL_RESULT);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches?type=local&search=feat`);

            expect(mockGetLocalBranchesPaginated).toHaveBeenCalledWith(
                WORKSPACE_ROOT,
                { limit: 100, offset: 0, searchPattern: 'feat' },
            );
        });

        it('should cap limit at 500', async () => {
            mockGetLocalBranchesPaginated.mockReturnValue(MOCK_LOCAL_RESULT);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches?type=local&limit=9999`);

            expect(mockGetLocalBranchesPaginated).toHaveBeenCalledWith(
                WORKSPACE_ROOT,
                expect.objectContaining({ limit: 500 }),
            );
        });

        it('should return 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/nonexistent/git/branches`);

            expect(res.status).toBe(404);
            expect(res.json().error).toMatch(/not found/i);
        });

        it('should return 500 on git error', async () => {
            mockGetLocalBranchesPaginated.mockImplementation(() => { throw new Error('not a git repo'); });
            mockGetRemoteBranchesPaginated.mockImplementation(() => { throw new Error('not a git repo'); });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`);

            expect(res.status).toBe(500);
            expect(res.json().error).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/branches — createBranch
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/branches (create)', () => {
        it('should create a branch with valid name (no checkout)', async () => {
            mockCreateBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'new-branch' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockCreateBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'new-branch', false);
        });

        it('should return 400 when name is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });

        it('should return 400 when name is empty string', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: '' }),
            });

            expect(res.status).toBe(400);
        });

        it('should pass checkout=true when specified', async () => {
            mockCreateBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'feat', checkout: true }),
            });

            expect(res.status).toBe(200);
            expect(mockCreateBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feat', true);
        });

        it('should default checkout to false', async () => {
            mockCreateBranch.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'feat' }),
            });

            expect(mockCreateBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feat', false);
        });

        it('should return git failure result on error', async () => {
            mockCreateBranch.mockResolvedValue({ success: false, error: 'branch already exists' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'existing' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'branch already exists' });
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/branches/switch — switchBranch
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/branches/switch', () => {
        it('should switch to a branch', async () => {
            mockSwitchBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({ name: 'main' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockSwitchBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'main', { force: false });
        });

        it('should return 400 when name is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });

        it('should pass force=true when specified', async () => {
            mockSwitchBranch.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({ name: 'main', force: true }),
            });

            expect(mockSwitchBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'main', { force: true });
        });

        it('should return git failure result on error', async () => {
            mockSwitchBranch.mockResolvedValue({ success: false, error: 'checkout failed' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({ name: 'nonexistent' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'checkout failed' });
        });
    });

    // -----------------------------------------------------------------------
    // DELETE /api/workspaces/:id/git/branches/:name — deleteBranch
    // -----------------------------------------------------------------------

    describe('DELETE /api/workspaces/:id/git/branches/:name', () => {
        it('should delete a branch', async () => {
            mockDeleteBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/old-branch`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockDeleteBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'old-branch', false);
        });

        it('should pass force=true from query param', async () => {
            mockDeleteBranch.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/old-branch?force=true`, {
                method: 'DELETE',
            });

            expect(mockDeleteBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'old-branch', true);
        });

        it('should use force=false when query param absent', async () => {
            mockDeleteBranch.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/old-branch`, {
                method: 'DELETE',
            });

            expect(mockDeleteBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'old-branch', false);
        });

        it('should handle slash-containing branch names', async () => {
            mockDeleteBranch.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/feature%2Ffoo`, {
                method: 'DELETE',
            });

            expect(mockDeleteBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feature/foo', false);
        });

        it('should return 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/nonexistent/git/branches/any`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(404);
            expect(res.json().error).toMatch(/not found/i);
        });

        it('should return git failure result on error', async () => {
            mockDeleteBranch.mockResolvedValue({ success: false, error: 'branch not fully merged' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/unmerged`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'branch not fully merged' });
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/branches/rename — renameBranch
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/branches/rename', () => {
        it('should rename a branch', async () => {
            mockRenameBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/rename`, {
                method: 'POST',
                body: JSON.stringify({ oldName: 'old', newName: 'new' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockRenameBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'old', 'new');
        });

        it('should return 400 when oldName is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/rename`, {
                method: 'POST',
                body: JSON.stringify({ newName: 'new' }),
            });

            expect(res.status).toBe(400);
        });

        it('should return 400 when newName is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/rename`, {
                method: 'POST',
                body: JSON.stringify({ oldName: 'old' }),
            });

            expect(res.status).toBe(400);
        });

        it('should return git failure result on error', async () => {
            mockRenameBranch.mockResolvedValue({ success: false, error: 'rename failed' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/rename`, {
                method: 'POST',
                body: JSON.stringify({ oldName: 'old', newName: 'new' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'rename failed' });
        });
    });

    // -----------------------------------------------------------------------
    // GET /api/workspaces/:id/git/branch-status
    // -----------------------------------------------------------------------

    describe('GET /api/workspaces/:id/git/branch-status', () => {
        it('should return branch status', async () => {
            mockHasUncommittedChanges.mockReturnValue(true);
            mockGetBranchStatus.mockReturnValue(MOCK_BRANCH_STATUS);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-status`);
            const json = res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual(MOCK_BRANCH_STATUS);
            expect(mockHasUncommittedChanges).toHaveBeenCalledWith(WORKSPACE_ROOT);
            expect(mockGetBranchStatus).toHaveBeenCalledWith(WORKSPACE_ROOT, true);
        });

        it('should return 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/nonexistent/git/branch-status`);

            expect(res.status).toBe(404);
            expect(res.json().error).toMatch(/not found/i);
        });

        it('should return 500 on git error', async () => {
            mockHasUncommittedChanges.mockImplementation(() => { throw new Error('git failed'); });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-status`);

            expect(res.status).toBe(500);
            expect(res.json().error).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/push — Push
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/push', () => {
        it('should push with default options (no body)', async () => {
            mockPush.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockPush).toHaveBeenCalledWith(WORKSPACE_ROOT, false);
        });

        it('should pass setUpstream=true when specified', async () => {
            mockPush.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                body: JSON.stringify({ setUpstream: true }),
            });

            expect(mockPush).toHaveBeenCalledWith(WORKSPACE_ROOT, true);
        });

        it('should return failure result when push fails', async () => {
            mockPush.mockResolvedValue({ success: false, error: 'no remote' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'no remote' });
        });

        it('should succeed with empty body (no Content-Type, no body)', async () => {
            mockPush.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                // no body, no headers — regression test for 400 Bad Request bug
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockPush).toHaveBeenCalledWith(WORKSPACE_ROOT, false);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/pull — Pull
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/pull', () => {
        it('should pull with default options', async () => {
            mockPull.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockPull).toHaveBeenCalledWith(WORKSPACE_ROOT, false);
        });

        it('should pass rebase=true when specified', async () => {
            mockPull.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({ rebase: true }),
            });

            expect(mockPull).toHaveBeenCalledWith(WORKSPACE_ROOT, true);
        });

        it('should succeed with empty body (no Content-Type, no body)', async () => {
            mockPull.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                // no body, no headers — regression test for 400 Bad Request bug
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockPull).toHaveBeenCalledWith(WORKSPACE_ROOT, false);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/fetch — Fetch
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/fetch', () => {
        it('should fetch all when no remote specified', async () => {
            mockFetch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/fetch`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockFetch).toHaveBeenCalledWith(WORKSPACE_ROOT, undefined);
        });

        it('should pass remote name when specified', async () => {
            mockFetch.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/fetch`, {
                method: 'POST',
                body: JSON.stringify({ remote: 'upstream' }),
            });

            expect(mockFetch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'upstream');
        });

        it('should succeed with empty body (no Content-Type, no body)', async () => {
            mockFetch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/fetch`, {
                method: 'POST',
                // no body, no headers — matches what the SPA client sends
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockFetch).toHaveBeenCalledWith(WORKSPACE_ROOT, undefined);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/merge — Merge
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/merge', () => {
        it('should merge a valid branch', async () => {
            mockMergeBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/merge`, {
                method: 'POST',
                body: JSON.stringify({ branch: 'feature-x' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockMergeBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feature-x');
        });

        it('should return 400 when branch is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/merge`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });

        it('should return conflict result with HTTP 200', async () => {
            mockMergeBranch.mockResolvedValue({ success: false, error: 'CONFLICT' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/merge`, {
                method: 'POST',
                body: JSON.stringify({ branch: 'conflicting' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'CONFLICT' });
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/stash — Stash
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/stash', () => {
        it('should stash with message', async () => {
            mockStashChanges.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash`, {
                method: 'POST',
                body: JSON.stringify({ message: 'WIP: my message' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockStashChanges).toHaveBeenCalledWith(WORKSPACE_ROOT, 'WIP: my message');
        });

        it('should stash without message', async () => {
            mockStashChanges.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(mockStashChanges).toHaveBeenCalledWith(WORKSPACE_ROOT, undefined);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/workspaces/:id/git/stash/pop — Pop stash
    // -----------------------------------------------------------------------

    describe('POST /api/workspaces/:id/git/stash/pop', () => {
        it('should pop stash successfully', async () => {
            mockPopStash.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash/pop`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockPopStash).toHaveBeenCalledWith(WORKSPACE_ROOT);
        });

        it('should return failure when no stash entries', async () => {
            mockPopStash.mockResolvedValue({ success: false, error: 'No stash entries found.' });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash/pop`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: false, error: 'No stash entries found.' });
        });
    });
});
