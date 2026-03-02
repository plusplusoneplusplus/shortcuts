/**
 * Git Branch Range API Endpoint Tests
 *
 * Tests for the four git branch-range API routes:
 * - GET /api/workspaces/:id/git/branch-range
 * - GET /api/workspaces/:id/git/branch-range/files
 * - GET /api/workspaces/:id/git/branch-range/diff
 * - GET /api/workspaces/:id/git/branch-range/files/:path/diff
 *
 * Mocks GitRangeService from pipeline-core to isolate API layer.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { gitCache } from '../src/git-cache';

// ============================================================================
// Mock GitRangeService and child_process
// ============================================================================

const mockDetectCommitRange = vi.fn();
const mockGetRangeDiff = vi.fn();
const mockGetFileDiff = vi.fn();

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSync(...args),
}));

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        GitRangeService: vi.fn().mockImplementation(() => ({
            detectCommitRange: mockDetectCommitRange,
            getRangeDiff: mockGetRangeDiff,
            getFileDiff: mockGetFileDiff,
        })),
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

const WORKSPACE_ID = 'ws-branch-test';
const WORKSPACE_ROOT = '/test/repo';
const UNKNOWN_WORKSPACE = 'ws-nonexistent';

const MOCK_RANGE = {
    baseRef: 'origin/main',
    headRef: 'HEAD',
    commitCount: 3,
    files: [
        { path: 'src/index.ts', status: 'M', additions: 10, deletions: 2, oldPath: undefined, repositoryRoot: WORKSPACE_ROOT },
        { path: 'src/utils/helper.ts', status: 'A', additions: 25, deletions: 0, oldPath: undefined, repositoryRoot: WORKSPACE_ROOT },
    ],
    additions: 35,
    deletions: 2,
    mergeBase: 'abc123def456',
    branchName: 'feature/foo',
    repositoryRoot: WORKSPACE_ROOT,
    repositoryName: 'repo',
};

const MOCK_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+import { something } from './utils';
+
 export function main() {
-    console.log('hello');
+    console.log('hello world');
 }`;

const MOCK_FILE_DIFF = `diff --git a/src/utils/helper.ts b/src/utils/helper.ts
new file mode 100644
--- /dev/null
+++ b/src/utils/helper.ts
@@ -0,0 +1,5 @@
+export function helper() {
+    return 42;
+}`;

// ============================================================================
// Test Suite
// ============================================================================

describe('Git Branch Range API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const base = () => `http://127.0.0.1:${port}`;

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
        mockDetectCommitRange.mockReset();
        mockGetRangeDiff.mockReset();
        mockGetFileDiff.mockReset();
        mockExecSync.mockReset();
        gitCache.clear();
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/branch-range
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-range', () => {
        it('returns GitCommitRange when on a feature branch', async () => {
            mockDetectCommitRange.mockReturnValue(MOCK_RANGE);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.baseRef).toBe('origin/main');
            expect(data.headRef).toBe('HEAD');
            expect(data.commitCount).toBe(3);
            expect(data.branchName).toBe('feature/foo');
            expect(data.files).toHaveLength(2);
            expect(data.additions).toBe(35);
            expect(data.deletions).toBe(2);
        });

        it('returns onDefaultBranch when detectCommitRange returns null', async () => {
            mockDetectCommitRange.mockReturnValue(null);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ onDefaultBranch: true });
        });

        it('returns onDefaultBranch on git error', async () => {
            mockDetectCommitRange.mockImplementation(() => { throw new Error('not a git repo'); });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ onDefaultBranch: true });
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${UNKNOWN_WORKSPACE}/git/branch-range`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/branch-range/files
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-range/files', () => {
        it('returns file list when on feature branch', async () => {
            mockDetectCommitRange.mockReturnValue(MOCK_RANGE);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.files).toHaveLength(2);
            expect(data.files[0].path).toBe('src/index.ts');
            expect(data.files[0].status).toBe('M');
            expect(data.files[1].path).toBe('src/utils/helper.ts');
            expect(data.files[1].status).toBe('A');
        });

        it('returns empty files when on default branch', async () => {
            mockDetectCommitRange.mockReturnValue(null);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ files: [] });
        });

        it('returns empty files on git error', async () => {
            mockDetectCommitRange.mockImplementation(() => { throw new Error('git error'); });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ files: [] });
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${UNKNOWN_WORKSPACE}/git/branch-range/files`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/branch-range/diff
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-range/diff', () => {
        it('returns diff string when on feature branch', async () => {
            mockDetectCommitRange.mockReturnValue(MOCK_RANGE);
            mockGetRangeDiff.mockReturnValue(MOCK_DIFF);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(MOCK_DIFF);
            expect(mockGetRangeDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'origin/main', 'HEAD');
        });

        it('returns empty diff when on default branch', async () => {
            mockDetectCommitRange.mockReturnValue(null);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/diff`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ diff: '' });
            expect(mockGetRangeDiff).not.toHaveBeenCalled();
        });

        it('returns empty diff on git error', async () => {
            mockDetectCommitRange.mockImplementation(() => { throw new Error('git error'); });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/diff`);
            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ diff: '' });
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${UNKNOWN_WORKSPACE}/git/branch-range/diff`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/branch-range/files/*/diff
    // ========================================================================

    describe('GET /api/workspaces/:id/git/branch-range/files/*/diff', () => {
        it('returns per-file diff when on feature branch', async () => {
            mockDetectCommitRange.mockReturnValue(MOCK_RANGE);
            mockGetFileDiff.mockReturnValue(MOCK_FILE_DIFF);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/src/index.ts/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(MOCK_FILE_DIFF);
            expect(data.path).toBe('src/index.ts');
            expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'origin/main', 'HEAD', 'src/index.ts');
        });

        it('returns empty diff when on default branch', async () => {
            mockDetectCommitRange.mockReturnValue(null);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/src/index.ts/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe('');
            expect(data.path).toBe('src/index.ts');
        });

        it('returns empty diff on git error', async () => {
            mockDetectCommitRange.mockImplementation(() => { throw new Error('git error'); });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/src/index.ts/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe('');
            expect(data.path).toBe('src/index.ts');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${UNKNOWN_WORKSPACE}/git/branch-range/files/src/index.ts/diff`);
            expect(res.status).toBe(404);
        });

        it('handles file paths with slashes', async () => {
            mockDetectCommitRange.mockReturnValue(MOCK_RANGE);
            mockGetFileDiff.mockReturnValue('diff content');

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/src/utils/helper.ts/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.path).toBe('src/utils/helper.ts');
            expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'origin/main', 'HEAD', 'src/utils/helper.ts');
        });

        it('handles URL-encoded file paths', async () => {
            mockDetectCommitRange.mockReturnValue(MOCK_RANGE);
            mockGetFileDiff.mockReturnValue('diff content');

            const encodedPath = encodeURIComponent('src/my file.ts');
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files/${encodedPath}/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.path).toBe('src/my file.ts');
            expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'origin/main', 'HEAD', 'src/my file.ts');
        });
    });
});
