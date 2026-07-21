/**
 * Tests for API status normalization across git endpoints.
 *
 * Verifies that branch-range and working-tree API routes normalize
 * word-form statuses (e.g. "modified") to single-char statuses ("M")
 * before returning them to clients. This is a key part of the unified
 * file-view data shape.
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
// Mock GitRangeService
// ============================================================================

const mockDetectCommitRange = vi.fn();
const mockGetRangeDiff = vi.fn();
const mockGetFileDiff = vi.fn();

// ============================================================================
// Mock WorkingTreeService
// ============================================================================

const mockGetAllChanges = vi.fn();
const mockStageFile = vi.fn();
const mockUnstageFile = vi.fn();
const mockDiscardChanges = vi.fn();
const mockDeleteUntrackedFile = vi.fn();
const mockGetWorkingFileDiff = vi.fn();
const mockStageFiles = vi.fn();
const mockUnstageFiles = vi.fn();

const mockExecSync = vi.fn();
vi.mock('child_process', function () { return ({
    execSync: (...args: any[]) => mockExecSync(...args),
    execFileSync: vi.fn(),
}); });

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            detectCommitRange: mockDetectCommitRange,
            getRangeDiff: mockGetRangeDiff,
            getFileDiff: mockGetFileDiff,
        }); }),
        WorkingTreeService: vi.fn().mockImplementation(function () { return ({
            getAllChanges: mockGetAllChanges,
            stageFile: mockStageFile,
            unstageFile: mockUnstageFile,
            discardChanges: mockDiscardChanges,
            deleteUntrackedFile: mockDeleteUntrackedFile,
            getFileDiff: mockGetWorkingFileDiff,
            stageFiles: mockStageFiles,
            unstageFiles: mockUnstageFiles,
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
// Test Suite
// ============================================================================

describe('API status normalization — unified file data shape', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;

    const WORKSPACE_ID = 'ws-status-norm';
    const WORKSPACE_ROOT = '/test/repo';

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
        vi.clearAllMocks();
        gitCache.clear();
    });

    // ========================================================================
    // Branch-range status normalization
    // ========================================================================

    describe('branch-range /files normalizes word status to single char', () => {
        it('converts "modified" → "M", "added" → "A", "deleted" → "D"', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 2,
                files: [
                    { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 2, repositoryRoot: WORKSPACE_ROOT },
                    { path: 'src/b.ts', status: 'added', additions: 5, deletions: 0, repositoryRoot: WORKSPACE_ROOT },
                    { path: 'src/c.ts', status: 'deleted', additions: 0, deletions: 8, repositoryRoot: WORKSPACE_ROOT },
                ],
                additions: 15,
                deletions: 10,
                mergeBase: 'abc123',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.files).toHaveLength(3);
            expect(data.files[0]).toEqual({ path: 'src/a.ts', status: 'M', additions: 10, deletions: 2 });
            expect(data.files[1]).toEqual({ path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 });
            expect(data.files[2]).toEqual({ path: 'src/c.ts', status: 'D', additions: 0, deletions: 8 });
        });

        it('converts "renamed" → "R" and preserves oldPath', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [
                    { path: 'src/new.ts', status: 'renamed', additions: 0, deletions: 0, oldPath: 'src/old.ts', repositoryRoot: WORKSPACE_ROOT },
                ],
                additions: 0,
                deletions: 0,
                mergeBase: 'abc123',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            const data = res.json();
            expect(data.files[0].status).toBe('R');
            expect(data.files[0].oldPath).toBe('src/old.ts');
        });

        it('converts "copied" → "C" and "conflict" → "U"', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [
                    { path: 'src/copy.ts', status: 'copied', additions: 10, deletions: 0, repositoryRoot: WORKSPACE_ROOT },
                    { path: 'src/conflict.ts', status: 'conflict', additions: 0, deletions: 0, repositoryRoot: WORKSPACE_ROOT },
                ],
                additions: 10,
                deletions: 0,
                mergeBase: 'abc123',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            const data = res.json();
            expect(data.files[0].status).toBe('C');
            expect(data.files[1].status).toBe('U');
        });

        it('passes through already-single-char statuses unchanged', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [
                    { path: 'src/a.ts', status: 'M', additions: 5, deletions: 1, repositoryRoot: WORKSPACE_ROOT },
                ],
                additions: 5,
                deletions: 1,
                mergeBase: 'abc123',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            const data = res.json();
            expect(data.files[0].status).toBe('M');
        });

        it('strips repositoryRoot from the file response', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [
                    { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, repositoryRoot: WORKSPACE_ROOT },
                ],
                additions: 1,
                deletions: 0,
                mergeBase: 'abc123',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range/files`);
            const data = res.json();
            expect(data.files[0]).not.toHaveProperty('repositoryRoot');
        });

        it('normalizes files in /branch-range top-level response too', async () => {
            mockDetectCommitRange.mockReturnValue({
                baseRef: 'origin/main',
                headRef: 'HEAD',
                commitCount: 1,
                files: [
                    { path: 'foo.ts', status: 'modified', additions: 1, deletions: 0, repositoryRoot: WORKSPACE_ROOT },
                ],
                additions: 1,
                deletions: 0,
                mergeBase: 'abc123',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/branch-range`);
            const data = res.json();
            expect(data.files[0].status).toBe('M');
        });
    });

    // ========================================================================
    // Working-tree status normalization
    // ========================================================================

    describe('working-tree /changes normalizes word status to single char', () => {
        it('converts word statuses returned by WorkingTreeService', async () => {
            mockGetAllChanges.mockResolvedValue([
                { filePath: '/test/repo/src/a.ts', status: 'modified', stage: 'unstaged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
                { filePath: '/test/repo/src/b.ts', status: 'added', stage: 'staged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
                { filePath: '/test/repo/src/c.ts', status: 'deleted', stage: 'unstaged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
                { filePath: '/test/repo/src/d.ts', status: 'untracked', stage: 'untracked', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.changes).toHaveLength(4);
            expect(data.changes[0].status).toBe('M');
            expect(data.changes[1].status).toBe('A');
            expect(data.changes[2].status).toBe('D');
            expect(data.changes[3].status).toBe('?');
        });

        it('converts "renamed" → "R" and maps originalPath to oldPath', async () => {
            mockGetAllChanges.mockResolvedValue([
                {
                    filePath: '/test/repo/src/new.ts',
                    status: 'renamed',
                    stage: 'staged',
                    repositoryRoot: WORKSPACE_ROOT,
                    repositoryName: 'repo',
                    originalPath: '/test/repo/src/old.ts',
                },
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            const data = res.json();
            expect(data.changes[0].status).toBe('R');
            expect(data.changes[0].oldPath).toBe('/test/repo/src/old.ts');
        });

        it('converts "conflict" → "U"', async () => {
            mockGetAllChanges.mockResolvedValue([
                { filePath: '/test/repo/src/conflict.ts', status: 'conflict', stage: 'unstaged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            const data = res.json();
            expect(data.changes[0].status).toBe('U');
        });

        it('passes through already-single-char statuses', async () => {
            mockGetAllChanges.mockResolvedValue([
                { filePath: '/test/repo/src/a.ts', status: 'M', stage: 'unstaged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            const data = res.json();
            expect(data.changes[0].status).toBe('M');
        });

        it('preserves stage, repositoryRoot, and repositoryName fields', async () => {
            mockGetAllChanges.mockResolvedValue([
                { filePath: '/test/repo/src/a.ts', status: 'modified', stage: 'staged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            const data = res.json();
            const change = data.changes[0];
            expect(change.stage).toBe('staged');
            expect(change.repositoryRoot).toBe(WORKSPACE_ROOT);
            expect(change.repositoryName).toBe('repo');
        });
    });

    // ========================================================================
    // Working-tree /changes untracked cap
    // ========================================================================

    describe('working-tree /changes caps a large untracked list', () => {
        const MAX_UNTRACKED_FILES = 500;

        function makeUntracked(count: number) {
            // Zero-padded index so lexical (localeCompare) order matches numeric order.
            return Array.from({ length: count }, (_, i) => ({
                filePath: `/test/repo/untracked/file-${String(i).padStart(4, '0')}.txt`,
                status: 'untracked',
                stage: 'untracked',
                repositoryRoot: WORKSPACE_ROOT,
                repositoryName: 'repo',
            }));
        }

        it('does not truncate when untracked count is within the cap', async () => {
            mockGetAllChanges.mockResolvedValue([
                { filePath: '/test/repo/src/a.ts', status: 'modified', stage: 'unstaged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
                ...makeUntracked(MAX_UNTRACKED_FILES),
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            const data = res.json();
            expect(data.untrackedTruncated).toBeUndefined();
            expect(data.untrackedTotal).toBeUndefined();
            expect(data.changes.filter((c: any) => c.stage === 'untracked')).toHaveLength(MAX_UNTRACKED_FILES);
        });

        it('caps untracked entries and reports the total when over the cap', async () => {
            const total = MAX_UNTRACKED_FILES + 1;
            // Provide untracked entries in reverse order to prove deterministic sorting.
            mockGetAllChanges.mockResolvedValue([
                { filePath: '/test/repo/src/a.ts', status: 'modified', stage: 'staged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
                { filePath: '/test/repo/src/b.ts', status: 'modified', stage: 'unstaged', repositoryRoot: WORKSPACE_ROOT, repositoryName: 'repo' },
                ...makeUntracked(total).reverse(),
            ]);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes`);
            const data = res.json();
            expect(data.untrackedTruncated).toBe(true);
            expect(data.untrackedTotal).toBe(total);

            const untracked = data.changes.filter((c: any) => c.status === '?');
            expect(untracked).toHaveLength(MAX_UNTRACKED_FILES);

            // Staged/unstaged are never capped and are still present.
            expect(data.changes.some((c: any) => c.stage === 'staged')).toBe(true);
            expect(data.changes.some((c: any) => c.stage === 'unstaged')).toBe(true);

            // Kept untracked entries are the lexicographically smallest N (deterministic).
            expect(untracked[0].filePath).toBe('/test/repo/untracked/file-0000.txt');
            expect(untracked[MAX_UNTRACKED_FILES - 1].filePath).toBe(
                `/test/repo/untracked/file-${String(MAX_UNTRACKED_FILES - 1).padStart(4, '0')}.txt`,
            );
            // The dropped entry (index 500) is not included.
            expect(untracked.some((c: any) => c.filePath.endsWith('file-0500.txt'))).toBe(false);
        });
    });
});
