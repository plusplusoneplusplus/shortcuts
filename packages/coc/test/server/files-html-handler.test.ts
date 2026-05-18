import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createExecutionServer } from '../../src/server/index';

function request(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

function isPathWithin(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function mkdtempOutsideAllowedRoots(prefix: string, disallowedRoots: string[]): string | undefined {
    const realDisallowedRoots = disallowedRoots
        .map((root) => {
            try {
                return fs.realpathSync(root);
            } catch {
                return undefined;
            }
        })
        .filter((root): root is string => !!root);

    for (const baseDir of [process.cwd(), os.homedir()]) {
        let realBaseDir: string;
        try {
            realBaseDir = fs.realpathSync(baseDir);
        } catch {
            continue;
        }

        if (realDisallowedRoots.some((root) => isPathWithin(realBaseDir, root))) {
            continue;
        }

        try {
            return fs.mkdtempSync(path.join(baseDir, prefix));
        } catch {
            continue;
        }
    }

    return undefined;
}

describe('GET /api/workspaces/:id/files/html', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    const wsId = 'html-ws';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-html-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-html-workspace-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        const res = await request(`${server.url}/api/workspaces`);
        expect(res.status).toBe(200);
        const createRes = await new Promise<{ status: number }>((resolve, reject) => {
            const parsed = new URL(`${server!.url}/api/workspaces`);
            const req = http.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port,
                    path: parsed.pathname,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                },
                (response) => {
                    response.resume();
                    response.on('end', () => resolve({ status: response.statusCode || 0 }));
                },
            );
            req.on('error', reject);
            req.write(JSON.stringify({ id: wsId, name: 'HTML Workspace', rootPath: workspaceDir }));
            req.end();
        });
        expect(createRes.status).toBe(201);
        return server;
    }

    it('returns in-repo HTML with sandboxing headers', async () => {
        const srv = await startServer();
        const filePath = path.join(workspaceDir, 'chart.html');
        fs.writeFileSync(filePath, '<html><body>chart</body></html>', 'utf-8');

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('chart.html')}`);

        expect(res.status).toBe(200);
        expect(res.body).toContain('chart');
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['content-security-policy']).toContain('sandbox allow-scripts');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['cache-control']).toContain('private');
    });

    it('rejects non-HTML extensions', async () => {
        const srv = await startServer();
        fs.writeFileSync(path.join(workspaceDir, 'chart.png'), 'not html', 'utf-8');

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('chart.png')}`);

        expect(res.status).toBe(415);
    });

    it('rejects relative traversal outside the workspace', async () => {
        const srv = await startServer();

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('../outside.html')}`);

        expect(res.status).toBe(403);
    });

    it('returns 404 for missing HTML files', async () => {
        const srv = await startServer();

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('missing.html')}`);

        expect(res.status).toBe(404);
    });

    it('rejects HTML files over 4 MB', async () => {
        const srv = await startServer();
        fs.writeFileSync(path.join(workspaceDir, 'large.html'), 'x'.repeat(4 * 1024 * 1024 + 1), 'utf-8');

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('large.html')}`);

        expect(res.status).toBe(413);
    });

    it('allows absolute HTML paths under the repo outputs directory', async () => {
        const srv = await startServer();
        const outputsDir = getRepoDataPath(dataDir, wsId, 'outputs');
        fs.mkdirSync(outputsDir, { recursive: true });
        const outputPath = path.join(outputsDir, 'dashboard.html');
        fs.writeFileSync(outputPath, '<html><body>dashboard</body></html>', 'utf-8');

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent(outputPath)}`);

        expect(res.status).toBe(200);
        expect(res.body).toContain('dashboard');
    });

    it('serves HTML from the system temp folder', async () => {
        const srv = await startServer();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-html-temp-'));
        try {
            const tempPath = path.join(tempDir, 'animation.html');
            fs.writeFileSync(tempPath, '<html><body>animation</body></html>', 'utf-8');

            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent(tempPath)}`);

            expect(res.status).toBe(200);
            expect(res.body).toContain('animation');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('accepts a file URL for an HTML path in the system temp folder', async () => {
        const srv = await startServer();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-html-file-url-'));
        try {
            const tempPath = path.join(tempDir, 'preview.html');
            fs.writeFileSync(tempPath, '<html><body>temp file url</body></html>', 'utf-8');

            const fileUrl = pathToFileURL(tempPath).href;
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent(fileUrl)}`);

            expect(res.status).toBe(200);
            expect(res.body).toContain('temp file url');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('accepts a file URL for an HTML path in the workspace', async () => {
        const srv = await startServer();
        const filePath = path.join(workspaceDir, 'workspace-url.html');
        fs.writeFileSync(filePath, '<html><body>workspace file url</body></html>', 'utf-8');

        const fileUrl = pathToFileURL(filePath).href;
        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent(fileUrl)}`);

        expect(res.status).toBe(200);
        expect(res.body).toContain('workspace file url');
    });

    it('serves HTML from the Copilot CLI session folder (~/.copilot)', async () => {
        const srv = await startServer();
        const copilotRoot = path.join(os.homedir(), '.copilot');
        fs.mkdirSync(copilotRoot, { recursive: true });
        const sessionDir = fs.mkdtempSync(path.join(copilotRoot, 'files-html-copilot-'));
        try {
            const filePath = path.join(sessionDir, 'session-output.html');
            fs.writeFileSync(filePath, '<html><body>copilot session</body></html>', 'utf-8');

            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent(filePath)}`);

            expect(res.status).toBe(200);
            expect(res.body).toContain('copilot session');
        } finally {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    });

    it('returns 403 for existing absolute HTML files outside allowed roots', async () => {
        const srv = await startServer();
        const outsideDir = mkdtempOutsideAllowedRoots('.files-html-outside-', [
            os.tmpdir(),
            workspaceDir,
            getRepoDataPath(dataDir, wsId, 'outputs'),
            path.join(os.homedir(), '.copilot'),
        ]);
        if (!outsideDir) {
            return;
        }

        try {
            const outsideFile = path.join(outsideDir, 'outside.html');
            fs.writeFileSync(outsideFile, '<html><body>outside</body></html>', 'utf-8');

            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent(outsideFile)}`);

            expect(res.status).toBe(403);
            expect(res.body).toContain('outside allowed HTML roots');
        } finally {
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    it('returns 400 for malformed file URLs', async () => {
        const srv = await startServer();

        const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('file://%00')}`);

        expect(res.status).toBe(400);
        expect(res.body).toContain('Invalid path');
    });

    it('rejects symlinks that resolve outside allowed roots when symlinks are available', async () => {
        const srv = await startServer();
        const outsideDir = mkdtempOutsideAllowedRoots('.files-html-symlink-outside-', [
            os.tmpdir(),
            workspaceDir,
            getRepoDataPath(dataDir, wsId, 'outputs'),
            path.join(os.homedir(), '.copilot'),
        ]);
        if (!outsideDir) {
            return;
        }

        try {
            const outsideFile = path.join(outsideDir, 'outside.html');
            const linkPath = path.join(workspaceDir, 'linked.html');
            fs.writeFileSync(outsideFile, '<html>outside</html>', 'utf-8');
            try {
                fs.symlinkSync(outsideFile, linkPath, 'file');
            } catch {
                return;
            }

            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/html?path=${encodeURIComponent('linked.html')}`);

            expect(res.status).toBe(403);
        } finally {
            fs.rmSync(outsideDir, { recursive: true, force: true });
        }
    });
});
