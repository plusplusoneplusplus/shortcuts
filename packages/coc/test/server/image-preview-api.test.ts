/**
 * Image Preview API Endpoint Tests
 *
 * Tests for GET /api/workspaces/:id/files/preview with image files.
 * Verifies that image files return base64-encoded content instead of
 * the "Binary files not supported" error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

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

describe('Image Preview API', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-preview-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-preview-ws-'));
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

    function createFile(relativePath: string, content: string | Buffer): string {
        const fullPath = path.join(workspaceDir, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
        return fullPath;
    }

    // ========================================================================
    // SVG Image Preview
    // ========================================================================

    describe('SVG files', () => {
        it('returns type=image with base64 content for .svg files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
            const fullPath = createFile('diagram.svg', svgContent);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('image');
            expect(body.fileName).toBe('diagram.svg');
            expect(body.mimeType).toBe('image/svg+xml');
            expect(body.content).toBe(Buffer.from(svgContent).toString('base64'));
            expect(body.size).toBe(Buffer.from(svgContent).length);
            expect(body.path).toBe(fullPath);
        });
    });

    // ========================================================================
    // Other Image Types
    // ========================================================================

    describe('Raster image files', () => {
        it('returns type=image for .png files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const pngData = Buffer.from('fake png content');
            const fullPath = createFile('icon.png', pngData);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('image');
            expect(body.mimeType).toBe('image/png');
            expect(body.fileName).toBe('icon.png');
            expect(body.content).toBe(pngData.toString('base64'));
        });

        it('returns type=image for .jpg files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('photo.jpg', Buffer.from('fake jpg'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('image');
            expect(body.mimeType).toBe('image/jpeg');
        });

        it('returns type=image for .gif files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('anim.gif', Buffer.from('fake gif'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('image');
            expect(body.mimeType).toBe('image/gif');
        });

        it('returns type=image for .webp files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('pic.webp', Buffer.from('fake webp'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('image');
            expect(body.mimeType).toBe('image/webp');
        });
    });

    // ========================================================================
    // Image Too Large
    // ========================================================================

    describe('oversized images', () => {
        it('returns type=image-too-large for images exceeding 2MB', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            // Create a file slightly over 2MB
            const largeContent = Buffer.alloc(2 * 1024 * 1024 + 1, 0x42);
            const fullPath = createFile('huge.png', largeContent);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('image-too-large');
            expect(body.fileName).toBe('huge.png');
            expect(body.size).toBe(largeContent.length);
        });
    });

    // ========================================================================
    // Non-image binary files still rejected
    // ========================================================================

    describe('non-image binary files', () => {
        it('still rejects non-image binary extensions', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const binaryExts = ['.pdf', '.zip', '.exe', '.dll', '.woff2', '.mp4'];
            for (const ext of binaryExts) {
                const fullPath = createFile(`test${ext}`, 'data');
                const res = await request(
                    `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
                );
                expect(res.status).toBe(400);
                const body = JSON.parse(res.body);
                expect(body.error).toContain('Binary files');
            }
        });
    });

    // ========================================================================
    // Text files unchanged
    // ========================================================================

    describe('text files still work normally', () => {
        it('returns type=file for .ts files', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const fullPath = createFile('app.ts', 'const x = 1;\nconst y = 2;');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(fullPath)}`
            );
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('file');
            expect(body.lines).toEqual(['const x = 1;', 'const y = 2;']);
        });
    });

    // ========================================================================
    // Security
    // ========================================================================

    describe('security', () => {
        it('rejects image files outside workspace', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Use home dir (not ~/.copilot, not os.tmpdir) — genuinely outside all trusted roots.
            const outsideDir = fs.mkdtempSync(path.join(os.homedir(), '_test_img_outside_'));
            const outsidePath = path.join(outsideDir, 'secret.svg');
            fs.writeFileSync(outsidePath, '<svg></svg>');

            try {
                const wsId = await registerWorkspace(srv, workspaceDir);
                const res = await request(
                    `${srv.url}/api/workspaces/${wsId}/files/preview?path=${encodeURIComponent(outsidePath)}`
                );
                expect(res.status).toBe(403);
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });
    });
});
