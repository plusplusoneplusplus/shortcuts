/**
 * Git API Endpoint Tests
 *
 * Tests for the git commit API routes:
 * - GET /api/workspaces/:id/git/commits
 * - GET /api/workspaces/:id/git/commits/:hash/files
 * - GET /api/workspaces/:id/git/commits/:hash/diff
 * - GET /api/workspaces/:id/git/commits/:hash/files/:filePath/diff
 * - GET /api/workspaces/:id/git/commits/:hash/files/:filePath/content
 *
 * Uses mocked execGitSync via vi.mock to avoid actual git calls.
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
// Mock execGitSync and child_process
// ============================================================================

const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSync(...args),
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// ============================================================================
// Mock BranchService and GitRangeService
// ============================================================================

const mockGetBranchStatus = vi.fn();
const mockHasUncommittedChanges = vi.fn();
const mockGetCurrentBranch = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(() => ({
            getBranchStatus: mockGetBranchStatus,
            hasUncommittedChanges: mockHasUncommittedChanges,
        })),
        GitRangeService: vi.fn().mockImplementation(() => ({
            getCurrentBranch: mockGetCurrentBranch,
            detectCommitRange: vi.fn(),
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
// Test Suite
// ============================================================================

describe('Git API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const WORKSPACE_ID = 'ws-git-test';
    const WORKSPACE_ROOT = '/test/repo';

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
        mockExecSync.mockReset();
        mockExecFileSync.mockReset();
        mockGetBranchStatus.mockReset();
        mockHasUncommittedChanges.mockReset();
        mockGetCurrentBranch.mockReset();
        // Sensible defaults
        mockHasUncommittedChanges.mockReturnValue(false);
        mockGetCurrentBranch.mockReturnValue('main');
        mockGetBranchStatus.mockReturnValue({ name: 'main', isDetached: false, ahead: 0, behind: 0, hasUncommittedChanges: false });
        gitCache.clear();
    });

    const base = () => `http://127.0.0.1:${port}`;

    // ========================================================================
    // GET /api/workspaces/:id/git/commits
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits', () => {
        it('returns commits and unpushedCount', async () => {
            const logOutput = [
                'abc123def456789\nabc123d\nInitial commit\nJohn Doe\njohn@example.com\n2026-01-15T10:00:00+00:00\n\n',
                'def456abc789012\ndef456a\nAdd feature\nJane Smith\njane@example.com\n2026-01-16T12:00:00+00:00\nabc123def456789\nThis is the commit body\nwith multiple lines',
            ].join('\0');

            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('log --format=')) return logOutput;
                return '';
            });
            mockGetBranchStatus.mockReturnValue({ name: 'main', isDetached: false, ahead: 1, behind: 0, hasUncommittedChanges: false });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toHaveLength(2);
            expect(data.unpushedCount).toBe(1);
            expect(data.commits[0].hash).toBe('abc123def456789');
            expect(data.commits[0].shortHash).toBe('abc123d');
            expect(data.commits[0].subject).toBe('Initial commit');
            expect(data.commits[0].author).toBe('John Doe');
            expect(data.commits[0].authorEmail).toBe('john@example.com');
            expect(data.commits[0].body).toBe('');
            expect(data.commits[1].parentHashes).toEqual(['abc123def456789']);
            expect(data.commits[1].body).toBe('This is the commit body\nwith multiple lines');
        });

        it('returns empty list when no commits', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('log --format=')) return '';
                return '';
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toEqual([]);
            expect(data.unpushedCount).toBe(0);
        });

        it('returns empty on git error (non-git repo)', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('fatal: not a git repository');
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commits).toEqual([]);
            expect(data.unpushedCount).toBe(0);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/git/commits`);
            expect(res.status).toBe(404);
        });

        it('handles unpushedCount when no upstream (getBranchStatus returns null)', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('log --format=')) return 'a1b2c3\na1b2\nCommit\nDev\ndev@example.com\n2026-01-01T00:00:00Z\n\n';
                return '';
            });
            mockGetBranchStatus.mockReturnValue(null);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits`);
            const data = res.json();
            expect(data.unpushedCount).toBe(0);
            expect(data.commits).toHaveLength(1);
        });

        it('respects limit and skip query params', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('log --format=')) {
                    expect(cmd).toContain('--skip=5');
                    expect(cmd).toContain('--max-count=10');
                    return '';
                }
                return '';
            });

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=10&skip=5`);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git-info
    // ========================================================================

    describe('GET /api/workspaces/:id/git-info', () => {
        it('returns branch, dirty, ahead, behind for a valid git repo', async () => {
            mockGetCurrentBranch.mockReturnValue('feature/my-branch');
            mockHasUncommittedChanges.mockReturnValue(true);
            mockGetBranchStatus.mockReturnValue({ name: 'feature/my-branch', isDetached: false, ahead: 2, behind: 1, hasUncommittedChanges: true });
            mockExecSync.mockReturnValue(''); // for detectRemoteUrl

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git-info`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.isGitRepo).toBe(true);
            expect(data.branch).toBe('feature/my-branch');
            expect(data.dirty).toBe(true);
            expect(data.ahead).toBe(2);
            expect(data.behind).toBe(1);
        });

        it('returns isGitRepo false when getBranchStatus returns null', async () => {
            mockGetBranchStatus.mockReturnValue(null);
            mockHasUncommittedChanges.mockReturnValue(false);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git-info`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.isGitRepo).toBe(false);
            expect(data.branch).toBeNull();
        });

        it('returns ahead=0 behind=0 when no upstream tracking branch', async () => {
            mockGetCurrentBranch.mockReturnValue('main');
            mockHasUncommittedChanges.mockReturnValue(false);
            mockGetBranchStatus.mockReturnValue({ name: 'main', isDetached: false, ahead: 0, behind: 0, hasUncommittedChanges: false });
            mockExecSync.mockReturnValue('');

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git-info`);
            const data = res.json();
            expect(data.ahead).toBe(0);
            expect(data.behind).toBe(0);
            expect(data.isGitRepo).toBe(true);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/git-info`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/files
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/files', () => {
        it('returns changed files for a commit', async () => {
            const diffTreeOutput = 'M\tsrc/index.ts\nA\tsrc/new-file.ts\nD\told-file.ts';
            mockExecSync.mockReturnValue(diffTreeOutput);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.files).toHaveLength(3);
            expect(data.files[0]).toEqual({ status: 'M', path: 'src/index.ts' });
            expect(data.files[1]).toEqual({ status: 'A', path: 'src/new-file.ts' });
            expect(data.files[2]).toEqual({ status: 'D', path: 'old-file.ts' });
        });

        it('returns error on git failure', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('bad object abc123');
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files`);
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Failed to get commit files');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/git/commits/abc123def456/files`);
            expect(res.status).toBe(404);
        });

        it('handles empty diff-tree output', async () => {
            mockExecSync.mockReturnValue('');
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files`);
            expect(res.status).toBe(200);
            expect(res.json().files).toEqual([]);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/diff
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/diff', () => {
        it('returns diff for a commit', async () => {
            const diffOutput = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new';
            mockExecSync.mockReturnValue(diffOutput);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(diffOutput);
        });

        it('returns error on git failure', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('bad object deadbeef');
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/deadbeef1234/diff`);
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Failed to get commit diff');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/git/commits/abc123def456/diff`);
            expect(res.status).toBe(404);
        });

        it('returns empty diff', async () => {
            mockExecSync.mockReturnValue('');
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/diff`);
            expect(res.status).toBe(200);
            expect(res.json().diff).toBe('');
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/files/*/diff
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/files/*/diff', () => {
        it('returns diff for a specific file in a commit', async () => {
            const diffOutput = 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new';
            mockExecSync.mockReturnValue(diffOutput);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files/${encodeURIComponent('src/index.ts')}/diff`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.diff).toBe(diffOutput);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/git/commits/abc123def456/files/${encodeURIComponent('src/index.ts')}/diff`);
            expect(res.status).toBe(404);
        });

        it('returns cached result on second request', async () => {
            const diffOutput = 'diff --git a/f.ts b/f.ts\n-old\n+new';
            mockExecSync.mockReturnValue(diffOutput);

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files/${encodeURIComponent('f.ts')}/diff`);
            expect(res1.status).toBe(200);
            expect(res1.json().diff).toBe(diffOutput);

            mockExecSync.mockReset();
            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files/${encodeURIComponent('f.ts')}/diff`);
            expect(res2.status).toBe(200);
            expect(res2.json().diff).toBe(diffOutput);
            // execSync should not have been called again
            expect(mockExecSync).not.toHaveBeenCalled();
        });

        it('returns error on git failure', async () => {
            mockExecSync.mockImplementation(() => {
                throw new Error('bad object deadbeef');
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/deadbeef1234/files/${encodeURIComponent('src/index.ts')}/diff`);
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Failed to get commit file diff');
        });

        it('handles deeply nested file paths', async () => {
            const diffOutput = 'diff for nested file';
            mockExecSync.mockReturnValue(diffOutput);

            const filePath = 'packages/coc-server/src/api-handler.ts';
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123def456/files/${encodeURIComponent(filePath)}/diff`);
            expect(res.status).toBe(200);
            expect(res.json().diff).toBe(diffOutput);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/files/*/content
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/files/*/content', () => {
        it('returns full file content for a commit file', async () => {
            mockExecFileSync.mockReturnValue('first line\nsecond line\n');

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123/files/${encodeURIComponent('docs/readme.md')}/content`
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.path).toBe('docs/readme.md');
            expect(data.fileName).toBe('readme.md');
            expect(data.lines).toEqual(['first line', 'second line']);
            expect(data.totalLines).toBe(2);
            expect(data.truncated).toBe(false);
            expect(data.language).toBe('md');
            expect(data.resolvedRef).toBe('abc123:docs/readme.md');
            expect(mockExecFileSync).toHaveBeenCalledWith(
                'git',
                ['show', 'abc123:docs/readme.md'],
                expect.objectContaining({ cwd: WORKSPACE_ROOT, encoding: 'utf-8', timeout: 5000 }),
            );
        });

        it('falls back to the parent ref when the file was deleted in the commit', async () => {
            mockExecFileSync
                .mockImplementationOnce(() => {
                    throw new Error('fatal: path does not exist in commit');
                })
                .mockImplementationOnce(() => 'deleted content\n');

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123/files/${encodeURIComponent('docs/removed.md')}/content`
            );

            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.lines).toEqual(['deleted content']);
            expect(data.resolvedRef).toBe('abc123^:docs/removed.md');
            expect(mockExecFileSync).toHaveBeenCalledTimes(2);
        });

        it('returns 400 when commit file content cannot be read', async () => {
            mockExecFileSync.mockImplementation(() => {
                throw new Error('fatal: bad object');
            });

            const res = await request(
                `${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc123/files/${encodeURIComponent('docs/missing.md')}/content`
            );

            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.error).toContain('Failed to get commit file content');
        });
    });

    // ========================================================================
    // Hash validation (regex route pattern)
    // ========================================================================

    describe('hash validation', () => {
        it('rejects invalid hash characters in files endpoint', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/ZZZZ/files`);
            // Route pattern only matches [a-f0-9]{4,40}, so non-matching gives 404
            expect(res.status).toBe(404);
        });

        it('rejects hash that is too short (< 4 chars)', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abc/files`);
            expect(res.status).toBe(404);
        });

        it('accepts minimum valid hash length (4 chars)', async () => {
            mockExecSync.mockReturnValue('');
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd/files`);
            expect(res.status).toBe(200);
        });
    });
});
