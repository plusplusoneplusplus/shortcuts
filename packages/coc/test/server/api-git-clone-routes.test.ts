/**
 * Tests for POST /api/git/clone against real repositories.
 *
 * The clone runs in the native addon now, so there is no `child_process.execFile`
 * left to mock and asserting "which child was spawned" would be asserting an
 * implementation that no longer exists. Every case below clones a real local
 * repository into a real temp directory instead — a clone from a filesystem
 * path needs no network, so it exercises the whole route end to end.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiGitRoutes } from '../../src/server/routes/api-git-routes';
import { deriveDefaultCloneDirectoryName } from '../../src/server/routes/api-git-clone-routes';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';

function request(
    url: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
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
        if (options.body !== undefined) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

describe('Git clone API routes', () => {
    let server: http.Server;
    let port: number;
    let tmpDir: string;
    let sourceRepo: string;
    let parentDir: string;

    beforeAll(async () => {
        const routes: Route[] = [];
        registerApiGitRoutes({
            routes,
            store: createMockProcessStore(),
            gitOpsStore: {} as any,
        });
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-route-'));
        // A source repository named without a `.git` suffix, so the directory
        // name the route derives from the URL is the directory git itself picks.
        sourceRepo = path.join(tmpDir, 'origin-repo');
        parentDir = path.join(tmpDir, 'parent');
        fs.mkdirSync(sourceRepo, { recursive: true });
        fs.mkdirSync(parentDir, { recursive: true });
        await execGitAsync(['init', '-q', '-b', 'main', '.'], sourceRepo);
        fs.writeFileSync(path.join(sourceRepo, 'README.md'), '# origin\n', 'utf-8');
        await execGitAsync(['add', '-A'], sourceRepo);
        await execGitAsync(
            ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'initial'],
            sourceRepo,
        );
    });

    afterEach(() => {
        // Best effort: on Windows a just-exited git child's handle can outlive
        // the call that spawned it, and the delete then fails with EPERM over a
        // temp directory the OS reclaims on its own.
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        } catch {
            // Reclaimed with the temp root; never worth a red suite.
        }
    });

    const base = () => `http://127.0.0.1:${port}`;

    it('clones a repository into the parent directory and returns the cloned path', async () => {
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: sourceRepo, parentDir },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(parentDir, 'origin-repo') });
        // The path the route reports is where git actually put the clone.
        expect(fs.readFileSync(path.join(parentDir, 'origin-repo', 'README.md'), 'utf-8')).toBe('# origin\n');
        expect(fs.existsSync(path.join(parentDir, 'origin-repo', '.git'))).toBe(true);
    });

    it('derives the default clone directory from every URL form the dialog accepts', () => {
        expect(deriveDefaultCloneDirectoryName('https://example.com/org/repo.git')).toBe('repo');
        expect(deriveDefaultCloneDirectoryName('git@example.com:team/service.git')).toBe('service');
        expect(deriveDefaultCloneDirectoryName('ssh://git@example.com/team/service')).toBe('service');
        expect(deriveDefaultCloneDirectoryName('https://example.com/org/repo/')).toBe('repo');
        expect(deriveDefaultCloneDirectoryName('https://example.com/org/repo.git?ref=main')).toBe('repo');
    });

    it('uses a custom dirName when provided, passing it to git and returning the custom cloned path', async () => {
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: sourceRepo, parentDir, dirName: 'repo-2' },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(parentDir, 'repo-2') });
        expect(fs.existsSync(path.join(parentDir, 'repo-2', 'README.md'))).toBe(true);
        // The URL-derived name was not used.
        expect(fs.existsSync(path.join(parentDir, 'origin-repo'))).toBe(false);
    });

    it('falls back to the URL-derived name when dirName is blank', async () => {
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: sourceRepo, parentDir, dirName: '   ' },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(parentDir, 'origin-repo') });
        expect(fs.existsSync(path.join(parentDir, 'origin-repo', 'README.md'))).toBe(true);
    });

    it('resolves a relative parentDir against the server process directory', async () => {
        const relative = path.relative(process.cwd(), parentDir);
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: sourceRepo, parentDir: relative },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(parentDir, 'origin-repo') });
    });

    it('surfaces git clone failures in the response body', async () => {
        const missing = path.join(tmpDir, 'not-a-repo');
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: missing, parentDir },
        });

        expect(res.status).toBe(500);
        // The native runner's wording, which the clone dialog shows verbatim.
        expect(res.json().error).toContain(`git clone ${missing} failed:`);
        // git's own wording for the same missing source, which is not the same
        // sentence everywhere: `does not exist` on Linux and macOS, `does not
        // appear to be a git repository` on Windows. What this pins is that
        // git's reason reaches the body, not which of the two it is.
        expect(res.json().error).toMatch(/does not exist|does not appear to be a git repository/);
    });

    it('reports a destination that already exists rather than overwriting it', async () => {
        fs.mkdirSync(path.join(parentDir, 'origin-repo'), { recursive: true });
        fs.writeFileSync(path.join(parentDir, 'origin-repo', 'keep.txt'), 'mine', 'utf-8');

        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: sourceRepo, parentDir },
        });

        expect(res.status).toBe(500);
        expect(res.json().error).toMatch(/already exists/);
        expect(fs.readFileSync(path.join(parentDir, 'origin-repo', 'keep.txt'), 'utf-8')).toBe('mine');
    });

    it('validates required fields before running git', async () => {
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: '   ' },
        });

        expect(res.status).toBe(400);
        expect(res.json()).toMatchObject({
            error: 'Missing required fields: url, parentDir',
            code: 'MISSING_FIELDS',
        });
    });
});
