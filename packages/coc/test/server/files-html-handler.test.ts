import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
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

    it('rejects symlinks that resolve outside allowed roots when symlinks are available', async () => {
        const srv = await startServer();
        const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-html-outside-'));
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
