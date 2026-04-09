import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        resolvePathForHostFilesystem: vi.fn((basePath: string, ...segments: string[]) => {
            if (basePath === '/home/tester/repo' && segments.length === 1 && segments[0] === '.git') {
                return String.raw`\\wsl$\Ubuntu\home\tester\repo\.git`;
            }
            return actual.resolvePathForHostFilesystem(basePath, ...segments);
        }),
    };
});

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
    };
});

function request(url: string): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        json: () => JSON.parse(body),
                    });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

describe('GET /api/workspaces — WSL repo detection', () => {
    let server: http.Server;
    let baseUrl: string;
    const store = createMockProcessStore();

    beforeAll(async () => {
        const routes: Route[] = [];
        registerApiRoutes(routes, store);
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.runIf(process.platform === 'win32')('marks Linux-style WSL roots as git repos via host path translation', async () => {
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: 'ws-wsl', name: 'repo', rootPath: '/home/tester/repo' },
        ]);

        const expectedGitDir = String.raw`\\wsl$\Ubuntu\home\tester\repo\.git`;
        vi.mocked(fs.existsSync).mockImplementation((target: fs.PathLike) => String(target) === expectedGitDir);

        const res = await request(`${baseUrl}/api/workspaces`);

        expect(res.status).toBe(200);
        expect(res.json().workspaces).toEqual([
            expect.objectContaining({ id: 'ws-wsl', isGitRepo: true }),
        ]);
        expect(fs.existsSync).toHaveBeenCalledWith(expectedGitDir);
    });
});
