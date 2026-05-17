/**
 * Git Conflict Scenario Tests
 *
 * Section 1: Merge Conflicts
 * - POST /api/workspaces/:id/git/merge with conflicting branches
 * - Conflict response body with conflicting files
 * - GET /branch-status after conflict → merging state
 * - POST /reset --hard after failed merge → working tree restored
 *
 * Section 2: Rebase and Cherry-Pick Conflicts
 * - POST /rebase-autosquash failure stored in ops store
 * - POST /cherry-pick happy path → 200
 * - POST /cherry-pick with conflicts → 409
 * - POST /cherry-pick nonexistent hash → 400
 * - POST /cherry-pick with missing hash field → 400
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
const mockMergeBranch = vi.fn();
const mockCherryPick = vi.fn();
const mockRebaseAutosquash = vi.fn();
const mockStashChanges = vi.fn();
const mockPopStash = vi.fn();
const mockSwitchBranch = vi.fn();
const mockDeleteBranch = vi.fn();
const mockRenameBranch = vi.fn();
const mockCreateBranch = vi.fn();
const mockPush = vi.fn();
const mockPull = vi.fn();
const mockFetch = vi.fn();

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
            mergeBranch: mockMergeBranch,
            cherryPick: mockCherryPick,
            rebaseAutosquash: mockRebaseAutosquash,
            stashChanges: mockStashChanges,
            popStash: mockPopStash,
            switchBranch: mockSwitchBranch,
            deleteBranch: mockDeleteBranch,
            renameBranch: mockRenameBranch,
            createBranch: mockCreateBranch,
            push: mockPush,
            pull: mockPull,
            fetch: mockFetch,
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
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

describe('Git Conflict Scenarios', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let tmpDir: string;

    const WORKSPACE_ID = 'ws-conflict-test';
    const WORKSPACE_ROOT = '/test/conflict-repo';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-conflict-test-'));
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Conflict Repo', rootPath: WORKSPACE_ROOT },
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
        mockMergeBranch.mockReset();
        mockCherryPick.mockReset();
        mockRebaseAutosquash.mockReset();
        mockExecSync.mockReset();
        mockForgeExecGit.mockReset();
        mockForgeExecGit.mockReturnValue('');
        // Sensible defaults
        mockHasUncommittedChanges.mockReturnValue(false);
        mockGetBranchStatus.mockReturnValue({ name: 'main', isDetached: false, ahead: 0, behind: 0, hasUncommittedChanges: false });
    });

    // ========================================================================
    // Section 1: Merge Conflicts
    // ========================================================================

    describe('POST /api/workspaces/:id/git/merge — merge conflicts', () => {
        it('returns service result with conflicting file list on merge conflict', async () => {
            mockMergeBranch.mockResolvedValue({
                success: false,
                error: 'MERGE_CONFLICT',
                conflicts: ['src/file.txt', 'src/utils.ts'],
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/merge`, {
                method: 'POST',
                body: JSON.stringify({ branch: 'feature' }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toBe('MERGE_CONFLICT');
            expect(data.conflicts).toEqual(['src/file.txt', 'src/utils.ts']);
        });

        it('returns 400 when branch field is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/merge`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });

        it('returns success when merge completes without conflict', async () => {
            mockMergeBranch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/merge`, {
                method: 'POST',
                body: JSON.stringify({ branch: 'clean-feature' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/nonexistent-ws/git/merge`, {
                method: 'POST',
                body: JSON.stringify({ branch: 'feature' }),
            });

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/workspaces/:id/git/branch-status after conflict — merging state', () => {
        it('reflects merging state when service returns merging=true', async () => {
            mockHasUncommittedChanges.mockReturnValue(true);
            mockGetBranchStatus.mockReturnValue({
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true,
                merging: true,
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-status`);

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.merging).toBe(true);
            expect(data.hasUncommittedChanges).toBe(true);
        });
    });

    describe('POST /api/workspaces/:id/git/reset after merge conflict', () => {
        it('hard-reset after failed merge restores working tree', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/reset`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'HEAD', mode: 'hard' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockForgeExecGit).toHaveBeenCalledWith(
                ['reset', '--hard', 'HEAD'],
                WORKSPACE_ROOT,
                expect.anything(),
            );
        });
    });

    // ========================================================================
    // Section 2: Rebase and Cherry-Pick Conflicts
    // ========================================================================

    describe('POST /api/workspaces/:id/git/rebase-autosquash — rebase failures', () => {
        it('stores failed status in ops store when rebase fails with conflict', async () => {
            mockRebaseAutosquash.mockResolvedValue({
                success: false,
                error: 'REBASE_CONFLICT: conflict in src/index.ts',
            });

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/rebase-autosquash`, {
                method: 'POST',
            });

            expect(startRes.status).toBe(202);
            const { jobId } = startRes.json();
            expect(typeof jobId).toBe('string');

            // Wait for background job to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            expect(jobRes.status).toBe(200);
            const job = jobRes.json();
            expect(job.status).toBe('failed');
            expect(job.error).toContain('REBASE_CONFLICT');
        });

        it('branch-status after rebase failure reflects rebasing state when service sets it', async () => {
            mockHasUncommittedChanges.mockReturnValue(true);
            mockGetBranchStatus.mockReturnValue({
                name: 'main',
                isDetached: false,
                ahead: 0,
                behind: 0,
                hasUncommittedChanges: true,
                rebasing: true,
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-status`);

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.rebasing).toBe(true);
        });

        it('stores success status when rebase completes cleanly', async () => {
            mockRebaseAutosquash.mockResolvedValue({ success: true });

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/rebase-autosquash`, {
                method: 'POST',
            });

            expect(startRes.status).toBe(202);
            const { jobId } = startRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            const job = jobRes.json();
            expect(job.status).toBe('success');
        });
    });

    describe('POST /api/workspaces/:id/git/cherry-pick', () => {
        it('returns 200 when cherry-pick applies commit successfully', async () => {
            mockCherryPick.mockResolvedValue({
                success: true,
                conflicts: false,
                message: 'applied abc1234',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'abc1234ef567890' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockCherryPick).toHaveBeenCalledWith(WORKSPACE_ROOT, 'abc1234ef567890');
        });

        it('returns 409 when cherry-pick produces conflicts', async () => {
            mockCherryPick.mockResolvedValue({
                success: false,
                conflicts: true,
                message: 'CONFLICT (content): Merge conflict in src/index.ts',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'conflicting1234' }),
            });

            expect(res.status).toBe(409);
            const data = res.json();
            expect(data.conflicts).toBe(true);
            expect(data.error).toContain('CONFLICT');
        });

        it('returns 400 when cherry-pick fails for a non-conflict reason', async () => {
            // e.g., nonexistent commit hash or already-applied commit
            mockCherryPick.mockResolvedValue({
                success: false,
                conflicts: false,
                message: "fatal: bad object 'nonexistent'",
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'nonexistent000' }),
            });

            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Cherry-pick failed');
        });

        it('returns 400 when hash field is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });

        it('returns 400 for already-applied commit (empty commit, no changes)', async () => {
            // git cherry-pick of an already-applied commit is not a conflict —
            // service returns success: false, conflicts: false
            mockCherryPick.mockResolvedValue({
                success: false,
                conflicts: false,
                message: 'The previous cherry-pick is now empty, possibly due to conflict resolution.',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'alreadyapplied' }),
            });

            // Documented behavior: already-applied commit → 400 (not 409, since no conflicts flag)
            expect(res.status).toBe(400);
        });

        it('returns 409 when cherry-picking onto a branch produces staged conflicts', async () => {
            // Cherry-pick onto dirty/conflicting state → service signals conflicts
            mockCherryPick.mockResolvedValue({
                success: false,
                conflicts: true,
                message: 'Cherry-pick resulted in conflicts',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'abc1234' }),
            });

            expect(res.status).toBe(409);
            expect(res.json().conflicts).toBe(true);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/ws-does-not-exist/git/cherry-pick`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'abc1234' }),
            });

            expect(res.status).toBe(404);
        });
    });
});
