import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerApiGitRoutes } from '../../src/server/routes/api-git-routes';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';

const mockExecFile = vi.fn();

vi.mock('child_process', () => ({
    execFile: (...args: unknown[]) => mockExecFile(...args),
}));

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

    beforeEach(() => {
        mockExecFile.mockReset();
    });

    const base = () => `http://127.0.0.1:${port}`;

    it('clones a repository into the parent directory and returns the cloned path', async () => {
        mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
            callback(null, '', "Cloning into 'repo'...\n");
        });

        const parentDir = path.join(path.sep, 'tmp', 'repos');
        const resolvedParent = path.resolve(parentDir);
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: 'https://example.com/org/repo.git', parentDir },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(resolvedParent, 'repo') });
        expect(mockExecFile).toHaveBeenCalledWith(
            'git',
            ['clone', 'https://example.com/org/repo.git'],
            expect.objectContaining({ cwd: resolvedParent }),
            expect.any(Function),
        );
    });

    it('accepts scp-style SSH URLs when deriving the default clone directory', async () => {
        mockExecFile.mockImplementation((_cmd, _args, _options, callback) => callback(null, '', ''));

        const parentDir = path.join(path.sep, 'tmp', 'repos');
        const resolvedParent = path.resolve(parentDir);
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: 'git@example.com:team/service.git', parentDir },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(resolvedParent, 'service') });
    });

    it('uses a custom dirName when provided, passing it to git and returning the custom cloned path', async () => {
        mockExecFile.mockImplementation((_cmd, _args, _options, callback) => callback(null, '', ''));

        const parentDir = path.join(path.sep, 'tmp', 'repos');
        const resolvedParent = path.resolve(parentDir);
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: 'https://example.com/org/repo.git', parentDir, dirName: 'repo-2' },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(resolvedParent, 'repo-2') });
        expect(mockExecFile).toHaveBeenCalledWith(
            'git',
            ['clone', 'https://example.com/org/repo.git', 'repo-2'],
            expect.objectContaining({ cwd: resolvedParent }),
            expect.any(Function),
        );
    });

    it('falls back to the URL-derived name when dirName is blank', async () => {
        mockExecFile.mockImplementation((_cmd, _args, _options, callback) => callback(null, '', ''));

        const parentDir = path.join(path.sep, 'tmp', 'repos');
        const resolvedParent = path.resolve(parentDir);
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: 'https://example.com/org/myrepo.git', parentDir, dirName: '   ' },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ clonedPath: path.join(resolvedParent, 'myrepo') });
        // Blank dirName → no extra git arg.
        expect(mockExecFile).toHaveBeenCalledWith(
            'git',
            ['clone', 'https://example.com/org/myrepo.git'],
            expect.objectContaining({ cwd: resolvedParent }),
            expect.any(Function),
        );
    });

    it('surfaces git clone failures in the response body', async () => {
        mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
            const error = new Error('Command failed: git clone');
            callback(error, 'stdout detail\n', 'fatal: destination path already exists\n');
        });

        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: 'https://example.com/org/repo.git', parentDir: path.join(path.sep, 'tmp') },
        });

        expect(res.status).toBe(500);
        expect(res.json()).toEqual({
            error: 'fatal: destination path already exists\nstdout detail',
        });
    });

    it('validates required fields before spawning git', async () => {
        const res = await request(`${base()}/api/git/clone`, {
            method: 'POST',
            body: { url: '   ' },
        });

        expect(res.status).toBe(400);
        expect(res.json()).toMatchObject({
            error: 'Missing required fields: url, parentDir',
            code: 'MISSING_FIELDS',
        });
        expect(mockExecFile).not.toHaveBeenCalled();
    });
});
