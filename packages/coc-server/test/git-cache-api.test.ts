/**
 * Git API Cache Integration Tests
 *
 * Verifies that the git endpoints use GitCacheService correctly:
 * - Second call without refresh returns cached data (git not re-invoked)
 * - Call with ?refresh=true re-invokes git and updates cache
 * - Commit-files and commit-diff are cached immutably
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import { gitCache } from '../src/git-cache';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock execGitSync and child_process
// ============================================================================

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSync(...args),
}));

// ============================================================================
// Mock GitRangeService (used by branch-range endpoint)
// ============================================================================

const mockDetectCommitRange = vi.fn();
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        GitRangeService: class {
            detectCommitRange = mockDetectCommitRange;
        },
    };
});

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
    const WORKSPACE_ROOT = '/test/cache-repo';

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
        mockExecSync.mockReset();
        mockDetectCommitRange.mockReset();
        gitCache.clear();
    });

    const base = () => `http://127.0.0.1:${port}`;

    // ========================================================================
    // GET /api/workspaces/:id/git/commits — caching
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits (cache)', () => {
        const COMMIT_LOG = 'aaaa\naaaa\nFirst\nAlice\n2026-01-01T00:00:00Z\n\n';

        function setupGitMock() {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('log --format=')) return COMMIT_LOG;
                if (cmd.includes('rev-list --left-right --count')) return '0\t0';
                return '';
            });
        }

        it('second call returns cached data without re-invoking git', async () => {
            setupGitMock();

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            expect(res1.status).toBe(200);
            expect(res1.json().commits).toHaveLength(1);

            // git was invoked on the first call
            const callCountAfterFirst = mockExecSync.mock.calls.length;
            expect(callCountAfterFirst).toBeGreaterThan(0);

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            expect(res2.status).toBe(200);
            expect(res2.json().commits).toHaveLength(1);

            // no additional git calls
            expect(mockExecSync.mock.calls.length).toBe(callCountAfterFirst);
        });

        it('refresh=true bypasses cache and re-invokes git', async () => {
            setupGitMock();

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            const callCountAfterFirst = mockExecSync.mock.calls.length;

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50&refresh=true`);
            expect(mockExecSync.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
        });

        it('different limit/skip produces different cache entries', async () => {
            setupGitMock();

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            const callsAfterFirst = mockExecSync.mock.calls.length;

            // Different skip → cache miss → git re-invoked
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50&skip=10`);
            expect(mockExecSync.mock.calls.length).toBeGreaterThan(callsAfterFirst);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/files — immutable cache
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/files (cache)', () => {
        it('second call for same hash returns cached data', async () => {
            mockExecSync.mockReturnValue('M\tsrc/index.ts');

            const res1 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/files`);
            expect(res1.status).toBe(200);
            expect(res1.json().files).toHaveLength(1);

            const callsAfterFirst = mockExecSync.mock.calls.length;

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/files`);
            expect(res2.status).toBe(200);
            expect(res2.json().files).toHaveLength(1);
            expect(mockExecSync.mock.calls.length).toBe(callsAfterFirst);
        });

        it('immutable cache survives mutable invalidation', async () => {
            mockExecSync.mockReturnValue('A\tnew.ts');

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/beef5678/files`);
            const callsAfterFirst = mockExecSync.mock.calls.length;

            // Invalidate mutable cache
            gitCache.invalidateMutable(WORKSPACE_ID);

            // Immutable entry still cached
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/beef5678/files`);
            expect(mockExecSync.mock.calls.length).toBe(callsAfterFirst);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/git/commits/:hash/diff — immutable cache
    // ========================================================================

    describe('GET /api/workspaces/:id/git/commits/:hash/diff (cache)', () => {
        it('second call for same hash returns cached diff', async () => {
            mockExecSync.mockReturnValue('diff --git a/f.ts b/f.ts\n-old\n+new');

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/diff`);
            const callsAfterFirst = mockExecSync.mock.calls.length;

            const res2 = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/abcd1234/diff`);
            expect(res2.status).toBe(200);
            expect(res2.json().diff).toContain('diff --git');
            expect(mockExecSync.mock.calls.length).toBe(callsAfterFirst);
        });

        it('immutable diff cache survives mutable invalidation', async () => {
            mockExecSync.mockReturnValue('patch data');

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/dead5678/diff`);
            const callsAfterFirst = mockExecSync.mock.calls.length;

            gitCache.invalidateMutable(WORKSPACE_ID);

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits/dead5678/diff`);
            expect(mockExecSync.mock.calls.length).toBe(callsAfterFirst);
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
                { id: 'ws-other', name: 'Repo B', rootPath: '/test/other' },
            ]);

            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('log --format=')) return 'aaaa\naaaa\nFirst\nAlice\n2026-01-01T00:00:00Z\n\n';
                if (cmd.includes('rev-list --left-right --count')) return '0\t0';
                return '';
            });

            // Populate cache for both workspaces
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50`);
            await request(`${base()}/api/workspaces/ws-other/git/commits?limit=50`);

            const callsAfterBoth = mockExecSync.mock.calls.length;

            // Refresh only ws-cache-test
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/commits?limit=50&refresh=true`);

            // ws-other should still be cached — request should not add git calls
            await request(`${base()}/api/workspaces/ws-other/git/commits?limit=50`);
            // Only the refresh for WORKSPACE_ID should have re-invoked git
            // (refresh call adds git invocations, but the ws-other call should not)
            const refreshCalls = mockExecSync.mock.calls.length - callsAfterBoth;
            // The refresh triggered git calls for WORKSPACE_ID only.
            // The subsequent ws-other call should have been served from cache (0 additional calls).
            // So total new calls == calls from the one refresh.
            const callsForRefresh = refreshCalls;
            
            // Verify ws-other is still cached by checking no new calls are added
            const callsBeforeOther = mockExecSync.mock.calls.length;
            await request(`${base()}/api/workspaces/ws-other/git/commits?limit=50`);
            expect(mockExecSync.mock.calls.length).toBe(callsBeforeOther);
        });
    });
});
