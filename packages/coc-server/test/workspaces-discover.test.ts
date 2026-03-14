/**
 * Tests for GET /api/workspaces/discover?path=<dir>
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ── Silence git-related calls ─────────────────────────────────────────────

vi.mock('child_process', () => ({
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
}));

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(() => ({
            getBranchStatus: vi.fn(),
            hasUncommittedChanges: vi.fn(),
        })),
        GitRangeService: vi.fn().mockImplementation(() => ({
            getCurrentBranch: vi.fn(),
            detectCommitRange: vi.fn(),
        })),
        detectRemoteUrl: vi.fn(() => undefined),
        GitOpsStore: vi.fn().mockImplementation(() => ({
            markStaleRunningJobs: vi.fn().mockResolvedValue(undefined),
        })),
    };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let store: MockProcessStore;
let server: http.Server;
let port: number;

function makeGitDir(parentDir: string, name: string): string {
    const dir = path.join(parentDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    return dir;
}

function makePlainDir(parentDir: string, name: string): string {
    const dir = path.join(parentDir, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            port = (server.address() as any).port;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

function get(urlPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: '127.0.0.1', port, path: urlPath, method: 'GET' },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, body: JSON.parse(text) });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-discover-'));
    store = createMockProcessStore();
    (store.getWorkspaces as any).mockResolvedValue([]);

    const routes: Route[] = [];
    registerApiRoutes(routes, store);
    const handler = createRouter({ routes, spaHtml: '' });
    server = http.createServer(handler);
    await startServer();
});

afterEach(async () => {
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/workspaces/discover', () => {
    it('returns git repos found in child directories', async () => {
        makeGitDir(tmpDir, 'repo-a');
        makeGitDir(tmpDir, 'repo-b');
        makePlainDir(tmpDir, 'not-a-repo');

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );

        expect(status).toBe(200);
        expect(Array.isArray(body.repos)).toBe(true);
        expect(body.repos).toHaveLength(2);
        const names = body.repos.map((r: any) => r.name).sort();
        expect(names).toEqual(['repo-a', 'repo-b']);
    });

    it('sets name to basename of directory path', async () => {
        makeGitDir(tmpDir, 'my-project');

        const { body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );

        expect(body.repos[0].name).toBe('my-project');
        expect(body.repos[0].path).toContain('my-project');
    });

    it('excludes already-registered repos', async () => {
        const repoA = makeGitDir(tmpDir, 'repo-a');
        makeGitDir(tmpDir, 'repo-b');

        (store.getWorkspaces as any).mockResolvedValue([
            { id: 'ws-1', name: 'repo-a', rootPath: repoA },
        ]);

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );

        expect(status).toBe(200);
        expect(body.repos).toHaveLength(1);
        expect(body.repos[0].name).toBe('repo-b');
    });

    it('returns empty array when no git repos found', async () => {
        makePlainDir(tmpDir, 'plain-a');
        makePlainDir(tmpDir, 'plain-b');

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );

        expect(status).toBe(200);
        expect(body.repos).toEqual([]);
    });

    it('returns empty array when all repos are already registered', async () => {
        const repoA = makeGitDir(tmpDir, 'repo-a');

        (store.getWorkspaces as any).mockResolvedValue([
            { id: 'ws-1', name: 'repo-a', rootPath: repoA },
        ]);

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );

        expect(status).toBe(200);
        expect(body.repos).toEqual([]);
    });

    it('returns 400 when path param is missing', async () => {
        const { status, body } = await get('/api/workspaces/discover');
        expect(status).toBe(400);
        expect(body.error).toMatch(/path/i);
    });

    it('returns 400 when path does not exist', async () => {
        const nonExistent = path.join(tmpDir, 'does-not-exist');
        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(nonExistent)}`,
        );
        expect(status).toBe(400);
        expect(body.error).toMatch(/does not exist/i);
    });

    it('returns 400 when path is a file, not a directory', async () => {
        const filePath = path.join(tmpDir, 'some-file.txt');
        fs.writeFileSync(filePath, 'hello');

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(filePath)}`,
        );
        expect(status).toBe(400);
        expect(body.error).toMatch(/not a directory/i);
    });

    it('does not include files (only directories) in results', async () => {
        makeGitDir(tmpDir, 'repo');
        fs.writeFileSync(path.join(tmpDir, 'somefile.txt'), '');

        const { body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );

        const names = body.repos.map((r: any) => r.name);
        expect(names).not.toContain('somefile.txt');
        expect(names).toContain('repo');
    });
});
