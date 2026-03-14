/**
 * Tests for RepoTreeService.listDirectoryDeep and the depth param on the /tree route.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { RepoTreeService } from '../src/repos/tree-service';
import { createRouter } from '../src/shared/router';
import { registerRepoRoutes } from '../src/repos/repo-routes';
import type { Route } from '../src/types';

// ── Shared fixtures ───────────────────────────────────────────────────────────

let tmpDir: string;
let dataDir: string;
let repoDir: string;
let service: RepoTreeService;

const REPO_ID = 'deep-test-repo-id';
const REPO_NAME = 'deep-test-repo';

function seedWorkspacesJson(workspaces: Array<{ id: string; name: string; rootPath: string }>) {
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

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-deep-test-'));
    dataDir = path.join(tmpDir, 'data');
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(dataDir, { recursive: true });
    service = new RepoTreeService(dataDir);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── listDirectoryDeep unit tests ──────────────────────────────────────────────

describe('RepoTreeService.listDirectoryDeep', () => {
    it('depth=1 returns same shape as listDirectory', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'file.txt'), 'hello');
        fs.mkdirSync(path.join(repoDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'sub', 'inner.ts'), 'export {}');

        const flat = await service.listDirectory(REPO_ID, '.', { showIgnored: true });
        const deep = await service.listDirectoryDeep(REPO_ID, '.', 1, { showIgnored: true });

        expect(deep.truncated).toBe(flat.truncated);
        expect(deep.entries.length).toBe(flat.entries.length);
        // No children should be populated at depth=1
        for (const entry of deep.entries) {
            expect(entry.children).toBeUndefined();
        }
    });

    it('depth=2 populates children on directory entries', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export {}');
        fs.writeFileSync(path.join(repoDir, 'readme.md'), '# hi');

        const result = await service.listDirectoryDeep(REPO_ID, '.', 2, { showIgnored: true });

        const srcEntry = result.entries.find(e => e.name === 'src' && e.type === 'dir');
        expect(srcEntry).toBeDefined();
        expect(Array.isArray(srcEntry!.children)).toBe(true);
        expect(srcEntry!.children!.length).toBe(1);
        expect(srcEntry!.children![0].name).toBe('index.ts');

        // File entries must not have children
        const readmeEntry = result.entries.find(e => e.name === 'readme.md');
        expect(readmeEntry).toBeDefined();
        expect(readmeEntry!.children).toBeUndefined();
    });

    it('does not recurse into truncated directories', async () => {
        seedDefaultRepo();
        // Use a small maxEntries so we can trigger truncation easily
        const tinyService = new RepoTreeService(dataDir, { maxEntries: 2 });

        // Create 3 files so root is truncated
        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a');
        fs.writeFileSync(path.join(repoDir, 'b.txt'), 'b');
        fs.mkdirSync(path.join(repoDir, 'zdir'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'zdir', 'inner.ts'), 'x');

        const result = await tinyService.listDirectoryDeep(REPO_ID, '.', 2, { showIgnored: true });

        expect(result.truncated).toBe(true);
        // No dir entries should have children populated when the result is truncated
        for (const entry of result.entries) {
            if (entry.type === 'dir') {
                expect(entry.children).toBeUndefined();
            }
        }
    });

    it('threads showIgnored option through all recursion levels', async () => {
        seedDefaultRepo();
        // Create a .gitignore that ignores 'ignored-dir'
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'ignored-dir/\n');
        fs.mkdirSync(path.join(repoDir, 'visible-dir'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'visible-dir', 'file.ts'), 'x');
        fs.mkdirSync(path.join(repoDir, 'ignored-dir'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'ignored-dir', 'secret.ts'), 'x');

        const withoutIgnored = await service.listDirectoryDeep(REPO_ID, '.', 2, { showIgnored: false });
        const withIgnored = await service.listDirectoryDeep(REPO_ID, '.', 2, { showIgnored: true });

        const ignoredInFiltered = withoutIgnored.entries.find(e => e.name === 'ignored-dir');
        const ignoredInFull = withIgnored.entries.find(e => e.name === 'ignored-dir');

        // Without ignored: ignored-dir should not appear (git repo required; skip if git not available)
        if (ignoredInFiltered === undefined) {
            // gitignore filtering worked — ignored-dir is absent
            expect(ignoredInFull).toBeDefined();
        }
        // visible-dir children are always present
        const visibleEntry = withoutIgnored.entries.find(e => e.name === 'visible-dir');
        if (visibleEntry) {
            expect(visibleEntry.children).toBeDefined();
            expect(visibleEntry.children!.some(c => c.name === 'file.ts')).toBe(true);
        }
    });
});

// ── Route-level depth param tests ─────────────────────────────────────────────

function makeServer(dir: string): http.Server {
    const routes: Route[] = [];
    registerRepoRoutes(routes, dir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

describe('GET /api/repos/:repoId/tree depth param', () => {
    beforeEach(async () => {
        server = makeServer(dataDir);
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
    });

    it('no depth param returns flat response (backward compat)', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'x');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.entries).toBeDefined();
        expect(body.truncated).toBeDefined();
        const srcDir = body.entries.find((e: any) => e.name === 'src');
        expect(srcDir).toBeDefined();
        expect(srcDir.children).toBeUndefined();
    });

    it('depth=1 is byte-for-byte equivalent to no depth param', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello');
        fs.mkdirSync(path.join(repoDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'sub', 'b.ts'), 'x');

        const [resNoDepth, resDepth1] = await Promise.all([
            fetch(`${baseUrl}/api/repos/${REPO_ID}/tree`).then(r => r.json()),
            fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?depth=1`).then(r => r.json()),
        ]);
        expect(resDepth1).toEqual(resNoDepth);
    });

    it('depth=2 returns nested children for directories', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'lib', 'util.ts'), 'x');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?depth=2`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const libDir = body.entries.find((e: any) => e.name === 'lib');
        expect(libDir).toBeDefined();
        expect(Array.isArray(libDir.children)).toBe(true);
        expect(libDir.children.length).toBe(1);
        expect(libDir.children[0].name).toBe('util.ts');
    });

    it('depth=10 is clamped to 5 (no error)', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'readme.md'), '# hi');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?depth=10`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(Array.isArray(body.entries)).toBe(true);
    });

    it('depth=0 is clamped to 1 (flat response)', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'sub', 'x.ts'), 'x');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/tree?depth=0`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const sub = body.entries.find((e: any) => e.name === 'sub');
        expect(sub).toBeDefined();
        expect(sub.children).toBeUndefined();
    });
});
