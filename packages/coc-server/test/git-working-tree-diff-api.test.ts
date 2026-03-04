/**
 * Git Working-Tree Changes Diff API Tests
 *
 * Tests for:
 * - GET /api/workspaces/:id/git/changes/files/{path}/diff?stage=staged|unstaged
 *
 * Mocks WorkingTreeService to avoid actual git invocations.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock WorkingTreeService
// ============================================================================

const mockGetFileDiff = vi.fn();
const mockGetAllChanges = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        WorkingTreeService: vi.fn().mockImplementation(() => ({
            getAllChanges: mockGetAllChanges,
            stageFile: vi.fn().mockResolvedValue({ success: true }),
            unstageFile: vi.fn().mockResolvedValue({ success: true }),
            discardChanges: vi.fn().mockResolvedValue({ success: true }),
            deleteUntrackedFile: vi.fn().mockResolvedValue({ success: true }),
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

const WORKSPACE_ID = 'ws-changes-diff-test';
const WORKSPACE_ROOT = '/test/repo';
const UNKNOWN_WORKSPACE = 'ws-nonexistent';

const STAGED_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
+import { bar } from './bar';
 export function foo() {}`;

const UNSTAGED_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index def5678..aaa1111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
+// work in progress
 import { bar } from './bar';
 export function foo() {}`;

// ============================================================================
// Test Suite
// ============================================================================

describe('GET /api/workspaces/:id/git/changes/files/*/diff', () => {
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
        mockGetFileDiff.mockReset();
        mockGetAllChanges.mockReset();
    });

    it('returns staged diff when stage=staged', async () => {
        mockGetFileDiff.mockResolvedValue(STAGED_DIFF);

        const filePath = encodeURIComponent('src/foo.ts');
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff?stage=staged`);

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.diff).toBe(STAGED_DIFF);
        expect(data.path).toBe('src/foo.ts');
        expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'src/foo.ts', true);
    });

    it('returns unstaged diff when stage=unstaged', async () => {
        mockGetFileDiff.mockResolvedValue(UNSTAGED_DIFF);

        const filePath = encodeURIComponent('src/foo.ts');
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff?stage=unstaged`);

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.diff).toBe(UNSTAGED_DIFF);
        expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'src/foo.ts', false);
    });

    it('passes staged=false when stage param is absent', async () => {
        mockGetFileDiff.mockResolvedValue('');

        const filePath = encodeURIComponent('src/bar.ts');
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff`);

        expect(res.status).toBe(200);
        expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'src/bar.ts', false);
    });

    it('returns empty diff when service returns empty string', async () => {
        mockGetFileDiff.mockResolvedValue('');

        const filePath = encodeURIComponent('src/new.ts');
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff?stage=staged`);

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.diff).toBe('');
    });

    it('returns 404 for unknown workspace', async () => {
        const filePath = encodeURIComponent('src/foo.ts');
        const res = await request(`${base()}/api/workspaces/${UNKNOWN_WORKSPACE}/git/changes/files/${filePath}/diff?stage=staged`);
        expect(res.status).toBe(404);
    });

    it('handles nested file paths', async () => {
        mockGetFileDiff.mockResolvedValue(STAGED_DIFF);

        const filePath = encodeURIComponent('packages/core/src/utils/helper.ts');
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff?stage=staged`);

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.path).toBe('packages/core/src/utils/helper.ts');
        expect(mockGetFileDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, 'packages/core/src/utils/helper.ts', true);
    });

    it('returns empty diff gracefully when getFileDiff throws', async () => {
        mockGetFileDiff.mockRejectedValue(new Error('git error'));

        const filePath = encodeURIComponent('src/broken.ts');
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/git/changes/files/${filePath}/diff?stage=staged`);

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.diff).toBe('');
    });
});
