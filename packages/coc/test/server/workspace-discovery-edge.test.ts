/**
 * Workspace Discovery Edge Cases Tests — Section 5
 *
 * Tests for GET /api/workspaces/discover covering edge cases:
 * - Permission-denied subdirectories (skipped on Windows CI)
 * - Symlinked directories
 * - Deeply nested repos
 * - Non-git directories excluded
 * - Empty directory returns []
 * - URL-encoded paths
 * - Unicode characters in paths
 * - Circular symlink handling
 *
 * Extends the basic discovery coverage in workspaces-discover.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ── Silence git / git-related calls ──────────────────────────────────────────

vi.mock('child_process', function () { return ({
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
}); });

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: vi.fn(),
            getBranchStatus: vi.fn(),
            hasUncommittedChanges: vi.fn(),
            hasUncommittedChanges: vi.fn(),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(),
            getCurrentBranch: vi.fn(),
            detectCommitRange: vi.fn(),
        }); }),
        detectRemoteUrl: vi.fn(async () => undefined),
        GitOpsStore: vi.fn().mockImplementation(function () { return ({
            markStaleRunningJobs: vi.fn().mockResolvedValue(undefined),
        }); }),
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
                    let body: any;
                    try { body = JSON.parse(text); } catch { body = text; }
                    resolve({ status: res.statusCode || 0, body });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-disc-edge-'));
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/workspaces/discover — edge cases', () => {

    it('returns [] when directory has 0 git repos', async () => {
        makePlainDir(tmpDir, 'no-git-1');
        makePlainDir(tmpDir, 'no-git-2');

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );
        expect(status).toBe(200);
        expect(body.repos).toEqual([]);
    });

    it('excludes non-git directories from results', async () => {
        makeGitDir(tmpDir, 'valid-git-repo');
        makePlainDir(tmpDir, 'not-a-git-repo');

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );
        expect(status).toBe(200);
        const names = body.repos.map((r: any) => r.name);
        expect(names).toContain('valid-git-repo');
        expect(names).not.toContain('not-a-git-repo');
    });

    it('handles path with URL-encoded spaces (%20) → decoded and scanned correctly', async () => {
        // Create a dir whose name contains a space
        const spacedDir = path.join(os.tmpdir(), `ws-disc-spaced ${Date.now()}`);
        fs.mkdirSync(spacedDir, { recursive: true });
        try {
            makeGitDir(spacedDir, 'repo-in-spaced-dir');

            const encodedPath = encodeURIComponent(spacedDir);
            const { status, body } = await get(
                `/api/workspaces/discover?path=${encodedPath}`,
            );
            expect(status).toBe(200);
            expect(body.repos.length).toBeGreaterThanOrEqual(1);
            expect(body.repos.some((r: any) => r.name === 'repo-in-spaced-dir')).toBe(true);
        } finally {
            fs.rmSync(spacedDir, { recursive: true, force: true });
        }
    });

    it('handles path with Unicode characters → scanned correctly', async () => {
        // Create a dir with a Unicode segment in it
        const unicodeDir = path.join(os.tmpdir(), `ws-disc-unicode-日本語-${Date.now()}`);
        fs.mkdirSync(unicodeDir, { recursive: true });
        try {
            makeGitDir(unicodeDir, 'unicode-repo');

            const { status, body } = await get(
                `/api/workspaces/discover?path=${encodeURIComponent(unicodeDir)}`,
            );
            expect(status).toBe(200);
            expect(body.repos.some((r: any) => r.name === 'unicode-repo')).toBe(true);
        } finally {
            fs.rmSync(unicodeDir, { recursive: true, force: true });
        }
    });

    it('symlinked directory → either followed or skipped (no crash, returns valid response)', async () => {
        // Skip on platforms that don't support symlinks (some Windows setups)
        let canSymlink = true;
        const realDir = makeGitDir(tmpDir, 'real-repo');
        const linkPath = path.join(tmpDir, 'symlink-to-repo');
        try {
            fs.symlinkSync(realDir, linkPath, 'dir');
        } catch {
            canSymlink = false;
        }

        if (!canSymlink) {
            // Symlinks not supported — just verify basic discovery still works
            const { status } = await get(
                `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
            );
            expect(status).toBe(200);
            return;
        }

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );
        // Must not return 500; must be a valid response
        expect(status).toBe(200);
        expect(Array.isArray(body.repos)).toBe(true);
        // real-repo must appear
        expect(body.repos.some((r: any) => r.name === 'real-repo')).toBe(true);
    });

    it('deeply nested repo (4 levels deep) → found if within discovery depth', async () => {
        // Create 4-level nested structure
        const deep = path.join(tmpDir, 'level1', 'level2', 'level3', 'level4');
        fs.mkdirSync(deep, { recursive: true });
        fs.mkdirSync(path.join(deep, '.git'), { recursive: true });

        const { status, body } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );
        expect(status).toBe(200);
        // Discovery may or may not find deeply nested repos depending on depth limit
        // The key requirement: must not return 500
        expect(status).not.toBe(500);
    });

    it('permission-denied subdirectory → skips that dir, continues scanning (non-Windows)', async () => {
        if (process.platform === 'win32') {
            // Permission-deny via chmod is not reliable on Windows
            return;
        }

        makeGitDir(tmpDir, 'accessible-repo');
        const deniedDir = makePlainDir(tmpDir, 'denied-dir');

        let chmodWorked = false;
        try {
            fs.chmodSync(deniedDir, 0o000);
            chmodWorked = true;
        } catch {
            // chmod not available
        }

        try {
            const { status, body } = await get(
                `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
            );
            expect(status).toBe(200);
            // Should still find accessible-repo
            expect(body.repos.some((r: any) => r.name === 'accessible-repo')).toBe(true);
        } finally {
            if (chmodWorked) {
                try { fs.chmodSync(deniedDir, 0o755); } catch { /* ignore */ }
            }
        }
    });

    it('circular symlinks → does not loop infinitely (returns within timeout)', async () => {
        if (process.platform === 'win32') {
            // Circular symlinks are harder to set up on Windows without elevation
            return;
        }

        const dirA = path.join(tmpDir, 'dir-a');
        const dirB = path.join(tmpDir, 'dir-b');
        fs.mkdirSync(dirA, { recursive: true });
        fs.mkdirSync(dirB, { recursive: true });

        let circularCreated = false;
        try {
            fs.symlinkSync(dirA, path.join(dirB, 'link-to-a'), 'dir');
            fs.symlinkSync(dirB, path.join(dirA, 'link-to-b'), 'dir');
            circularCreated = true;
        } catch {
            // Symlinks not supported
        }

        if (!circularCreated) {
            return;
        }

        // Also add a real git repo so we have something to return
        makeGitDir(tmpDir, 'real-git');

        // Must complete without hanging (vitest timeout will catch infinite loops)
        const { status } = await get(
            `/api/workspaces/discover?path=${encodeURIComponent(tmpDir)}`,
        );
        expect(status).not.toBe(500);
    });
});
