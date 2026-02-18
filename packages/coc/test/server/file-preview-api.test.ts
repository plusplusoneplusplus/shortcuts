/**
 * File Preview API Endpoint Tests
 *
 * Tests for GET /api/workspaces/:id/files/preview endpoint
 * that returns file content for hover tooltips and full-content dialogs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
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
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('File Preview API', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-preview-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-preview-ws-'));
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
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    function createFile(relativePath: string, content: string): string {
        const fullPath = path.join(workspaceDir, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
        return fullPath;
    }

    // ========================================================================
    // Happy Path
    // ========================================================================

    describe('GET /api/workspaces/:id/files/preview — Happy Path', () => {
        it('returns first 20 lines by default', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
            const fullPath = createFile('src/main.ts', lines.join('\n'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.fileName).toBe('main.ts');
            expect(body.lines).toHaveLength(20);
            expect(body.lines[0]).toBe('Line 1');
            expect(body.lines[19]).toBe('Line 20');
            expect(body.totalLines).toBe(50);
            expect(body.truncated).toBe(true);
            expect(body.language).toBe('ts');
            expect(body.path).toBe(fullPath);
        });

        it('returns all lines when lines=0', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
            const fullPath = createFile('readme.md', lines.join('\n'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}&lines=0`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.lines).toHaveLength(30);
            expect(body.truncated).toBe(false);
        });

        it('returns custom number of lines', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
            const fullPath = createFile('data.txt', lines.join('\n'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}&lines=5`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.lines).toHaveLength(5);
            expect(body.truncated).toBe(true);
        });

        it('handles small files without truncation', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('small.txt', 'Hello\nWorld');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.lines).toHaveLength(2);
            expect(body.truncated).toBe(false);
            expect(body.totalLines).toBe(2);
        });

        it('returns correct language from extension', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('styles.css', 'body { color: red; }');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.language).toBe('css');
        });
    });

    // ========================================================================
    // Error Cases
    // ========================================================================

    describe('GET /api/workspaces/:id/files/preview — Error Cases', () => {
        it('returns 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/workspaces/nonexistent/files/preview?path=/some/file`
            );
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('returns 400 when path is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview`
            );
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Missing required query parameter');
        });

        it('returns 403 for path traversal outside workspace', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=/etc/passwd`
            );
            expect(res.status).toBe(403);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('outside workspace');
        });

        it('returns 404 for non-existent file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fakePath = path.join(workspaceDir, 'does-not-exist.ts');
            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fakePath)}`
            );
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('File not found');
        });

        it('returns 400 for binary file extensions', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('image.png', 'fake binary content');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Binary files');
        });

        it('returns 404 for directories', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const dirPath = path.join(workspaceDir, 'subdir');
            fs.mkdirSync(dirPath, { recursive: true });

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(dirPath)}`
            );
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Not a file');
        });
    });

    // ========================================================================
    // Edge Cases
    // ========================================================================

    describe('GET /api/workspaces/:id/files/preview — Edge Cases', () => {
        it('caps lines at 500 max', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`);
            const fullPath = createFile('big.txt', lines.join('\n'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}&lines=999`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.lines).toHaveLength(500);
            expect(body.truncated).toBe(true);
        });

        it('handles empty files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('empty.txt', '');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.lines).toHaveLength(0);
            expect(body.truncated).toBe(false);
        });

        it('handles files in nested subdirectories', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('deep/nested/dir/file.py', 'print("hello")');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.fileName).toBe('file.py');
            expect(body.language).toBe('py');
        });

        it('handles invalid lines parameter gracefully', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('test.txt', 'line1\nline2\nline3');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}&lines=abc`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Invalid lines defaults to 20
            expect(body.lines.length).toBeLessThanOrEqual(20);
        });

        it('rejects various binary extensions', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const binaryExts = ['.jpg', '.pdf', '.zip', '.exe', '.dll', '.woff2'];
            for (const ext of binaryExts) {
                const fullPath = createFile(`test${ext}`, 'data');
                const res = await request(
                    `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
                );
                expect(res.status).toBe(400);
            }
        });
    });
});
