/**
 * Diff Truncation Tests
 *
 * Tests for the truncateDiffIfNeeded helper and the ?full=true query param
 * on per-file diff endpoints (commit, working-tree, branch-range).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { gitCache } from '../../src/server/git/git-cache';
import { truncateDiffIfNeeded, DIFF_LINE_LIMIT } from '../../src/server/routes/api-shared';

// ============================================================================
// Unit tests for truncateDiffIfNeeded
// ============================================================================

describe('truncateDiffIfNeeded', () => {
    it('returns diff unchanged when under the limit', () => {
        const diff = 'line1\nline2\nline3';
        const result = truncateDiffIfNeeded(diff, false);
        expect(result).toEqual({ diff });
        expect(result.truncated).toBeUndefined();
        expect(result.totalLines).toBeUndefined();
    });

    it('truncates diff when over the limit', () => {
        const lines = Array.from({ length: DIFF_LINE_LIMIT + 500 }, (_, i) => `line ${i}`);
        const diff = lines.join('\n');
        const result = truncateDiffIfNeeded(diff, false);
        expect(result.truncated).toBe(true);
        expect(result.totalLines).toBe(DIFF_LINE_LIMIT + 500);
        expect(result.diff.split('\n')).toHaveLength(DIFF_LINE_LIMIT);
    });

    it('returns full diff when full=true even if over the limit', () => {
        const lines = Array.from({ length: DIFF_LINE_LIMIT + 100 }, (_, i) => `line ${i}`);
        const diff = lines.join('\n');
        const result = truncateDiffIfNeeded(diff, true);
        expect(result).toEqual({ diff });
        expect(result.truncated).toBeUndefined();
    });

    it('returns diff unchanged when exactly at the limit', () => {
        const lines = Array.from({ length: DIFF_LINE_LIMIT }, (_, i) => `line ${i}`);
        const diff = lines.join('\n');
        const result = truncateDiffIfNeeded(diff, false);
        expect(result).toEqual({ diff });
        expect(result.truncated).toBeUndefined();
    });

    it('DIFF_LINE_LIMIT is 100000', () => {
        expect(DIFF_LINE_LIMIT).toBe(100_000);
    });
});

// ============================================================================
// Integration tests for per-file diff endpoints
// ============================================================================

const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('child_process', function () { return ({
    execSync: (...args: any[]) => mockExecSync(...args),
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
}); });

const mockGetBranchStatus = vi.fn();
const mockGetAllChanges = vi.fn();
const mockGetFileDiff = vi.fn();
const mockDetectCommitRange = vi.fn();
const mockRangeGetFileDiff = vi.fn();
// execGitArgsSync delegates to forge execGit (WSL-aware); mock it directly
const mockForgeExecGit = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        execGit: (...args: any[]) => mockForgeExecGit(...args),
        // execGitArgsAsync / readGitFileAtCommit now delegate to forge execGitAsync.
        execGitAsync: async (...args: any[]) => mockForgeExecGit(...args),
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: mockGetBranchStatus,
            getRepoState: vi.fn().mockReturnValue({}),
        }); }),
        WorkingTreeService: vi.fn().mockImplementation(function () { return ({
            getAllChanges: mockGetAllChanges,
            getFileDiff: mockGetFileDiff,
            stageFile: vi.fn(),
            unstageFile: vi.fn(),
            discardChanges: vi.fn(),
            stageFiles: vi.fn(),
            unstageFiles: vi.fn(),
            deleteUntrackedFile: vi.fn(),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            detectCommitRange: mockDetectCommitRange,
            getFileDiff: mockRangeGetFileDiff,
            getRangeDiff: vi.fn().mockReturnValue(''),
        }); }),
    };
});

function request(
    requestUrl: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(requestUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, body: bodyStr, json: () => JSON.parse(bodyStr) });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function makeLargeDiff(lines: number): string {
    return Array.from({ length: lines }, (_, i) => `+line ${i}`).join('\n');
}

describe('Diff truncation endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    const WS_ID = 'ws-trunc-test';
    const WS_ROOT = '/tmp/repo';

    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WS_ID, name: 'Trunc Test Repo', rootPath: WS_ROOT },
        ]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store as any);
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
        mockForgeExecGit.mockReset();
        mockForgeExecGit.mockReturnValue('');
        mockGetBranchStatus.mockReset();
        mockGetFileDiff.mockReset();
        mockDetectCommitRange.mockReset();
        mockRangeGetFileDiff.mockReset();
        mockGetBranchStatus.mockReturnValue({ ahead: 0 });
        gitCache.clear();
    });

    describe('commit per-file diff', () => {
        const endpoint = (file: string, full = false) =>
            `${base()}/api/workspaces/${WS_ID}/git/commits/abc1234/files/${encodeURIComponent(file)}/diff${full ? '?full=true' : ''}`;

        it('returns truncated diff when over limit', async () => {
            const largeDiff = makeLargeDiff(DIFF_LINE_LIMIT + 200);
            mockForgeExecGit.mockReturnValue(largeDiff);

            const res = await request(endpoint('big-file.ts'));
            const data = res.json();
            expect(data.truncated).toBe(true);
            expect(data.totalLines).toBe(DIFF_LINE_LIMIT + 200);
            expect(data.diff.split('\n')).toHaveLength(DIFF_LINE_LIMIT);
        });

        it('returns full diff when ?full=true', async () => {
            const largeDiff = makeLargeDiff(DIFF_LINE_LIMIT + 200);
            mockForgeExecGit.mockReturnValue(largeDiff);

            const res = await request(endpoint('big-file.ts', true));
            const data = res.json();
            expect(data.truncated).toBeUndefined();
            expect(data.diff).toBe(largeDiff);
        });

        it('returns untruncated diff when under limit', async () => {
            const smallDiff = 'line1\nline2\nline3';
            mockForgeExecGit.mockReturnValue(smallDiff);

            const res = await request(endpoint('small-file.ts'));
            const data = res.json();
            expect(data.truncated).toBeUndefined();
            expect(data.diff).toBe(smallDiff);
        });
    });

    describe('working-tree per-file diff', () => {
        const endpoint = (file: string, full = false) =>
            `${base()}/api/workspaces/${WS_ID}/git/changes/files/${encodeURIComponent(file)}/diff?stage=unstaged${full ? '&full=true' : ''}`;

        it('returns truncated diff when over limit', async () => {
            const largeDiff = makeLargeDiff(DIFF_LINE_LIMIT + 300);
            mockGetFileDiff.mockResolvedValue(largeDiff);

            const res = await request(endpoint('big-file.ts'));
            const data = res.json();
            expect(data.truncated).toBe(true);
            expect(data.totalLines).toBe(DIFF_LINE_LIMIT + 300);
            expect(data.path).toBe('big-file.ts');
        });

        it('returns full diff when ?full=true', async () => {
            const largeDiff = makeLargeDiff(DIFF_LINE_LIMIT + 300);
            mockGetFileDiff.mockResolvedValue(largeDiff);

            const res = await request(endpoint('big-file.ts', true));
            const data = res.json();
            expect(data.truncated).toBeUndefined();
            expect(data.diff).toBe(largeDiff);
            expect(data.path).toBe('big-file.ts');
        });
    });

    describe('branch-range per-file diff', () => {
        const endpoint = (file: string, full = false) =>
            `${base()}/api/workspaces/${WS_ID}/git/branch-range/files/${encodeURIComponent(file)}/diff${full ? '?full=true' : ''}`;

        it('returns truncated diff when over limit', async () => {
            const largeDiff = makeLargeDiff(DIFF_LINE_LIMIT + 100);
            mockDetectCommitRange.mockReturnValue({ baseRef: 'main', files: [] });
            mockRangeGetFileDiff.mockReturnValue(largeDiff);

            const res = await request(endpoint('big-file.ts'));
            const data = res.json();
            expect(data.truncated).toBe(true);
            expect(data.totalLines).toBe(DIFF_LINE_LIMIT + 100);
            expect(data.path).toBe('big-file.ts');
        });

        it('returns full diff when ?full=true', async () => {
            const largeDiff = makeLargeDiff(DIFF_LINE_LIMIT + 100);
            mockDetectCommitRange.mockReturnValue({ baseRef: 'main', files: [] });
            mockRangeGetFileDiff.mockReturnValue(largeDiff);

            const res = await request(endpoint('big-file.ts', true));
            const data = res.json();
            expect(data.truncated).toBeUndefined();
            expect(data.diff).toBe(largeDiff);
        });
    });
});
