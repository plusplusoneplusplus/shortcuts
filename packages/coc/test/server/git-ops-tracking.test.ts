/**
 * Git Ops Tracking Tests
 *
 * Section 10: Long-Running Git Ops Tracking
 * - POST /pull initiates async operation → returns { jobId } immediately with 202
 * - GET /ops/:jobId for in-progress op → returns { status: 'running' }
 * - GET /ops/:jobId after pull completes → returns { status: 'success' }
 * - GET /ops/:jobId after pull fails → returns { status: 'failed', error }
 * - GET /ops/latest → returns the most recent operation for the workspace
 * - GET /ops/nonexistent-job-id → 404
 * - POST /rebase-autosquash initiates async op → returns { jobId } with 202
 * - GET /ops/latest?op=rebase-autosquash → filters by op type
 * - Multiple workspaces → ops are isolated per workspace
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

describe('Git Ops Tracking', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let tmpDir: string;

    const WORKSPACE_ID = 'ws-ops-tracking-test';
    const WORKSPACE_ROOT = '/test/ops-tracking-repo';
    const WORKSPACE_B_ID = 'ws-ops-tracking-b';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-ops-tracking-test-'));
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Ops Tracking Repo', rootPath: WORKSPACE_ROOT },
            { id: WORKSPACE_B_ID, name: 'Ops Tracking Repo B', rootPath: '/test/ops-tracking-b' },
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
        mockPull.mockReset();
        mockRebaseAutosquash.mockReset();
        mockPush.mockReset();
        mockFetch.mockReset();
        mockExecSync.mockReset();
    });

    // ========================================================================
    // Section 10: Long-Running Git Ops Tracking
    // ========================================================================

    describe('POST /api/workspaces/:id/git/pull — async job lifecycle', () => {
        it('returns 202 with jobId immediately upon initiating pull', async () => {
            let resolveJob!: (val: any) => void;
            const slowPull = new Promise<any>(resolve => { resolveJob = resolve; });
            mockPull.mockReturnValue(slowPull);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(202);
            const data = res.json();
            expect(typeof data.jobId).toBe('string');
            expect(data.jobId.length).toBeGreaterThan(0);

            // Clean up: resolve the slow pull
            resolveJob({ success: true });
            await new Promise(resolve => setTimeout(resolve, 100));
        });

        it('GET /ops/:jobId returns status=running while pull is in progress', async () => {
            let resolveJob!: (val: any) => void;
            const slowPull = new Promise<any>(resolve => { resolveJob = resolve; });
            mockPull.mockReturnValue(slowPull);

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const { jobId } = startRes.json();

            // Query immediately before the job completes
            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            expect(jobRes.status).toBe(200);
            const job = jobRes.json();
            expect(job.status).toBe('running');
            expect(job.id).toBe(jobId);
            expect(job.op).toBe('pull');

            // Clean up
            resolveJob({ success: true });
            await new Promise(resolve => setTimeout(resolve, 100));
        });

        it('GET /ops/:jobId returns status=success after pull completes', async () => {
            mockPull.mockResolvedValue({ success: true });

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const { jobId } = startRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            expect(jobRes.status).toBe(200);
            const job = jobRes.json();
            expect(job.status).toBe('success');
            expect(job.finishedAt).toBeDefined();
        });

        it('GET /ops/:jobId returns status=failed with error after pull fails', async () => {
            mockPull.mockResolvedValue({
                success: false,
                error: 'merge conflict during pull',
            });

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const { jobId } = startRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            expect(jobRes.status).toBe(200);
            const job = jobRes.json();
            expect(job.status).toBe('failed');
            expect(job.error).toBe('merge conflict during pull');
            expect(job.finishedAt).toBeDefined();
        });
    });

    describe('GET /api/workspaces/:id/git/ops/latest', () => {
        it('returns most recent pull operation for the workspace', async () => {
            mockPull.mockResolvedValue({ success: true });

            const pullRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const { jobId } = pullRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const latestRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/latest`);
            expect(latestRes.status).toBe(200);
            const job = latestRes.json();
            expect(job.id).toBe(jobId);
            expect(job.op).toBe('pull');
        });

        it('filters by ?op=pull and returns null when no pull ops exist', async () => {
            // Fresh workspace with no pull ops
            const res = await request(`${base()}/api/workspaces/ws-fresh-ops/git/ops/latest?op=pull`);
            expect(res.status).toBe(200);
            expect(res.json()).toBeNull();
        });

        it('filters by ?op=rebase-autosquash and returns the latest rebase job', async () => {
            mockRebaseAutosquash.mockResolvedValue({ success: true });

            const rebaseRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/rebase-autosquash`, {
                method: 'POST',
            });
            const { jobId } = rebaseRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const latestRes = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/latest?op=rebase-autosquash`,
            );
            expect(latestRes.status).toBe(200);
            const job = latestRes.json();
            expect(job.id).toBe(jobId);
            expect(job.op).toBe('rebase-autosquash');
        });
    });

    describe('GET /api/workspaces/:id/git/ops/:jobId', () => {
        it('returns 404 for a nonexistent job ID', async () => {
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/nonexistent-job-id-xyz`,
            );

            expect(res.status).toBe(404);
        });

        it('returns full job details including startedAt, workspaceId, and pid', async () => {
            mockPull.mockResolvedValue({ success: true });

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const { jobId } = startRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            const job = res.json();
            expect(job.id).toBe(jobId);
            expect(job.workspaceId).toBe(WORKSPACE_ID);
            expect(job.op).toBe('pull');
            expect(job.startedAt).toBeDefined();
            expect(typeof job.pid).toBe('number');
        });
    });

    describe('POST /api/workspaces/:id/git/rebase-autosquash — async job lifecycle', () => {
        it('returns 202 with jobId for rebase-autosquash', async () => {
            mockRebaseAutosquash.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_B_ID}/git/rebase-autosquash`, {
                method: 'POST',
            });

            expect(res.status).toBe(202);
            const data = res.json();
            expect(typeof data.jobId).toBe('string');

            await new Promise(resolve => setTimeout(resolve, 200));
        });

        it('stores failed status when rebase-autosquash throws an unhandled error', async () => {
            mockRebaseAutosquash.mockRejectedValue(new Error('unexpected failure'));

            const startRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/rebase-autosquash`, {
                method: 'POST',
            });
            const { jobId } = startRes.json();

            await new Promise(resolve => setTimeout(resolve, 300));

            const jobRes = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/ops/${jobId}`);
            const job = jobRes.json();
            expect(job.status).toBe('failed');
            expect(job.error).toBe('unexpected failure');
        });
    });

    describe('Ops isolation between workspaces', () => {
        it('ops from workspace A are not visible in workspace B ops latest', async () => {
            mockPull.mockResolvedValue({ success: true });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/pull`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            await new Promise(resolve => setTimeout(resolve, 300));

            // Workspace B should not show workspace A's ops
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_B_ID}/git/ops/latest?op=pull`);
            expect(res.status).toBe(200);
            // If null, then no ops were stored for workspace B (correct isolation)
            // If non-null, it must belong to workspace B
            const job = res.json();
            if (job !== null) {
                expect(job.workspaceId).toBe(WORKSPACE_B_ID);
            }
        });
    });
});
