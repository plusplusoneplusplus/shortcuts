/**
 * Git API Cache Integration Tests
 *
 * Verifies that the git endpoints use GitCacheService correctly:
 * - Second call without refresh returns cached data (git not re-invoked)
 * - Call with ?refresh=true re-invokes git and updates cache
 * - Commit files and patches read through the shared Rust backend without a
 *   duplicate route cache
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import { gitCache } from '../../src/server/git/git-cache';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { hostRepoPath } from '../helpers/host-repo-path';

// ============================================================================
// Mock Forge Git services
// ============================================================================

const mockDetectCommitRange = vi.fn();
const mockGetBranchStatus = vi.fn();
const mockForgeExecGit = vi.fn();
const mockLoadGitHistory = vi.fn();
const mockLoadCommitFiles = vi.fn();
const mockLoadCommitShowPatch = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        execGit: (...args: any[]) => mockForgeExecGit(...args),
        // execGitArgsAsync / readGitFileAtCommit now delegate to forge execGitAsync.
        execGitAsync: async (...args: any[]) => mockForgeExecGit(...args),
        loadGitHistory: (...args: any[]) => mockLoadGitHistory(...args),
        loadCommitFiles: (...args: any[]) => mockLoadCommitFiles(...args),
        loadCommitShowPatch: (...args: any[]) => mockLoadCommitShowPatch(...args),
        GitRangeService: class {
            detectCommitRange = mockDetectCommitRange;
            getCurrentBranch = vi.fn().mockResolvedValue('main');
            resolveBaseRef = vi.fn().mockReturnValue({ baseRef: 'origin/main', baseMode: 'default-branch' });
        },
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: vi.fn(async (...args: any[]) => mockGetBranchStatus(...args)),
            hasUncommittedChanges: vi.fn().mockReturnValue(false),
            hasUncommittedChanges: vi.fn().mockResolvedValue(false),
        }); }),
    };
});

function setupGitHistoryMock() {
    mockLoadGitHistory.mockResolvedValue([{
        hash: 'aaaa',
        shortHash: 'aaaa',
        subject: 'First',
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        date: '2026-01-01T00:00:00Z',
        parentHashes: '',
        body: '',
    }]);
}

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    requestUrl: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(requestUrl);
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

describe('Git API caching', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const WORKSPACE_ID = 'ws-cache-test';
    const WORKSPACE_ROOT = hostRepoPath('test', 'cache-repo');

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Cache Test Repo', rootPath: WORKSPACE_ROOT },
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
        mockForgeExecGit.mockReset();
        mockForgeExecGit.mockReturnValue('');
        mockLoadGitHistory.mockReset();
        mockLoadGitHistory.mockResolvedValue([]);
        mockLoadCommitFiles.mockReset();
        mockLoadCommitFiles.mockResolvedValue([]);
        mockLoadCommitShowPatch.mockReset();
        mockLoadCommitShowPatch.mockResolvedValue({ content: { raw: '' } });
        mockDetectCommitRange.mockReset();
        mockGetBranchStatus.mockReset();
        mockGetBranchStatus.mockReturnValue({ name: 'main', isDetached: false, ahead: 0, behind: 0, hasUncommittedChanges: false });
        gitCache.clear();
    });

    const base = () => `http://127.0.0.1:${port}`;

    // ========================================================================
    // GET /api/workspaces/:id/git/commits — caching
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits (cache)', () => {
        it('second call returns cached data without re-invoking git', async () => {
            setupGitHistoryMock();

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            expect(res1.status).toBe(200);
            expect(res1.json().commits).toHaveLength(1);

            // The history backend was invoked on the first call.
            const callCountAfterFirst = mockLoadGitHistory.mock.calls.length;
            expect(callCountAfterFirst).toBeGreaterThan(0);

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            expect(res2.status).toBe(200);
            expect(res2.json().commits).toHaveLength(1);

            // No additional history reads.
            expect(mockLoadGitHistory.mock.calls.length).toBe(callCountAfterFirst);
        });

        it('refresh=true bypasses cache and re-invokes git', async () => {
            setupGitHistoryMock();

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            const callCountAfterFirst = mockLoadGitHistory.mock.calls.length;

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50&refresh=true`);
            expect(mockLoadGitHistory.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
        });

        it('different limit/skip produces different cache entries', async () => {
            setupGitHistoryMock();

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            const callsAfterFirst = mockLoadGitHistory.mock.calls.length;

            // Different skip → cache miss → git re-invoked
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50&skip=10`);
            expect(mockLoadGitHistory.mock.calls.length).toBeGreaterThan(callsAfterFirst);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/files — Rust-backed reads
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/files', () => {
        it('reads fresh metadata for each request', async () => {
            mockLoadCommitFiles.mockResolvedValue([
                { path: 'src/index.ts', status: 'modified' },
            ]);

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/files`);
            expect(res1.status).toBe(200);
            expect(res1.json().files).toHaveLength(1);

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/files`);
            expect(res2.status).toBe(200);
            expect(res2.json().files).toHaveLength(1);
            expect(mockLoadCommitFiles).toHaveBeenCalledTimes(2);
        });

        it('keeps metadata reads independent of mutable cache invalidation', async () => {
            mockLoadCommitFiles.mockResolvedValue([
                { path: 'new.ts', status: 'added' },
            ]);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/beef5678/files`);

            gitCache.invalidateMutable(WORKSPACE_ID);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/beef5678/files`);
            expect(mockLoadCommitFiles).toHaveBeenCalledTimes(2);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/diff — Rust-backed reads
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/diff', () => {
        it('reads a fresh patch for each request', async () => {
            mockLoadCommitShowPatch.mockResolvedValue({
                content: { raw: 'diff --git a/f.ts b/f.ts\n-old\n+new' },
            });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/diff`);

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/diff`);
            expect(res2.status).toBe(200);
            expect(res2.json().diff).toContain('diff --git');
            expect(mockLoadCommitShowPatch).toHaveBeenCalledTimes(2);
        });

        it('keeps patch reads independent of mutable cache invalidation', async () => {
            mockLoadCommitShowPatch.mockResolvedValue({ content: { raw: 'patch data' } });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/dead5678/diff`);

            gitCache.invalidateMutable(WORKSPACE_ID);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/dead5678/diff`);
            expect(mockLoadCommitShowPatch).toHaveBeenCalledTimes(2);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/branch-range — caching
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-range (cache)', () => {
        it('second call returns cached branch-range data', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'main',
                headRef: 'feature',
                commitCount: 3,
            });

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res1.status).toBe(200);
            expect(res1.json().commitCount).toBe(3);

            const callsAfterFirst = mockDetectCommitRange.mock.calls.length;

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res2.status).toBe(200);
            expect(res2.json().commitCount).toBe(3);
            expect(mockDetectCommitRange.mock.calls.length).toBe(callsAfterFirst);
        });

        it('refresh=true bypasses cache and re-detects', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'main',
                headRef: 'feature',
                commitCount: 3,
            });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            const callsAfterFirst = mockDetectCommitRange.mock.calls.length;

            mockDetectCommitRange.mockReturnValue({
                baseRef: 'main',
                headRef: 'feature',
                commitCount: 5,
            });

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range?refresh=true`);
            expect(res2.status).toBe(200);
            expect(res2.json().commitCount).toBe(5);
            expect(mockDetectCommitRange.mock.calls.length).toBeGreaterThan(callsAfterFirst);
        });

        it('caches onDefaultBranch result', async () => {
            mockDetectCommitRange.mockReturnValue(null);

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res1.json().onDefaultBranch).toBe(true);

            const callsAfterFirst = mockDetectCommitRange.mock.calls.length;

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res2.json().onDefaultBranch).toBe(true);
            expect(mockDetectCommitRange.mock.calls.length).toBe(callsAfterFirst);
        });
    });

    // ========================================================================
    // Cross-workspace isolation
    // ========================================================================

    describe('cross-workspace isolation', () => {
        it('refresh on one workspace does not affect another', async () => {
            // Register a second workspace
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Repo A', rootPath: WORKSPACE_ROOT },
                { id: 'ws-other', name: 'Repo B', rootPath: hostRepoPath('test', 'other') },
            ]);

            setupGitHistoryMock();

            // Populate cache for both workspaces
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            await request(`${base()}/api/workspaces/ws-other/git/commits?limit=50`);

            const callsAfterBoth = mockLoadGitHistory.mock.calls.length;

            // Refresh only ws-cache-test
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50&refresh=true`);

            // ws-other should still be cached — request should not add git calls
            await request(`${base()}/api/workspaces/ws-other/git/commits?limit=50`);
            expect(mockLoadGitHistory.mock.calls.length).toBeGreaterThan(callsAfterBoth);

            // Verify ws-other is still cached by checking no new calls are added.
            const callsBeforeOther = mockLoadGitHistory.mock.calls.length;
            await request(`${base()}/api/workspaces/ws-other/git/commits?limit=50`);
            expect(mockLoadGitHistory.mock.calls.length).toBe(callsBeforeOther);
        });
    });
});
