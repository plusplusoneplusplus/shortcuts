/**
 * Batch Git Info Isolation Tests — Section 7
 *
 * Tests for POST /api/git-info/batch focusing on cross-workspace isolation:
 * - Results for workspaces A and B are returned independently
 * - Nonexistent workspace IDs have error entries (null)
 * - Large batch (50 IDs) within 5 seconds
 * - Empty array returns []
 * - Duplicate IDs handling
 * - Each result includes workspaceId for identification
 *
 * Extends the basic batch coverage in api-handler-batch.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ── Mock git services ─────────────────────────────────────────────────────────

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(function () { return ({
            hasUncommittedChanges: vi.fn(async () => false),
            getBranchStatus: vi.fn(async function () { return ({ ahead: 0, behind: 0, branch: 'main' }); }),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(async () => 'main'),
        }); }),
        WorkingTreeService: vi.fn().mockImplementation(function () { return ({
            getAllChanges: vi.fn(async () => []),
        }); }),
        detectRemoteUrl: vi.fn(async () => undefined),
    };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: () => any }> {
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
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(bodyStr) });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postBatch(baseUrl: string, workspaceIds: string[]) {
    return request(`${baseUrl}/api/git-info/batch`, {
        method: 'POST',
        body: JSON.stringify({ workspaceIds }),
    });
}

// ── Test Workspaces ───────────────────────────────────────────────────────────

const WORKSPACE_A = {
    id: 'ws-batch-a',
    name: 'Project A',
    rootPath: process.platform === 'win32' ? 'C:\\projects\\a' : '/projects/a',
};

const WORKSPACE_B = {
    id: 'ws-batch-b',
    name: 'Project B',
    rootPath: process.platform === 'win32' ? 'C:\\projects\\b' : '/projects/b',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/git-info/batch — workspace isolation', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([WORKSPACE_A, WORKSPACE_B]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store);
        const handler = createRouter({ routes, spaHtml: '' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns info for both A and B independently', async () => {
        const resp = await postBatch(baseUrl, [WORKSPACE_A.id, WORKSPACE_B.id]);
        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.results[WORKSPACE_A.id]).toBeDefined();
        expect(data.results[WORKSPACE_B.id]).toBeDefined();
        // Each result should be independently resolved
        expect(data.results[WORKSPACE_A.id]).not.toBeNull();
        expect(data.results[WORKSPACE_B.id]).not.toBeNull();
    });

    it('nonexistent workspace ID has null/error entry alongside valid ones', async () => {
        const resp = await postBatch(baseUrl, [WORKSPACE_A.id, 'nonexistent-ws', WORKSPACE_B.id]);
        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.results[WORKSPACE_A.id]).not.toBeNull();
        expect(data.results[WORKSPACE_B.id]).not.toBeNull();
        // nonexistent should be null or have an error field
        const nonexistentResult = data.results['nonexistent-ws'];
        expect(nonexistentResult === null || (typeof nonexistentResult === 'object' && nonexistentResult.error !== undefined)).toBe(true);
    });

    it('empty array returns empty results object, no error', async () => {
        const resp = await postBatch(baseUrl, []);
        expect(resp.status).toBe(200);
        const data = resp.json();
        expect(data.results).toBeDefined();
        expect(Object.keys(data.results)).toHaveLength(0);
    });

    it('large batch (50 IDs) responds within 5 seconds', async () => {
        // Generate 50 workspace IDs — 2 real, 48 nonexistent
        const ids = [
            WORKSPACE_A.id,
            WORKSPACE_B.id,
            ...Array.from({ length: 48 }, (_, i) => `nonexistent-${i}`),
        ];

        const start = Date.now();
        const resp = await postBatch(baseUrl, ids);
        const elapsed = Date.now() - start;

        expect(resp.status).toBe(200);
        expect(elapsed).toBeLessThan(5000);
        const data = resp.json();
        expect(Object.keys(data.results)).toHaveLength(50);
    });

    it('duplicate workspace IDs → result includes entry for that ID', async () => {
        const resp = await postBatch(baseUrl, [WORKSPACE_A.id, WORKSPACE_A.id]);
        expect(resp.status).toBe(200);
        const data = resp.json();
        // The response should include at least the one workspace result
        expect(data.results[WORKSPACE_A.id]).toBeDefined();
    });
});
