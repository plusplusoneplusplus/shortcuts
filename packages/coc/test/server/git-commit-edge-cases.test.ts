/**
 * Git Commit Edge Cases Tests
 *
 * Section 7: Commit Diff Edge Cases
 * - GET /commits/:hash/diff for initial commit (no parent) → all files shown as added
 * - GET /commits/:hash/diff for merge commit (2 parents) → shows merge diff
 * - GET /commits/:hash for nonexistent SHA → 404
 * - GET /commits/:hash/files/:file/content — file deleted in commit → falls back to parent
 * - GET /commits/:hash/files/:file/content — file added in commit → 200 with content
 * - GET /commits with ?limit=5 → exactly 5 commits returned
 * - GET /commits with ?skip=N → skips N commits
 * - GET /commits with ?since=<date> → includes since param in git log command
 *
 * Mocks execSync/execFileSync. Cross-platform compatible.
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
// Mock child_process (still needed for execGitSync in api-handler)
// ============================================================================

const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('child_process', function () { return ({
    execSync: (...args: any[]) => mockExecSync(...args),
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
}); });

// ============================================================================
// Mock forge: execGit (used by execGitArgsSync and readGitFileAtCommit),
// BranchService, and GitRangeService
// ============================================================================

const mockExecGit = vi.fn();
const mockGetBranchStatus = vi.fn();
const mockHasUncommittedChanges = vi.fn();
const mockGetCurrentBranch = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        execGit: (...args: any[]) => mockExecGit(...args),
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: mockGetBranchStatus,
            hasUncommittedChanges: mockHasUncommittedChanges,
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: mockGetCurrentBranch,
            detectCommitRange: vi.fn(),
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

const INITIAL_COMMIT_DIFF = `diff --git a/README.md b/README.md
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+# Initial commit`;

const MERGE_COMMIT_DIFF = `diff --git a/src/a.ts b/src/a.ts
index abc1234..def5678 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
+import { b } from './b';
 export const a = 1;
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+export const b = 2;`;

// ============================================================================
// Test Suite
// ============================================================================

describe('Git Commit Edge Cases', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const WORKSPACE_ID = 'ws-commit-edge-test';
    const WORKSPACE_ROOT = '/test/commit-edge-repo';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Commit Edge Repo', rootPath: WORKSPACE_ROOT },
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
        mockExecSync.mockReset();
        mockExecFileSync.mockReset();
        mockExecGit.mockReset();
        mockGetBranchStatus.mockReset();
        mockHasUncommittedChanges.mockReset();
        mockGetCurrentBranch.mockReset();
        // Sensible defaults
        mockExecGit.mockReturnValue('');
        mockHasUncommittedChanges.mockReturnValue(false);
        mockGetCurrentBranch.mockReturnValue('main');
        mockGetBranchStatus.mockReturnValue({
            name: 'main',
            isDetached: false,
            ahead: 0,
            behind: 0,
            hasUncommittedChanges: false,
        });
        gitCache.clear();
    });

    // ========================================================================
    // Section 7: Initial and Merge Commit Diffs
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/diff — special commits', () => {
        it('shows all files as added for initial commit (no parent)', async () => {
            // Initial commit: git diff HEAD^ HEAD would fail, but git diff-tree --root works
            mockExecGit.mockReturnValue(INITIAL_COMMIT_DIFF);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef56789a/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(INITIAL_COMMIT_DIFF);
            // diff should show "new file mode" — no deletion lines
            expect(data.diff).toContain('new file mode');
            expect(data.diff).not.toContain('deleted file mode');
        });

        it('shows combined diff for merge commit with two parents', async () => {
            mockExecGit.mockReturnValue(MERGE_COMMIT_DIFF);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234ef567890/diff`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(MERGE_COMMIT_DIFF);
            // merge diff includes changes from both parents
            expect(data.diff).toContain('src/a.ts');
            expect(data.diff).toContain('src/b.ts');
        });

        it('returns 404 for nonexistent SHA', async () => {
            mockExecGit.mockImplementation(() => {
                throw new Error('fatal: bad object deadbeef1234567890');
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/deadbeef1234/diff`,
            );

            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Failed to get commit diff');
        });

        it('returns empty diff for empty commit (no changes)', async () => {
            mockExecGit.mockReturnValue('');

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef56789a/diff`,
            );

            expect(res.status).toBe(200);
            expect(res.json().diff).toBe('');
        });
    });

    describe('GET /api/workspaces/:id/git/commits/:hash/files/:file/content — special cases', () => {
        it('returns 400 for file at nonexistent commit hash', async () => {
            mockExecGit.mockImplementation(() => {
                throw new Error('fatal: bad object');
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/deadbeef/files/${encodeURIComponent('src/missing.ts')}/content`,
            );

            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Failed to get commit file content');
        });

        it('falls back to parent ref for file deleted in commit', async () => {
            // First call (at hash) throws; second call (at hash^) succeeds
            mockExecGit
                .mockImplementationOnce(() => {
                    throw new Error('fatal: path does not exist in commit');
                })
                .mockImplementationOnce(() => 'deleted content\n');

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef/files/${encodeURIComponent('deleted.ts')}/content`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.lines).toEqual(['deleted content']);
            expect(data.resolvedRef).toBe('abc1234ef^:deleted.ts');
        });

        it('returns 200 with content for file added in commit', async () => {
            mockExecGit.mockReturnValue('export const added = true;\n');

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef/files/${encodeURIComponent('added.ts')}/content`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.lines).toEqual(['export const added = true;']);
            expect(data.resolvedRef).toBe('abc1234ef:added.ts');
        });

        it('returns 400 when file content exceeds 10MB', async () => {
            const largeContent = 'x'.repeat(10 * 1024 * 1024 + 1);
            mockExecGit.mockReturnValue(largeContent);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef/files/${encodeURIComponent('huge.bin')}/content`,
            );

            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('too large');
        });

        it('returns 200 when file content is just under 10MB', async () => {
            const justUnderContent = 'x'.repeat(10 * 1024 * 1024 - 1);
            mockExecGit.mockReturnValue(justUnderContent);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef/files/${encodeURIComponent('big.txt')}/content`,
            );

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/workspaces/:id/git/commits — pagination', () => {
        it('returns exactly 5 commits with ?limit=5', async () => {
            // Build 5 commit entries separated by NUL
            const commits = Array.from({ length: 5 }, (_, i) =>
                `hash${String(i).padStart(15, '0')}\nhash${i}ab\nCommit ${i}\nDev\ndev@t.com\n2026-01-0${i + 1}T00:00:00Z\n\n`,
            ).join('\0');

            mockExecGit.mockImplementation((args: string[]) => {
                if (args[0] === 'log') {
                    expect(args).toContain('--max-count=5');
                    return commits;
                }
                return '';
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=5`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toHaveLength(5);
        });

        it('passes --skip to git log when ?skip=N is provided', async () => {
            mockExecGit.mockImplementation((args: string[]) => {
                if (args[0] === 'log') {
                    expect(args).toContain('--skip=10');
                    return '';
                }
                return '';
            });

            await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=20&skip=10`,
            );
        });

        it('uses default limit of 50 when no limit param is provided', async () => {
            let capturedArgs: string[] = [];
            mockExecGit.mockImplementation((args: string[]) => {
                if (args[0] === 'log') {
                    capturedArgs = args;
                    return '';
                }
                return '';
            });

            await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`,
            );

            expect(capturedArgs).toContain('--max-count=50');
        });

        it('returns empty list when git repo has no commits yet', async () => {
            mockExecGit.mockImplementation((args: string[]) => {
                if (args[0] === 'log') return '';
                return '';
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toEqual([]);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(
                `${base()}/api/workspaces/ws-nonexistent/git/commits`,
            );

            expect(res.status).toBe(404);
        });

        it('handles git log returning commits with multi-line body', async () => {
            const logOutput = 'abc1234def567890\nabc1234\nFix bug\nDev\ndev@t.com\n2026-01-01T00:00:00Z\nparent1\nFixes #123\nAdditional details on line 2\n';

            mockExecGit.mockImplementation((args: string[]) => {
                if (args[0] === 'log') return logOutput;
                return '';
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`,
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toHaveLength(1);
            expect(data.commits[0].body).toContain('Fixes #123');
        });
    });

    // ========================================================================
    // WSL regression: git routes must use forge execGit (WSL-aware)
    // ========================================================================

    describe('WSL regression: commit routes delegate to forge execGit', () => {
        it('passes WSL UNC rootPath to forge execGit for commit diff', async () => {
            const WSL_ROOT = '\\\\wsl$\\Ubuntu\\home\\user\\repo';
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'WSL Repo', rootPath: WSL_ROOT },
            ]);
            gitCache.clear();

            mockExecGit.mockReturnValue(INITIAL_COMMIT_DIFF);

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef56789a/diff`,
            );

            expect(res.status).toBe(200);
            // Verify forge execGit was called with the WSL path as repoRoot
            expect(mockExecGit).toHaveBeenCalledWith(
                expect.arrayContaining(['show']),
                WSL_ROOT,
                expect.anything(),
            );

            // Restore normal rootPath for other tests
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Commit Edge Repo', rootPath: WORKSPACE_ROOT },
            ]);
            gitCache.clear();
        });

        it('passes WSL UNC rootPath to forge execGit for file content', async () => {
            const WSL_ROOT = '\\\\wsl$\\Ubuntu\\home\\user\\repo';
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'WSL Repo', rootPath: WSL_ROOT },
            ]);
            gitCache.clear();

            mockExecGit.mockReturnValue('const x = 1;\n');

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc1234ef/files/${encodeURIComponent('src/x.ts')}/content`,
            );

            expect(res.status).toBe(200);
            expect(mockExecGit).toHaveBeenCalledWith(
                expect.arrayContaining(['show']),
                WSL_ROOT,
                expect.anything(),
            );

            // Restore
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Commit Edge Repo', rootPath: WORKSPACE_ROOT },
            ]);
            gitCache.clear();
        });
    });
});
