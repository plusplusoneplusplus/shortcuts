/**
 * Tests for repo-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { createRouter } from '../../src/server/shared/router';
import { registerRepoRoutes } from '../../src/server/repos/repo-routes';
import type { Route } from '../../src/server/types';
import { safeRmSync } from '../helpers/safe-rm';

// Partially mock child_process: intercept only OS reveal commands (explorer.exe,
// open -R, xdg-open) used by the reveal route, forwarding all other spawn calls
// (e.g. git check-ignore) to the real implementation.
const REVEAL_COMMANDS = new Set(['explorer.exe', 'open', 'xdg-open']);
const { revealSpawnCalls } = vi.hoisted(() => ({
    revealSpawnCalls: [] as any[][],
}));
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    const realSpawn = actual.spawn;
    const wrappedSpawn = function (this: unknown, command: string, ...rest: any[]) {
        if (REVEAL_COMMANDS.has(command)) {
            revealSpawnCalls.push([command, ...rest]);
            return { unref: () => {}, on: () => {}, pid: 12345 } as any;
        }
        return (realSpawn as any).call(this, command, ...rest);
    } as typeof actual.spawn;
    return { ...actual, spawn: wrappedSpawn };
});

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
    safeRmSync(tmpDir);
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
        expect(res.headers.get('content-type')).toMatch(/application\/json/);
        const body = await res.json() as any;
        expect(body.content).toBe(content);
        expect(body.encoding).toBe('utf-8');
        expect(body.mimeType).toMatch(/text\/markdown/);
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

    it('returns base64-encoded JSON for binary files', async () => {
        seedDefaultRepo();
        const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
        fs.writeFileSync(path.join(repoDir, 'image.png'), binaryContent);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=image.png`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/application\/json/);
        const body = await res.json() as any;
        expect(body.encoding).toBe('base64');
        expect(body.mimeType).toBe('image/png');
        expect(Buffer.from(body.content, 'base64')).toEqual(binaryContent);
    });
});

describe('PUT /api/repos/:repoId/blob', () => {
    it('writes file content and returns success', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'hello.ts'), 'old content');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=hello.ts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'new content' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);

        // Verify file was actually written
        const written = fs.readFileSync(path.join(repoDir, 'hello.ts'), 'utf-8');
        expect(written).toBe('new content');
    });

    it('writes empty string content', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'file.txt'), 'non-empty');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=file.txt`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '' }),
        });
        expect(res.status).toBe(200);

        const written = fs.readFileSync(path.join(repoDir, 'file.txt'), 'utf-8');
        expect(written).toBe('');
    });

    it('returns 400 when path is missing', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'test' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/path/i);
    });

    it('returns 400 when content field is missing', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=hello.ts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/content/i);
    });

    it('returns 404 for unknown repo', async () => {
        const res = await fetch(`${baseUrl}/api/repos/nonexistent/blob?path=hello.ts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'test' }),
        });
        expect(res.status).toBe(404);
    });

    it('returns 400 for directory traversal', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/blob?path=../outside`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'evil' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/directory traversal/i);
    });
});

describe('GET /api/repos/:repoId/files', () => {
    it('returns all files recursively', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hello');
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export {}');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/files`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.files).toBeDefined();
        expect(Array.isArray(body.files)).toBe(true);
        expect(body.files).toContain('README.md');
        expect(body.files).toContain('src/index.ts');
        expect(typeof body.truncated).toBe('boolean');
    });

    it('returns 404 for unknown repo', async () => {
        const res = await fetch(`${baseUrl}/api/repos/nonexistent/files`);
        expect(res.status).toBe(404);
    });

    it('scopes to subdirectory with path param', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'root.txt'), '');
        fs.writeFileSync(path.join(repoDir, 'src', 'main.ts'), '');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/files?path=src`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.files).toContain('src/main.ts');
        expect(body.files).not.toContain('root.txt');
    });
});

describe('GET /api/repos/:repoId/search', () => {
    it('returns scored results sorted by score descending', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'index.ts'), '');
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), '');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=index`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.results).toBeDefined();
        expect(Array.isArray(body.results)).toBe(true);
        expect(typeof body.truncated).toBe('boolean');
        for (const item of body.results) {
            expect(typeof item.path).toBe('string');
            expect(typeof item.score).toBe('number');
        }
        // verify sorted descending
        for (let i = 1; i < body.results.length; i++) {
            expect(body.results[i - 1].score).toBeGreaterThanOrEqual(body.results[i].score);
        }
    });

    it('returns 400 when q is missing', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/q/i);
    });

    it('returns 400 when q is empty string', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=`);
        expect(res.status).toBe(400);
    });

    it('returns 404 for unknown repo', async () => {
        const res = await fetch(`${baseUrl}/api/repos/nonexistent/search?q=index`);
        expect(res.status).toBe(404);
    });

    it('respects limit param', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(repoDir, `file${i}.ts`), '');
        }

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=file&limit=3`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.results.length).toBeLessThanOrEqual(3);
    });

    it('clamps limit below 1 to 1', async () => {
        seedDefaultRepo();
        for (let i = 0; i < 5; i++) {
            fs.writeFileSync(path.join(repoDir, `a${i}.ts`), '');
        }

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=a&limit=0`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.results.length).toBeLessThanOrEqual(1);
    });

    it('clamps limit above 200 to 200', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'index.ts'), '');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=index&limit=9999`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.results.length).toBeLessThanOrEqual(200);
    });

    it('forwards showIgnored=true to listFilesRecursive', { timeout: 60_000 }, async () => {
        seedDefaultRepo();
        // Create a .gitignore that ignores dist/
        initGitRepo(repoDir);
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'dist/\n');
        fs.mkdirSync(path.join(repoDir, 'dist'));
        fs.writeFileSync(path.join(repoDir, 'dist', 'bundle.js'), '');

        const resIgnored = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=bundle&showIgnored=false`);
        expect(resIgnored.status).toBe(200);
        const bodyIgnored = await resIgnored.json() as any;
        const pathsIgnored = bodyIgnored.results.map((r: any) => r.path);
        // Without showIgnored, gitignored files should not appear
        expect(pathsIgnored).not.toContain('dist/bundle.js');

        const resShown = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search?q=bundle&showIgnored=true`);
        expect(resShown.status).toBe(200);
        const bodyShown = await resShown.json() as any;
        const pathsShown = bodyShown.results.map((r: any) => r.path);
        expect(pathsShown).toContain('dist/bundle.js');
    });
});

describe('GET /api/repos/:repoId/search/content', () => {
    function seedSearchableRepo(): void {
        seedDefaultRepo();
        initGitRepo(repoDir);
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src', 'alpha.ts'), 'const needle = 1;\nconst other = 2;\n');
        fs.writeFileSync(path.join(repoDir, 'src', 'beta.ts'), 'export const NEEDLE = 3;\n');
        fs.writeFileSync(path.join(repoDir, 'root.txt'), 'a needle at the root\n');
    }

    it('returns matches grouped-ready and sorted, with the matched span addressable', async () => {
        seedSearchableRepo();

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(typeof body.truncated).toBe('boolean');

        const paths = body.matches.map((m: any) => m.path);
        // Case-insensitive by default, so beta.ts's NEEDLE is in too.
        expect(paths).toEqual(['root.txt', 'src/alpha.ts', 'src/beta.ts']);
        for (const match of body.matches) {
            expect(match.line).toBeGreaterThan(0);
            expect(match.text.slice(match.startColumn, match.endColumn).toLowerCase()).toBe('needle');
            expect(Array.isArray(match.before)).toBe(true);
            expect(Array.isArray(match.after)).toBe(true);
        }
    });

    it('returns 400 when q is missing', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/q/i);
    });

    it('returns 400 when q is empty', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=`);
        expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown repo', async () => {
        const res = await fetch(`${baseUrl}/api/repos/nonexistent/search/content?q=needle`);
        expect(res.status).toBe(404);
    });

    it('returns 404 when the registered repo root no longer exists on disk', async () => {
        seedWorkspacesJson([{ id: REPO_ID, name: REPO_NAME, rootPath: path.join(tmpDir, 'deleted-repo') }]);

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle`);
        expect(res.status).toBe(404);
    });

    it('rejects directory traversal in the path scope', async () => {
        seedSearchableRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&path=${encodeURIComponent('../..')}`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/traversal/i);
    });

    it('scopes the search to a subfolder and keeps paths repo-relative', async () => {
        seedSearchableRepo();

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&path=src`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        // Rooted at src/, but the paths a client clicks are still repo-relative
        // and carry no './' prefix from the scope.
        expect(body.matches.map((m: any) => m.path)).toEqual(['src/alpha.ts', 'src/beta.ts']);
    });

    it('treats path=. as the whole repo rather than a subfolder', async () => {
        seedSearchableRepo();

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&path=.`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.matches.map((m: any) => m.path)).toEqual(['root.txt', 'src/alpha.ts', 'src/beta.ts']);
    });

    it('honours caseSensitive', async () => {
        seedSearchableRepo();

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=NEEDLE&caseSensitive=true`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.matches.map((m: any) => m.path)).toEqual(['src/beta.ts']);
    });

    it('honours wholeWord', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'words.txt'), 'needles\nneedle\n');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&wholeWord=true`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.matches.map((m: any) => m.line)).toEqual([2]);
    });

    it('treats the query as a literal unless regex=true', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'meta.txt'), 'a+b\naab\n');

        const literal = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=${encodeURIComponent('a+b')}`);
        expect(literal.status).toBe(200);
        expect(((await literal.json()) as any).matches.map((m: any) => m.line)).toEqual([1]);

        const asRegex = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=${encodeURIComponent('a+b')}&regex=true`);
        expect(asRegex.status).toBe(200);
        expect(((await asRegex.json()) as any).matches.map((m: any) => m.line)).toEqual([2]);
    });

    it('survives URL-encoded percent and plus characters in the query', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'chars.txt'), 'discount 50%+tax\n');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=${encodeURIComponent('50%+tax')}`);
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.matches).toHaveLength(1);
        expect(body.matches[0].text.slice(body.matches[0].startColumn, body.matches[0].endColumn)).toBe('50%+tax');
    });

    it('returns 400 with the parse message for an invalid regex', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'anything\n');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=${encodeURIComponent('(unclosed')}&regex=true`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/invalid regular expression/i);
    });

    it('honours showIgnored', async () => {
        seedDefaultRepo();
        initGitRepo(repoDir);
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'dist/\n');
        fs.mkdirSync(path.join(repoDir, 'dist'));
        fs.writeFileSync(path.join(repoDir, 'dist', 'bundle.js'), 'var needle = 1;\n');

        const hidden = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle`);
        expect(((await hidden.json()) as any).matches).toHaveLength(0);

        const shown = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&showIgnored=true`);
        expect(((await shown.json()) as any).matches.map((m: any) => m.path)).toEqual(['dist/bundle.js']);
    });

    it('filters by include and exclude globs', async () => {
        seedSearchableRepo();

        const included = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&include=*.ts`);
        expect(((await included.json()) as any).matches.map((m: any) => m.path)).toEqual(['src/alpha.ts', 'src/beta.ts']);

        const excluded = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&exclude=${encodeURIComponent('src/beta.ts')}`);
        expect(((await excluded.json()) as any).matches.map((m: any) => m.path)).toEqual(['root.txt', 'src/alpha.ts']);
    });

    it('accepts globs both repeated and comma-joined', async () => {
        seedSearchableRepo();

        const repeated = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&exclude=*.txt&exclude=${encodeURIComponent('src/beta.ts')}`);
        const joined = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&exclude=${encodeURIComponent('*.txt,src/beta.ts')}`);

        const expected = ['src/alpha.ts'];
        expect(((await repeated.json()) as any).matches.map((m: any) => m.path)).toEqual(expected);
        expect(((await joined.json()) as any).matches.map((m: any) => m.path)).toEqual(expected);
    });

    it('clamps limit and reports truncation when the cap bites', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'many.txt'), 'needle\n'.repeat(10));

        const capped = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&limit=2`);
        expect(capped.status).toBe(200);
        const cappedBody = await capped.json() as any;
        expect(cappedBody.matches).toHaveLength(2);
        expect(cappedBody.truncated).toBe(true);

        // Above the hard cap is clamped down to it, never honoured.
        const over = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=needle&limit=9999`);
        expect(over.status).toBe(200);
        const overBody = await over.json() as any;
        expect(overBody.matches).toHaveLength(10);
        expect(overBody.truncated).toBe(false);
    });

    it('returns an empty result for a query that matches nothing', async () => {
        seedSearchableRepo();

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/search/content?q=zzzznotpresent`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ matches: [], truncated: false });
    });
});

describe('GET /api/repos/:repoId/reveal', () => {
    beforeEach(() => {
        revealSpawnCalls.length = 0;
    });

    it('returns 204 for a valid file path', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hello');

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/reveal?path=README.md`);
        expect(res.status).toBe(204);
    });

    it('returns 204 for a valid directory path', async () => {
        seedDefaultRepo();
        fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });

        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/reveal?path=src`);
        expect(res.status).toBe(204);
    });

    it('calls spawn with platform-appropriate command', async () => {
        seedDefaultRepo();
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hello');

        await fetch(`${baseUrl}/api/repos/${REPO_ID}/reveal?path=README.md`);

        expect(revealSpawnCalls).toHaveLength(1);
        const [cmd, args, opts] = revealSpawnCalls[0];
        const absPath = path.resolve(repoDir, 'README.md');

        if (process.platform === 'win32') {
            expect(cmd).toBe('explorer.exe');
            expect(args).toEqual([`/select,${absPath}`]);
        } else if (process.platform === 'darwin') {
            expect(cmd).toBe('open');
            expect(args).toEqual(['-R', absPath]);
        } else {
            expect(cmd).toBe('xdg-open');
            expect(args).toEqual([path.dirname(absPath)]);
        }
        expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });
    });

    it('returns 400 when path is missing', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/reveal`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/path/i);
    });

    it('returns 400 for directory traversal', async () => {
        seedDefaultRepo();
        const res = await fetch(`${baseUrl}/api/repos/${REPO_ID}/reveal?path=../../etc/passwd`);
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toMatch(/directory traversal/i);
    });

    it('does not call spawn for invalid requests', async () => {
        seedDefaultRepo();
        await fetch(`${baseUrl}/api/repos/${REPO_ID}/reveal?path=../../etc/passwd`);
        expect(revealSpawnCalls).toHaveLength(0);
    });

    it('returns 404 for unknown repo', async () => {
        const res = await fetch(`${baseUrl}/api/repos/nonexistent/reveal?path=README.md`);
        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.error).toBeDefined();
    });
});
