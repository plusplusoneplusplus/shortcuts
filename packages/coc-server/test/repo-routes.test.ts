/**
 * Tests for repo-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { createRouter } from '../src/shared/router';
import { registerRepoRoutes } from '../src/repos/repo-routes';
import type { Route } from '../src/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let dataDir: string;
let repoDir: string;
let server: http.Server;
let baseUrl: string;

const REPO_ID = 'test-repo-id';
const REPO_NAME = 'test-repo';

function makeServer(dir: string): http.Server {
    const routes: Route[] = [];
    registerRepoRoutes(routes, dir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

function seedWorkspacesJson(workspaces: Array<{ id: string; name: string; rootPath: string; remoteUrl?: string }>) {
    fs.writeFileSync(
        path.join(dataDir, 'workspaces.json'),
        JSON.stringify(workspaces, null, 2),
        'utf-8',
    );
}

function seedDefaultRepo() {
    fs.mkdirSync(repoDir, { recursive: true });
    seedWorkspacesJson([{ id: REPO_ID, name: REPO_NAME, rootPath: repoDir }]);
}

function initGitRepo(dir: string): void {
    childProcess.execSync('git init', { cwd: dir, stdio: 'pipe' });
    childProcess.execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    childProcess.execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-routes-test-'));
    dataDir = path.join(tmpDir, 'data');
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(dataDir, { recursive: true });
    server = makeServer(dataDir);
    await startServer();
});

afterEach(async () => {
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/repos', () => {
    it('returns repo list', async () => {
        seedDefaultRepo();
        initGitRepo(repoDir);
        // Create at least one commit so HEAD exists
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test');
        childProcess.execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

        const res = await fetch(`${baseUrl}/api/repos`);
        expect(res.status).toBe(200);
        const body = await res.json() as any[];
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(REPO_ID);
        expect(body[0].name).toBe(REPO_NAME);
        expect(body[0].localPath).toBe(repoDir);
        expect(body[0].headSha).toBeTruthy();
    });

    it('returns empty array when no workspaces', async () => {
        const res = await fetch(`${baseUrl}/api/repos`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual([]);
    });
});

describe('GET /api/repos/:repoId/tree', () => {
    it('lists root directory', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hello');
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export {}');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.entries).toBeDefined();
        expect(Array.isArray(body.entries)).toBe(true);

        // dirs-first
        const dirEntries = body.entries.filter((e: any) => e.type === 'dir');
        const fileEntries = body.entries.filter((e: any) => e.type === 'file');
        expect(dirEntries.length).toBeGreaterThan(0);
        expect(fileEntries.length).toBeGreaterThan(0);

        // Verify dir comes before file in the array
        const firstDirIdx = body.entries.findIndex((e: any) => e.type === 'dir');
        const lastFileIdx = body.entries.length - 1 - [...body.entries].reverse().findIndex((e: any) => e.type === 'file');
        expect(firstDirIdx).toBeLessThan(lastFileIdx);
    });

    it('lists subdirectory', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export {}');
        fs.writeFileSync(path.join(repoDir, 'src', 'utils.ts'), 'export const x = 1;');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?path=src`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.entries).toBeDefined();
        const names = body.entries.map((e: any) => e.name);
        expect(names).toContain('index.ts');
        expect(names).toContain('utils.ts');
    });

    it('returns 404 for unknown repo', async () => {
        const res = await fetch(`${baseUrl}/api/repos/nonexistent/tree`);
        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.error).toBeDefined();
    });

    it('returns 400 for directory traversal', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?path=../../etc`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/directory traversal/i);
    });

    it('treats path=/ as repo root', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hello');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?path=/`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.entries).toBeDefined();
        const names = body.entries.map((e: any) => e.name);
        expect(names).toContain('README.md');
    });

    it('strips leading slash from subdirectory path', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export {}');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?path=/src`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const names = body.entries.map((e: any) => e.name);
        expect(names).toContain('index.ts');
    });
});

describe('GET /api/repos/:repoId/blob', () => {
    it('returns file content', async () => {
        seedDefaultRepo();
        const content = '# My Readme\n\nHello world!';
        fs.writeFileSync(path.join(repoDir, 'README.md'), content);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=README.md`);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toBe(content);
        expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    });

    it('returns 400 when path is missing', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/path/i);
    });

    it('returns 404 for missing file', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=nonexistent.txt`);
        expect(res.status).toBe(404);
    });

    it('returns 400 for directory traversal', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=../outside`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/directory traversal/i);
    });
});
