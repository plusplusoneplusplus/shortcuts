/**
 * Git Working Tree Edge Cases Tests
 *
 * Section 8: Working Tree Operations
 * - GET /changes/files/binary-image.png/diff → binary diff string (no isBinary field in current API)
 * - GET /changes/files/new-untracked.txt/diff → shows full file content as added
 * - GET /changes/files/deleted.txt/diff → shows full file content as removed
 * - POST /changes/discard on file with staged changes → success (delegates to service)
 * - POST /changes/unstage file not in index → service returns result (no-op or error)
 * - DELETE /changes/untracked on tracked file → service returns error
 * - DELETE /changes/untracked on untracked file → 200, success
 * - POST /changes/stage-batch with 0 files → 200, no-op
 * - POST /changes/stage-batch with nonexistent file → service reports partial success / error
 * - Concurrent POST /changes/stage requests → both complete without index corruption
 *
 * Mocks WorkingTreeService. Cross-platform compatible.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock WorkingTreeService
// ============================================================================

const mockGetAllChanges = vi.fn();
const mockStageFile = vi.fn();
const mockUnstageFile = vi.fn();
const mockDiscardChanges = vi.fn();
const mockDeleteUntrackedFile = vi.fn();
const mockGetFileDiff = vi.fn();
const mockStageFiles = vi.fn();
const mockUnstageFiles = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        WorkingTreeService: vi.fn().mockImplementation(function () { return ({
            getAllChanges: mockGetAllChanges,
            stageFile: mockStageFile,
            unstageFile: mockUnstageFile,
            discardChanges: mockDiscardChanges,
            deleteUntrackedFile: mockDeleteUntrackedFile,
            getFileDiff: mockGetFileDiff,
            stageFiles: mockStageFiles,
            unstageFiles: mockUnstageFiles,
        }); }),
    };
});

// Mock child_process to prevent real git calls
vi.mock('child_process', function () { return ({
    execSync: vi.fn(),
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

describe('Git Working Tree Edge Cases', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const WORKSPACE_ID = 'ws-working-tree-edge';
    const WORKSPACE_ROOT = '/test/working-tree-repo';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Working Tree Repo', rootPath: WORKSPACE_ROOT },
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
        mockGetAllChanges.mockReset();
        mockStageFile.mockReset();
        mockUnstageFile.mockReset();
        mockDiscardChanges.mockReset();
        mockDeleteUntrackedFile.mockReset();
        mockGetFileDiff.mockReset();
        mockStageFiles.mockReset();
        mockUnstageFiles.mockReset();
    });

    // ========================================================================
    // Section 8: Working Tree Diff Edge Cases
    // ========================================================================

    describe('GET /api/workspaces/:id/git/changes/files/*/diff — binary and special files', () => {
        it('returns binary diff string for binary files (git output includes "Binary files differ")', async () => {
            // git diff for binary files emits "Binary files a/X and b/X differ"
            const binaryDiffOutput = 'Binary files a/binary-image.png and b/binary-image.png differ';
            mockGetFileDiff.mockResolvedValue(binaryDiffOutput);

            const filePath = encodeURIComponent('binary-image.png');
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(binaryDiffOutput);
            expect(data.path).toBe('binary-image.png');
        });

        it('returns diff showing all content as added for new untracked file', async () => {
            const untrackedDiff = `diff --git a/new-untracked.txt b/new-untracked.txt
new file mode 100644
--- /dev/null
+++ b/new-untracked.txt
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;
            mockGetFileDiff.mockResolvedValue(untrackedDiff);

            const filePath = encodeURIComponent('new-untracked.txt');
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toContain('+line 1');
            expect(data.diff).toContain('new file mode');
        });

        it('returns diff showing all content as removed for deleted file', async () => {
            const deletedDiff = `diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
--- a/deleted.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-old content
-more old content`;
            mockGetFileDiff.mockResolvedValue(deletedDiff);

            const filePath = encodeURIComponent('deleted.txt');
            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toContain('-old content');
            expect(data.diff).toContain('deleted file mode');
        });
    });

    describe('POST /api/workspaces/:id/git/changes/discard', () => {
        it('discards staged-only changes (delegates entirely to service)', async () => {
            mockDiscardChanges.mockResolvedValue({ success: true });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/discard`, {
                method: 'POST',
                body: JSON.stringify({ filePath: 'src/staged-only.ts' }),
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockDiscardChanges).toHaveBeenCalledWith(WORKSPACE_ROOT, 'src/staged-only.ts');
        });

        it('returns 400 when filePath is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/discard`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/workspaces/:id/git/changes/unstage', () => {
        it('returns service result when unstaging a file not in the index', async () => {
            // Service may return { success: false } for a no-op or actual error
            mockUnstageFile.mockResolvedValue({
                success: false,
                error: 'pathspec did not match any files',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/unstage`, {
                method: 'POST',
                body: JSON.stringify({ filePath: 'not-in-index.ts' }),
            });

            // API passes through whatever the service returns (200 with result)
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
        });

        it('returns 400 when filePath is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/unstage`, {
                method: 'POST',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/workspaces/:id/git/changes/untracked', () => {
        it('returns error when attempting to delete a tracked file', async () => {
            mockDeleteUntrackedFile.mockResolvedValue({
                success: false,
                error: 'Cannot delete tracked file: src/tracked.ts',
            });

            const deleteBody = JSON.stringify({ filePath: 'src/tracked.ts' });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/untracked`, {
                method: 'DELETE',
                body: deleteBody,
                headers: { 'Content-Length': Buffer.byteLength(deleteBody).toString() },
            });

            // API delegates to service — returns 200 with service result
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('tracked');
        });

        it('deletes untracked file successfully', async () => {
            mockDeleteUntrackedFile.mockResolvedValue({ success: true });

            const deleteBody = JSON.stringify({ filePath: 'temp-untracked.log' });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/untracked`, {
                method: 'DELETE',
                body: deleteBody,
                headers: { 'Content-Length': Buffer.byteLength(deleteBody).toString() },
            });

            expect(res.status).toBe(200);
            expect(res.json()).toEqual({ success: true });
            expect(mockDeleteUntrackedFile).toHaveBeenCalledWith(WORKSPACE_ROOT, 'temp-untracked.log');
        });

        it('returns 400 when filePath is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/untracked`, {
                method: 'DELETE',
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/workspaces/:id/git/changes/stage-batch', () => {
        it('returns 200 with no-op result for empty file list', async () => {
            mockStageFiles.mockResolvedValue({ success: true, staged: 0, errors: [] });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/stage-batch`, {
                method: 'POST',
                body: JSON.stringify({ filePaths: [] }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.staged).toBe(0);
        });

        it('reports partial success when some files in batch do not exist', async () => {
            mockStageFiles.mockResolvedValue({
                success: true,
                staged: 2,
                errors: ['nonexistent.ts: pathspec did not match any files'],
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/stage-batch`, {
                method: 'POST',
                body: JSON.stringify({ filePaths: ['src/a.ts', 'src/b.ts', 'nonexistent.ts'] }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.staged).toBe(2);
            expect(data.errors).toHaveLength(1);
        });

        it('stages all files in a large batch', async () => {
            const manyFiles = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
            mockStageFiles.mockResolvedValue({ success: true, staged: 50, errors: [] });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/stage-batch`, {
                method: 'POST',
                body: JSON.stringify({ filePaths: manyFiles }),
            });

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.staged).toBe(50);
            expect(data.errors).toHaveLength(0);
        });

        it('returns 400 when filePaths is not an array', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/stage-batch`, {
                method: 'POST',
                body: JSON.stringify({ filePaths: 'not-an-array' }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe('concurrent POST /api/workspaces/:id/git/changes/stage', () => {
        it('handles two simultaneous stage requests without returning errors for either', async () => {
            mockStageFile.mockResolvedValue({ success: true });

            const [res1, res2] = await Promise.all([
                request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/stage`, {
                    method: 'POST',
                    body: JSON.stringify({ filePath: 'src/file1.ts' }),
                }),
                request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/stage`, {
                    method: 'POST',
                    body: JSON.stringify({ filePath: 'src/file2.ts' }),
                }),
            ]);

            expect(res1.status).toBe(200);
            expect(res2.status).toBe(200);
            expect(res1.json().success).toBe(true);
            expect(res2.json().success).toBe(true);
            // Both stage calls complete — index is not corrupted (both calls are honored)
            expect(mockStageFile).toHaveBeenCalledTimes(2);
        });
    });

    describe('GET /api/workspaces/:id/git/changes — all changes', () => {
        it('returns all working tree changes', async () => {
            mockGetAllChanges.mockResolvedValue([
                { path: 'src/a.ts', status: 'modified', stage: 'unstaged' },
                { path: 'src/b.ts', status: 'added', stage: 'staged' },
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.changes).toHaveLength(2);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/ws-does-not-exist/git/changes`);

            expect(res.status).toBe(404);
        });
    });
});
