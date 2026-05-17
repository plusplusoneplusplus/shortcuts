/**
 * Git Branch Range Edge Cases Tests
 *
 * Section 9: Branch Range Operations
 * - GET /branch-range?base=main&head=main (same ref) → 200, empty/onDefaultBranch response
 * - GET /branch-range?base=nonexistent&head=main → onDefaultBranch (service returns null or throws)
 * - GET /branch-range/diff for range with large diff → completes within timeout
 * - GET /branch-range/files/:file/diff for file only in head → 200, shown as added
 * - GET /branch-range/files/:file/diff for file deleted in head → 200, shown as deleted
 * - GET /branch-range/files/:file/diff for nonexistent file → 200 with empty diff (service returns empty)
 * - GET /branch-range/files when range has no changed files → 200, empty files list
 *
 * Mocks GitRangeService. Cross-platform compatible.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { gitCache } from '../../src/server/git/git-cache';

// ============================================================================
// Mock GitRangeService and child_process
// ============================================================================

const mockDetectCommitRange = vi.fn();
const mockGetRangeDiff = vi.fn();
const mockGetFileDiff = vi.fn();

const mockExecSync = vi.fn();
vi.mock('child_process', function () { return ({
    execSync: (...args: any[]) => mockExecSync(...args),
}); });

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            detectCommitRange: mockDetectCommitRange,
            getRangeDiff: mockGetRangeDiff,
            getFileDiff: mockGetFileDiff,
            getCurrentBranch: vi.fn().mockReturnValue('main'),
            getCurrentBranch: vi.fn().mockResolvedValue('main'),
        }); }),
    };
});

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
// Fixtures
// ============================================================================

const WORKSPACE_ID = 'ws-branch-range-edge-test';
const WORKSPACE_ROOT = '/test/branch-range-repo';

const ADDED_FILE_DIFF = `diff --git a/only-in-head.txt b/only-in-head.txt
new file mode 100644
--- /dev/null
+++ b/only-in-head.txt
@@ -0,0 +1,3 @@
+new content
+more content
+end`;

const DELETED_FILE_DIFF = `diff --git a/deleted-in-head.txt b/deleted-in-head.txt
deleted file mode 100644
--- a/deleted-in-head.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-old content
-more old content`;

const LARGE_DIFF = '-changed\n+changed\n'.repeat(500); // 1000-line changed file simulation

// ============================================================================
// Test Suite
// ============================================================================

describe('Git Branch Range Edge Cases', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Branch Range Repo', rootPath: WORKSPACE_ROOT },
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
        mockDetectCommitRange.mockReset();
        mockGetRangeDiff.mockReset();
        mockGetFileDiff.mockReset();
        mockExecSync.mockReset();
        gitCache.clear();
    });

    // ========================================================================
    // Section 9: Branch Range Operations
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-range — same ref edge case', () => {
        it('returns onDefaultBranch when base and head are the same ref (no commits in range)', async () => {
            // When base === head, there are no commits — service returns null
            mockDetectCommitRange.mockReturnValue(null);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range?base=main&head=main`,
            );

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ onDefaultBranch: true });
        });

        it('returns onDefaultBranch when base ref does not exist', async () => {
            // Nonexistent base: service throws or returns null
            mockDetectCommitRange.mockImplementation(() => {
                throw new Error("fatal: ambiguous argument 'nonexistent': unknown revision");
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range?base=nonexistent&head=main`,
            );

            // API returns onDefaultBranch on any git error (documented behavior)
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ onDefaultBranch: true });
        });
    });

    describe('GET /api/workspaces/:id/git/branch-range/diff — large diff', () => {
        it('returns large diff response within normal timeout', async () => {
            const mockRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [{ path: 'large-file.ts', status: 'M', additions: 500, deletions: 500 }],
                additions: 500,
                deletions: 500,
                mergeBase: 'abc123',
                branchName: 'feature/large',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            };
            mockDetectCommitRange.mockReturnValue(mockRange);
            mockGetRangeDiff.mockReturnValue(LARGE_DIFF);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(LARGE_DIFF);
            expect(data.diff.length).toBeGreaterThan(1000);
        });
    });

    describe('GET /api/workspaces/:id/git/branch-range/files/*/diff — added and deleted files', () => {
        it('shows file as added when it only exists in head', async () => {
            const mockRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [{ path: 'only-in-head.txt', status: 'A', additions: 3, deletions: 0 }],
                additions: 3,
                deletions: 0,
                mergeBase: 'abc123',
                branchName: 'feature/add',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            };
            mockDetectCommitRange.mockReturnValue(mockRange);
            mockGetFileDiff.mockReturnValue(ADDED_FILE_DIFF);

            const filePath = encodeURIComponent('only-in-head.txt');
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/${filePath}/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toContain('new file mode');
            expect(data.diff).toContain('+new content');
        });

        it('shows file as deleted when it was removed in head', async () => {
            const mockRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [{ path: 'deleted-in-head.txt', status: 'D', additions: 0, deletions: 2 }],
                additions: 0,
                deletions: 2,
                mergeBase: 'abc123',
                branchName: 'feature/delete',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            };
            mockDetectCommitRange.mockReturnValue(mockRange);
            mockGetFileDiff.mockReturnValue(DELETED_FILE_DIFF);

            const filePath = encodeURIComponent('deleted-in-head.txt');
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/${filePath}/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toContain('deleted file mode');
            expect(data.diff).toContain('-old content');
        });

        it('returns 200 with empty diff when file does not exist in the range', async () => {
            const mockRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [],
                additions: 0,
                deletions: 0,
                mergeBase: 'abc123',
                branchName: 'feature/empty',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            };
            mockDetectCommitRange.mockReturnValue(mockRange);
            // File not in range — service returns empty string
            mockGetFileDiff.mockReturnValue('');

            const filePath = encodeURIComponent('nonexistent.txt');
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/${filePath}/diff`,
            );

            expect(res.status).toBe(200);
            expect(res.json().diff).toBe('');
        });
    });

    describe('GET /api/workspaces/:id/git/branch-range/files — empty range', () => {
        it('returns empty file list when range has no changed files', async () => {
            const mockRange = {
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 0,
                files: [],
                additions: 0,
                deletions: 0,
                mergeBase: 'abc123',
                branchName: 'feature/empty',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            };
            mockDetectCommitRange.mockReturnValue(mockRange);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.files).toEqual([]);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(
                `${base()}/api/workspaces/ws-does-not-exist/git/branch-range/files`,
            );

            expect(res.status).toBe(404);
        });
    });
});
