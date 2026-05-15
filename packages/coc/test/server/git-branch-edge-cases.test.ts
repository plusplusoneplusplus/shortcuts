/**
 * Git Branch Edge Cases Tests
 *
 * Section 3: Branch Operation Edge Cases
 * - DELETE /branches/:name — current branch, unmerged, force, nonexistent
 * - POST /branches/rename — to existing name, current branch rename
 * - POST /branches/switch — dirty working tree (with/without stash)
 * - POST /branches — create from nonexistent base, name with slash
 *
 * Section 4: Detached HEAD State
 * - GET /branch-status when HEAD is detached
 * - GET /commits in detached HEAD
 * - POST /branches from detached HEAD
 * - POST /push from detached HEAD
 *
 * Mocks BranchService and child_process. Cross-platform compatible.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock BranchService
// ============================================================================

const mockGetBranchStatus = vi.fn();
const mockHasUncommittedChanges = vi.fn();
const mockGetLocalBranchesPaginated = vi.fn();
const mockGetRemoteBranchesPaginated = vi.fn();
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
const mockRebaseAutosquash = vi.fn();
const mockCherryPick = vi.fn();

const mockForgeExecGit = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        execGit: (...args: any[]) => mockForgeExecGit(...args),
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: vi.fn(async (...args: any[]) => mockGetBranchStatus(...args)),
            hasUncommittedChanges: vi.fn(async (...args: any[]) => mockHasUncommittedChanges(...args)),
            getLocalBranchesPaginated: mockGetLocalBranchesPaginated,
            getRemoteBranchesPaginated: mockGetRemoteBranchesPaginated,
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
            rebaseAutosquash: mockRebaseAutosquash,
            cherryPick: mockCherryPick,
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn().mockReturnValue('main'),
            getCurrentBranch: vi.fn().mockResolvedValue('main'),
            detectCommitRange: vi.fn(),
        }); }),
    };
});

// Mock child_process to prevent real git calls
const mockExecSync = vi.fn();
vi.mock('child_process', function () { return ({
    execSync: (...args: any[]) => mockExecSync(...args),
    execFileSync: vi.fn(),
}); });

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

describe('Git Branch Edge Cases', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let tmpDir: string;

    const WORKSPACE_ID = 'ws-branch-edge-test';
    const WORKSPACE_ROOT = '/test/branch-edge-repo';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-branch-edge-test-'));
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Branch Edge Repo', rootPath: WORKSPACE_ROOT },
        ]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store, undefined, tmpDir);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    beforeEach(() => {
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
        mockExecSync.mockReset();
        mockForgeExecGit.mockReset();
        mockForgeExecGit.mockReturnValue('');
        // Sensible defaults
        mockHasUncommittedChanges.mockReturnValue(false);
        mockGetBranchStatus.mockReturnValue({
            name: 'main',
            isDetached: false,
            ahead: 0,
            behind: 0,
            hasUncommittedChanges: false,
        });
    });

    // ========================================================================
    // Section 3: Branch Operation Edge Cases
    // ========================================================================

    describe('DELETE /api/workspaces/:id/git/branches/:name — edge cases', () => {
        it('returns service error when attempting to delete current branch', async () => {
            mockDeleteBranch.mockResolvedValue({
                success: false,
                error: 'CANNOT_DELETE_CURRENT_BRANCH',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/main`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toBe('CANNOT_DELETE_CURRENT_BRANCH');
        });

        it('returns error for unmerged branch without force flag', async () => {
            mockDeleteBranch.mockResolvedValue({
                success: false,
                error: 'BRANCH_NOT_MERGED',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/feature-unmerged`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toBe('BRANCH_NOT_MERGED');
            expect(mockDeleteBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feature-unmerged', false);
        });

        it('force-deletes unmerged branch when force=true is passed', async () => {
            mockDeleteBranch.mockResolvedValue({ success: true });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/feature-unmerged?force=true`,
                { method: 'DELETE' },
            );

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockDeleteBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feature-unmerged', true);
        });

        it('returns service error when deleting nonexistent branch', async () => {
            mockDeleteBranch.mockResolvedValue({
                success: false,
                error: "error: branch 'nonexistent' not found.",
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/nonexistent`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('not found');
        });
    });

    describe('POST /api/workspaces/:id/git/branches/rename — edge cases', () => {
        it('returns error when renaming to a name that already exists', async () => {
            mockRenameBranch.mockResolvedValue({
                success: false,
                error: 'BRANCH_NAME_EXISTS',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/rename`, {
                method: 'POST',
                body: JSON.stringify({ oldName: 'feature', newName: 'main' }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toBe('BRANCH_NAME_EXISTS');
        });

        it('renames current branch successfully', async () => {
            mockRenameBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/rename`, {
                method: 'POST',
                body: JSON.stringify({ oldName: 'main', newName: 'main-v2' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockRenameBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'main', 'main-v2');
        });
    });

    describe('POST /api/workspaces/:id/git/branches/switch — dirty working tree', () => {
        it('returns error from service when dirty tree blocks checkout', async () => {
            mockSwitchBranch.mockResolvedValue({
                success: false,
                error: 'DIRTY_WORKING_TREE',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({ name: 'feature', force: false }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toBe('DIRTY_WORKING_TREE');
        });

        it('succeeds when service auto-stashes and switches branch', async () => {
            // Service handles stashing internally when returning success
            mockSwitchBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({ name: 'feature', force: false }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
        });

        it('returns error when switching to nonexistent branch', async () => {
            mockSwitchBranch.mockResolvedValue({
                success: false,
                error: "pathspec 'ghost-branch' did not match any file(s) known to git",
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches/switch`, {
                method: 'POST',
                body: JSON.stringify({ name: 'ghost-branch' }),
            });

            expect(res.status).toBe(200);
            expect(res.json().success).toBe(false);
        });
    });

    describe('POST /api/workspaces/:id/git/branches — create edge cases', () => {
        it('returns error when base SHA does not exist', async () => {
            mockCreateBranch.mockResolvedValue({
                success: false,
                error: 'fatal: Not a valid object name: deadbeef',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'new-branch', baseSha: 'deadbeef00000000' }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
        });

        it('accepts branch name containing a slash (hierarchical naming)', async () => {
            mockCreateBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'feature/my-task' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockCreateBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'feature/my-task', false);
        });

        it('returns 400 when name is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Section 4: Detached HEAD State
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-status — detached HEAD', () => {
        it('returns isDetached=true and detachedHash when HEAD is detached', async () => {
            mockHasUncommittedChanges.mockReturnValue(false);
            mockGetBranchStatus.mockReturnValue({
                name: null,
                isDetached: true,
                detachedHash: 'abc1234def567890',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false,
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-status`);

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.isDetached).toBe(true);
            expect(data.detachedHash).toBe('abc1234def567890');
            expect(data.name).toBeNull();
        });
    });

    describe('GET /api/workspaces/:id/git/commits — detached HEAD', () => {
        it('returns commits from current HEAD when in detached HEAD state', async () => {
            const logOutput = [
                'abc1234def567890\nabc1234\nDetached commit\nDev\ndev@test.com\n2026-01-01T00:00:00Z\n\n',
            ].join('\0');

            mockForgeExecGit.mockImplementation((args: string[]) => {
                if (args[0] === 'log') return logOutput;
                return '';
            });
            mockGetBranchStatus.mockReturnValue({
                name: null,
                isDetached: true,
                detachedHash: 'abc1234def567890',
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: false,
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toHaveLength(1);
            expect(data.commits[0].hash).toBe('abc1234def567890');
        });
    });

    describe('POST /api/workspaces/:id/git/branches — from detached HEAD', () => {
        it('creates a branch at current commit when in detached HEAD', async () => {
            mockCreateBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branches`, {
                method: 'POST',
                body: JSON.stringify({ name: 'rescued-branch' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockCreateBranch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'rescued-branch', false);
        });
    });

    describe('POST /api/workspaces/:id/git/push — from detached HEAD', () => {
        it('returns error when push fails due to no upstream (detached HEAD)', async () => {
            mockPush.mockResolvedValue({
                success: false,
                error: 'NO_UPSTREAM: HEAD is not pointing to a branch',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('NO_UPSTREAM');
        });
    });
});
