/**
 * Batch Operations Atomicity Tests (Section 10)
 *
 * Tests for POST /api/git-info/batch:
 *   - All-valid IDs → all results returned
 *   - One invalid ID mixed in → partial results with null for invalid ID
 *   - All-invalid IDs → all results are null (not 400)
 *   - 0 items → empty results object (not 400)
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock forge git services
// ============================================================================

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

// ============================================================================
// Helpers
// ============================================================================

const WS_A = { id: 'ws-a', name: 'project-a', rootPath: process.platform === 'win32' ? 'C:\\projects\\a' : '/projects/a' };
const WS_B = { id: 'ws-b', name: 'project-b', rootPath: process.platform === 'win32' ? 'C:\\projects\\b' : '/projects/b' };

function request(
    url: string,
    opts: { method?: string; body?: string } = {},
): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: opts.method ?? 'POST',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    let body: unknown;
                    try { body = JSON.parse(text); } catch { body = text; }
                    resolve({ status: res.statusCode ?? 0, body });
                });
            },
        );
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
    });
}

function makeServer(store: MockProcessStore): http.Server {
    const routes: Route[] = [];
    registerApiRoutes(routes, store);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(server: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });
}

async function stopServer(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

// ============================================================================
// POST /api/git-info/batch
// ============================================================================

describe('POST /api/git-info/batch — atomicity', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore({ initialWorkspaces: [WS_A, WS_B] });
        (store.getWorkspaces as any).mockResolvedValue([WS_A, WS_B]);
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('returns results for all-valid workspace IDs', async () => {
        const { status, body } = await request(`${baseUrl}/api/git-info/batch`, {
            body: JSON.stringify({ workspaceIds: ['ws-a', 'ws-b'] }),
        });
        expect(status).toBe(200);
        expect((body as any).results['ws-a']).toBeDefined();
        expect((body as any).results['ws-b']).toBeDefined();
    });

    it('returns null entry for invalid ID mixed with valid IDs', async () => {
        const { status, body } = await request(`${baseUrl}/api/git-info/batch`, {
            body: JSON.stringify({ workspaceIds: ['ws-a', 'ws-invalid'] }),
        });
        expect(status).toBe(200);
        expect((body as any).results['ws-a']).toBeDefined();
        expect((body as any).results['ws-invalid']).toBeNull();
    });

    it('returns null entries for all-invalid IDs (not 400)', async () => {
        const { status, body } = await request(`${baseUrl}/api/git-info/batch`, {
            body: JSON.stringify({ workspaceIds: ['bad-1', 'bad-2'] }),
        });
        expect(status).toBe(200);
        expect((body as any).results['bad-1']).toBeNull();
        expect((body as any).results['bad-2']).toBeNull();
    });

    it('returns empty results object for 0 workspace IDs (not 400)', async () => {
        const { status, body } = await request(`${baseUrl}/api/git-info/batch`, {
            body: JSON.stringify({ workspaceIds: [] }),
        });
        expect(status).toBe(200);
        expect((body as any).results).toEqual({});
    });

    it('returns 400 when workspaceIds is missing', async () => {
        const { status } = await request(`${baseUrl}/api/git-info/batch`, {
            body: JSON.stringify({}),
        });
        expect(status).toBe(400);
    });

    it('returns 400 when workspaceIds is not an array', async () => {
        const { status } = await request(`${baseUrl}/api/git-info/batch`, {
            body: JSON.stringify({ workspaceIds: 'not-an-array' }),
        });
        expect(status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
        const { status } = await request(`${baseUrl}/api/git-info/batch`, {
            body: '{broken json}',
        });
        expect(status).toBe(400);
    });
});
