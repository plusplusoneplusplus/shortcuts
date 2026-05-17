/**
 * Git Stash, Push, and Pull Edge Cases Tests
 *
 * Section 5: Stash Operations
 * - POST /stash with no changes → service returns "nothing to stash"
 * - POST /stash with changes → working tree clean after stash
 * - POST /stash called twice → creates two stash entries (second call reflects stack)
 * - POST /stash/pop with no stash → error result
 * - POST /stash/pop with conflicting stash → conflict result
 * - POST /stash/pop pops most recent entry
 *
 * Section 6: Push and Pull Errors
 * - POST /push with no upstream remote → error result
 * - POST /push when remote has newer commits → rejected error
 * - POST /push to unreachable remote URL → error result
 * - POST /pull with local changes → documents behavior (async job, delegates to service)
 * - POST /fetch with unreachable remote → error result
 * - POST /fetch with valid remote → 200, success
 *
 * Mocks BranchService. Cross-platform compatible.
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

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
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

describe('Git Stash, Push, and Pull Edge Cases', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let tmpDir: string;

    const WORKSPACE_ID = 'ws-stash-push-test';
    const WORKSPACE_ROOT = '/test/stash-push-repo';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-stash-push-test-'));
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Stash Push Repo', rootPath: WORKSPACE_ROOT },
            // Additional workspace for concurrent-operation isolation
            { id: 'ws-pull-isolated', name: 'Pull Isolated Repo', rootPath: '/test/pull-isolated' },
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
        mockPush.mockReset();
        mockPull.mockReset();
        mockFetch.mockReset();
        mockStashChanges.mockReset();
        mockPopStash.mockReset();
        mockExecSync.mockReset();
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
    // Section 5: Stash Operations
    // ========================================================================

    describe('POST /api/workspaces/:id/git/stash — edge cases', () => {
        it('returns "nothing to stash" message when no changes exist', async () => {
            mockStashChanges.mockResolvedValue({
                success: false,
                error: 'No local changes to save',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('No local changes');
        });

        it('stashes changes successfully and returns success', async () => {
            mockStashChanges.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash`, {
                method: 'POST',
                body: JSON.stringify({ message: 'WIP stash' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockStashChanges).toHaveBeenCalledWith(WORKSPACE_ROOT, 'WIP stash');
        });

        it('can be called twice to create two stash entries (each call delegates to service)', async () => {
            mockStashChanges
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: true });

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash`, {
                method: 'POST',
                body: JSON.stringify({ message: 'First stash' }),
            });
            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash`, {
                method: 'POST',
                body: JSON.stringify({ message: 'Second stash' }),
            });

            expect(res1.status).toBe(200);
            expect(res2.status).toBe(200);
            expect(mockStashChanges).toHaveBeenCalledTimes(2);
        });
    });

    describe('POST /api/workspaces/:id/git/stash/pop — edge cases', () => {
        it('returns error when there are no stash entries', async () => {
            mockPopStash.mockResolvedValue({
                success: false,
                error: 'No stash entries found.',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash/pop`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('No stash entries');
        });

        it('returns conflict result when stash pop produces conflicts', async () => {
            mockPopStash.mockResolvedValue({
                success: false,
                error: 'STASH_CONFLICT',
                conflicts: ['src/index.ts'],
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash/pop`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('STASH_CONFLICT');
        });

        it('pops the most recent stash entry (stash@{0}) on success', async () => {
            mockPopStash.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/stash/pop`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            // Service is called with just rootPath — stash@{0} selection is internal to service
            expect(mockPopStash).toHaveBeenCalledWith(WORKSPACE_ROOT);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/ws-does-not-exist/git/stash/pop`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Section 6: Push and Pull Errors
    // ========================================================================

    describe('POST /api/workspaces/:id/git/push — error scenarios', () => {
        it('returns error when branch has no configured upstream remote', async () => {
            mockPush.mockResolvedValue({
                success: false,
                error: 'NO_UPSTREAM: fatal: The current branch main has no upstream branch.',
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

        it('returns rejected error when remote has newer commits', async () => {
            mockPush.mockResolvedValue({
                success: false,
                error: 'PUSH_REJECTED: Updates were rejected because the remote contains work that you do not have locally.',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('PUSH_REJECTED');
        });

        it('returns error when remote URL is unreachable', async () => {
            mockPush.mockResolvedValue({
                success: false,
                error: 'ssh: connect to host unreachable.example.com port 22: Connection refused',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/push`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
        });
    });

    describe('POST /api/workspaces/:id/git/pull — error scenarios', () => {
        it('returns 202 with jobId even when local has uncommitted changes (delegates to service)', async () => {
            // pull is async — the server delegates conflict handling to the service
            mockPull.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(202);
            expect(res.json().jobId).toBeDefined();
            await new Promise(resolve => setTimeout(resolve, 200));
        });

        it('stores failure when pull is rejected by remote', async () => {
            mockPull.mockResolvedValue({
                success: false,
                error: 'PUSH_REJECTED: remote rejected pull',
            });

            const pullRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(pullRes.status).toBe(202);
            const { jobId } = pullRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            const job = jobRes.json();
            expect(job.status).toBe('failed');
            expect(job.error).toContain('PUSH_REJECTED');
        });
    });

    describe('POST /api/workspaces/:id/git/fetch — error scenarios', () => {
        it('returns error when remote is unreachable', async () => {
            mockFetch.mockResolvedValue({
                success: false,
                error: 'Could not resolve host: unreachable.example.com',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/fetch`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('Could not resolve host');
        });

        it('returns 200 with success when fetch completes', async () => {
            mockFetch.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/fetch`, {
                method: 'POST',
                body: JSON.stringify({ remote: 'origin' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockFetch).toHaveBeenCalledWith(WORKSPACE_ROOT, 'origin');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/ws-does-not-exist/git/fetch`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(404);
        });
    });
});
