/**
 * Notes Image Handler Tests
 *
 * Covers: upload, serve, path traversal protection, file type validation,
 * size limits, and markdown round-trip with images.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; rawBody: Buffer }> {
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
                    const rawBody = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: rawBody.toString('utf-8'),
                        rawBody,
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

// Minimal valid 1x1 PNG (base64)
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

// Minimal valid 1x1 JPEG (base64)
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsM' +
    'DhEQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQU' +
    'FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAA' +
    'AAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2Jy' +
    'ggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKj' +
    'pKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAA' +
    'AAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR' +
    'ChYkNOEl8RcYI4Q/RFhHRUYnJCk6NTY3ODk6REVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWW' +
    'l5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A' +
    '9+ooooA//9k=';
const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`;

// Minimal valid PDF document.
const TINY_PDF_BYTES = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'utf-8',
);
const TINY_PDF_DATA_URL = `data:application/pdf;base64,${TINY_PDF_BYTES.toString('base64')}`;

// ============================================================================
// Tests
// ============================================================================

describe('Notes Image Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-image-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-image-ws-'));
        wsId = 'test-ws-' + Date.now();
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
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    // ========================================================================
    // POST /api/workspaces/:id/notes/image — Upload
    // ========================================================================

    describe('POST /api/workspaces/:id/notes/image — Upload', () => {
        it('should upload a PNG image and return relative path', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'screenshot.png',
                data: TINY_PNG_DATA_URL,
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/^\.attachments\/[0-9a-f-]+\.png$/);

            // Verify file exists on disk
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            const fullPath = path.join(notesDir, body.path);
            expect(fs.existsSync(fullPath)).toBe(true);
        });

        it('should upload a JPEG image', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'photo.jpg',
                data: TINY_JPEG_DATA_URL,
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/^\.attachments\/[0-9a-f-]+\.jpg$/);
        });

        it('should reject missing fileName', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                data: TINY_PNG_DATA_URL,
            });

            expect(res.status).toBe(400);
            expect(res.body).toContain('fileName');
        });

        it('should reject missing data', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'test.png',
            });

            expect(res.status).toBe(400);
            expect(res.body).toContain('data');
        });

        it('should reject invalid data URL format', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'test.png',
                data: 'not-a-valid-data-url',
            });

            expect(res.status).toBe(400);
            expect(res.body).toContain('Invalid data URL');
        });

        it('should reject disallowed file types', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'malicious.exe',
                data: 'data:image/bmp;base64,' + TINY_PNG_BASE64,
            });

            expect(res.status).toBe(400);
            expect(res.body).toContain('not allowed');
        });

        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/workspaces/nonexistent/notes/image`, {
                fileName: 'test.png',
                data: TINY_PNG_DATA_URL,
            });

            expect(res.status).toBe(404);
        });

        it('should generate unique filenames for duplicate uploads', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res1 = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'same.png',
                data: TINY_PNG_DATA_URL,
            });
            const res2 = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'same.png',
                data: TINY_PNG_DATA_URL,
            });

            expect(res1.status).toBe(201);
            expect(res2.status).toBe(201);
            const path1 = JSON.parse(res1.body).path;
            const path2 = JSON.parse(res2.body).path;
            expect(path1).not.toBe(path2);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/notes/image — Serve
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/image — Serve', () => {
        it('should serve an uploaded image', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Upload
            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'test.png',
                data: TINY_PNG_DATA_URL,
            });
            const { path: imgPath } = JSON.parse(uploadRes.body);

            // Serve
            const serveRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(imgPath)}`
            );

            expect(serveRes.status).toBe(200);
            expect(serveRes.headers['content-type']).toBe('image/png');
            expect(serveRes.rawBody.length).toBeGreaterThan(0);
        });

        it('should return 404 for non-existent image', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent('.attachments/nonexistent.png')}`
            );

            expect(res.status).toBe(404);
        });

        it('should return 400 for missing path query param', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/image`);

            expect(res.status).toBe(400);
            expect(res.body).toContain('path');
        });

        it('should reject path traversal attempts', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent('../../etc/passwd')}`
            );

            expect(res.status).toBe(403);
        });

        it('should reject paths outside .attachments directory', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Create a note file to try to access via image endpoint
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            fs.mkdirSync(notesDir, { recursive: true });
            fs.writeFileSync(path.join(notesDir, 'secret.md'), 'secret content');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent('secret.md')}`
            );

            expect(res.status).toBe(403);
        });

        it('should set Cache-Control header', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'cached.png',
                data: TINY_PNG_DATA_URL,
            });
            const { path: imgPath } = JSON.parse(uploadRes.body);

            const serveRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(imgPath)}`
            );

            expect(serveRes.status).toBe(200);
            expect(serveRes.headers['cache-control']).toContain('max-age=');
        });

        it('should serve JPEG with correct content type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'photo.jpg',
                data: TINY_JPEG_DATA_URL,
            });
            const { path: imgPath } = JSON.parse(uploadRes.body);

            const serveRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(imgPath)}`
            );

            expect(serveRes.status).toBe(200);
            expect(serveRes.headers['content-type']).toBe('image/jpeg');
        });
    });

    // ========================================================================
    // PDF attachments (upload, serve, size cap)
    // ========================================================================

    describe('PDF attachments', () => {
        it('should upload a PDF and return a .pdf relative path', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'report.pdf',
                data: TINY_PDF_DATA_URL,
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/^\.attachments\/[0-9a-f-]+\.pdf$/);

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            expect(fs.existsSync(path.join(notesDir, body.path))).toBe(true);
        });

        it('should reject an invalid PDF data URL', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'report.pdf',
                data: 'data:application/pdf;notbase64',
            });

            expect(res.status).toBe(400);
            expect(res.body).toContain('Invalid data URL');
        });

        it('should serve an uploaded PDF with application/pdf content type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'report.pdf',
                data: TINY_PDF_DATA_URL,
            });
            const { path: pdfPath } = JSON.parse(uploadRes.body);

            const serveRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(pdfPath)}`
            );

            expect(serveRes.status).toBe(200);
            expect(serveRes.headers['content-type']).toBe('application/pdf');
            expect(serveRes.rawBody).toEqual(TINY_PDF_BYTES);
        });

        it('should accept a PDF larger than the image size cap (dedicated PDF cap)', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // 11 MB > MAX_IMAGE_SIZE_BYTES (10 MB) but < MAX_PDF_SIZE_BYTES (50 MB).
            // A PDF-typed upload of this size must be accepted, proving the handler
            // applies the higher PDF cap rather than the image cap.
            const bigPdf = Buffer.concat([TINY_PDF_BYTES, Buffer.alloc(11 * 1024 * 1024)]);
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'large.pdf',
                data: `data:application/pdf;base64,${bigPdf.toString('base64')}`,
            });

            expect(res.status).toBe(201);
            expect(JSON.parse(res.body).path).toMatch(/\.pdf$/);
        });
    });

    // ========================================================================
    // Upload → Serve round-trip
    // ========================================================================

    describe('Upload → Serve round-trip', () => {
        it('should preserve image data through upload and serve', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'roundtrip.png',
                data: TINY_PNG_DATA_URL,
            });
            expect(uploadRes.status).toBe(201);
            const { path: imgPath } = JSON.parse(uploadRes.body);

            const serveRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(imgPath)}`
            );
            expect(serveRes.status).toBe(200);

            // Verify the served binary matches the original
            const originalBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');
            expect(serveRes.rawBody).toEqual(originalBuffer);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/notes/local-image — Serve local images
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/local-image — Serve', () => {
        it('should serve an image file within the workspace root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Create a test image inside the workspace
            const imgPath = path.join(workspaceDir, 'chart.png');
            const imgBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');
            fs.writeFileSync(imgPath, imgBuffer);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(imgPath)}`
            );

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
            expect(res.rawBody).toEqual(imgBuffer);
        });

        it('should serve images in subdirectories of workspace root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const subDir = path.join(workspaceDir, 'docs', 'images');
            fs.mkdirSync(subDir, { recursive: true });
            const imgPath = path.join(subDir, 'diagram.png');
            fs.writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(imgPath)}`
            );

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
        });

        it('should reject paths outside workspace root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Create a file outside the workspace
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
            const outsidePath = path.join(outsideDir, 'secret.png');
            fs.writeFileSync(outsidePath, Buffer.from(TINY_PNG_BASE64, 'base64'));

            try {
                const res = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(outsidePath)}`
                );
                expect(res.status).toBe(403);
                expect(res.body).toContain('outside workspace root');
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });

        it('should reject path traversal attempts', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const traversalPath = path.join(workspaceDir, '..', '..', 'etc', 'passwd');
            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(traversalPath)}`
            );
            expect(res.status).toBe(403);
        });

        it('should reject disallowed file extensions', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const txtPath = path.join(workspaceDir, 'notes.txt');
            fs.writeFileSync(txtPath, 'hello');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(txtPath)}`
            );
            expect(res.status).toBe(403);
            expect(res.body).toContain('not allowed');
        });

        it('should return 400 for missing path query param', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/local-image`);
            expect(res.status).toBe(400);
            expect(res.body).toContain('path');
        });

        it('should return 404 for non-existent file', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const missingPath = path.join(workspaceDir, 'no-such-file.png');
            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(missingPath)}`
            );
            expect(res.status).toBe(404);
        });

        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();

            const res = await request(
                `${srv.url}/api/workspaces/nonexistent/notes/local-image?path=${encodeURIComponent('/some/path.png')}`
            );
            expect(res.status).toBe(404);
        });

        it('should serve JPEG with correct content type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const imgPath = path.join(workspaceDir, 'photo.jpg');
            fs.writeFileSync(imgPath, Buffer.from(TINY_JPEG_BASE64, 'base64'));

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(imgPath)}`
            );

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/jpeg');
        });
    });

    // ========================================================================
    // .attachments isolation from tree
    // ========================================================================

    describe('.attachments isolation', () => {
        it('should not appear in notes tree', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Upload an image to create .attachments dir
            await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'test.png',
                data: TINY_PNG_DATA_URL,
            });

            // Also create a normal note
            await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'my-note.md',
                type: 'page',
            });

            // Get tree — .attachments should not be present
            const treeRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            expect(treeRes.status).toBe(200);
            const tree = JSON.parse(treeRes.body).tree;

            // Only the note should appear, not .attachments
            const names = tree.map((n: { name: string }) => n.name);
            expect(names).toContain('my-note.md');
            expect(names).not.toContain('.attachments');
        });
    });
});
