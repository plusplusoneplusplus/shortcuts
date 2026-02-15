/**
 * Review Handler Tests
 *
 * Comprehensive tests for the review editor REST API routes:
 * file listing, file content + comments, CRUD on comments,
 * bulk resolve/delete, image serving, and path traversal guards.
 *
 * Uses a temp directory with sample .md files and pre-seeded comments.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequestHandler, sendJson } from '../../src/server/router';
import { registerReviewRoutes, safePath, walkMarkdownFiles } from '../../src/server/review-handler';
import type { Route } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal stub store for the router (review routes don't need it). */
function stubStore(): any {
    return { getAllProcesses: async () => [] };
}

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
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
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function postJSON(base: string, urlPath: string, data: unknown) {
    return request(base, urlPath, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(base: string, urlPath: string, data: unknown) {
    return request(base, urlPath, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function del(base: string, urlPath: string) {
    return request(base, urlPath, { method: 'DELETE' });
}

// ============================================================================
// Test Setup
// ============================================================================

let tmpDir: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
    // Create temp project directory with sample files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-handler-test-'));

    // Create markdown files
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello\n\nWorld\n');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide\n\nContent here.\n');

    // Create an image file (1x1 transparent PNG)
    const pngBuf = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
        'Nl7BcQAAAABJRU5ErkJggg==',
        'base64'
    );
    fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'images', 'logo.png'), pngBuf);

    // Create hidden dir and node_modules (should be skipped)
    fs.mkdirSync(path.join(tmpDir, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.hidden', 'secret.md'), '# Secret\n');
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'index.md'), '# pkg\n');

    // Build routes and server
    const routes: Route[] = [];
    registerReviewRoutes(routes, tmpDir);
    const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store: stubStore() });
    server = http.createServer(handler);

    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Clean comments before each test to isolate state
beforeEach(() => {
    const vscodeDir = path.join(tmpDir, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    const configPath = path.join(vscodeDir, 'md-comments.json');
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, comments: [] }));
});

// ============================================================================
// safePath unit tests
// ============================================================================

describe('safePath', () => {
    it('returns resolved path for valid relative path', () => {
        const result = safePath('/project', 'docs/file.md');
        expect(result).toBe(path.resolve('/project', 'docs/file.md'));
    });

    it('returns null for traversal attempt', () => {
        expect(safePath('/project', '../etc/passwd')).toBeNull();
    });

    it('returns null for absolute path outside base', () => {
        expect(safePath('/project', '/etc/passwd')).toBeNull();
    });

    it('returns base itself when path resolves to base', () => {
        expect(safePath('/project', '.')).toBe(path.resolve('/project'));
    });
});

// ============================================================================
// walkMarkdownFiles unit tests
// ============================================================================

describe('walkMarkdownFiles', () => {
    it('finds .md files recursively', () => {
        const files = walkMarkdownFiles(tmpDir);
        expect(files).toContain('README.md');
        expect(files).toContain(path.join('docs', 'guide.md'));
    });

    it('skips node_modules and hidden dirs', () => {
        const files = walkMarkdownFiles(tmpDir);
        const joined = files.join('\n');
        expect(joined).not.toContain('node_modules');
        expect(joined).not.toContain('.hidden');
    });

    it('returns empty array for nonexistent dir', () => {
        expect(walkMarkdownFiles('/nonexistent/path')).toEqual([]);
    });
});

// ============================================================================
// GET /api/review/files
// ============================================================================

describe('GET /api/review/files', () => {
    it('lists markdown files with comment counts', async () => {
        const res = await request(baseUrl, '/api/review/files');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.files).toBeDefined();
        const paths = body.files.map((f: any) => f.path);
        expect(paths).toContain('README.md');
        expect(paths).toContain(path.join('docs', 'guide.md'));
    });

    it('excludes hidden and node_modules files', async () => {
        const res = await request(baseUrl, '/api/review/files');
        const body = JSON.parse(res.body);
        const paths = body.files.map((f: any) => f.path).join('\n');
        expect(paths).not.toContain('node_modules');
        expect(paths).not.toContain('.hidden');
    });

    it('includes commentCount field', async () => {
        const res = await request(baseUrl, '/api/review/files');
        const body = JSON.parse(res.body);
        for (const f of body.files) {
            expect(typeof f.commentCount).toBe('number');
        }
    });
});

// ============================================================================
// GET /api/review/files/:path
// ============================================================================

describe('GET /api/review/files/:path', () => {
    it('returns file content and empty comments', async () => {
        const res = await request(baseUrl, '/api/review/files/README.md');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.path).toBe('README.md');
        expect(body.content).toContain('# Hello');
        expect(body.comments).toEqual([]);
    });

    it('returns 404 for non-existent file', async () => {
        const res = await request(baseUrl, '/api/review/files/missing.md');
        expect(res.status).toBe(404);
    });

    it('returns 400 for path traversal', async () => {
        const res = await request(baseUrl, '/api/review/files/..%2F..%2Fetc%2Fpasswd');
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('Invalid path');
    });

    it('handles nested paths', async () => {
        const res = await request(baseUrl, `/api/review/files/${encodeURIComponent('docs/guide.md')}`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.content).toContain('# Guide');
    });
});

// ============================================================================
// POST /api/review/files/:path/comments — add comment
// ============================================================================

describe('POST /api/review/files/:path/comments', () => {
    it('creates a comment and returns 201', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Needs rewording',
            author: 'alice',
            tags: ['wording'],
            type: 'user',
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.id).toBeDefined();
        expect(body.comment).toBe('Needs rewording');
        expect(body.author).toBe('alice');
        expect(body.status).toBe('open');
    });

    it('returns 400 for missing required fields', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            comment: 'no selection',
        });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
        const res = await request(baseUrl, '/api/review/files/README.md/comments', {
            method: 'POST',
            body: 'not json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('returns 400 for path traversal', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/..%2F..%2Fetc%2Fpasswd/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            selectedText: 'text',
            comment: 'sneaky',
        });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// PATCH /api/review/files/:path/comments/:id — update comment
// ============================================================================

describe('PATCH /api/review/files/:path/comments/:id', () => {
    it('updates comment text and tags', async () => {
        // Create comment first
        const create = await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Original',
        });
        const id = JSON.parse(create.body).id;

        const res = await patchJSON(baseUrl, `/api/review/files/README.md/comments/${id}`, {
            comment: 'Updated text',
            tags: ['done'],
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.comment).toBe('Updated text');
        expect(body.tags).toEqual(['done']);
    });

    it('resolves a comment via status update', async () => {
        const create = await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'To resolve',
        });
        const id = JSON.parse(create.body).id;

        const res = await patchJSON(baseUrl, `/api/review/files/README.md/comments/${id}`, {
            status: 'resolved',
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).status).toBe('resolved');
    });

    it('returns 404 for non-existent comment', async () => {
        const res = await patchJSON(baseUrl, '/api/review/files/README.md/comments/nonexistent', {
            comment: 'nope',
        });
        expect(res.status).toBe(404);
    });

    it('returns 400 for invalid JSON', async () => {
        const res = await request(baseUrl, '/api/review/files/README.md/comments/someid', {
            method: 'PATCH',
            body: 'bad',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// DELETE /api/review/files/:path/comments/:id — delete comment
// ============================================================================

describe('DELETE /api/review/files/:path/comments/:id', () => {
    it('deletes a comment and returns 204', async () => {
        const create = await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Delete me',
        });
        const id = JSON.parse(create.body).id;

        const res = await del(baseUrl, `/api/review/files/README.md/comments/${id}`);
        expect(res.status).toBe(204);
    });

    it('returns 404 for non-existent comment', async () => {
        const res = await del(baseUrl, '/api/review/files/README.md/comments/nonexistent');
        expect(res.status).toBe(404);
    });
});

// ============================================================================
// POST /api/review/files/:path/comments/resolve-all
// ============================================================================

describe('POST /api/review/files/:path/comments/resolve-all', () => {
    it('resolves all open comments for the file', async () => {
        // Create two comments
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Comment 1',
        });
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 },
            selectedText: 'World',
            comment: 'Comment 2',
        });

        const res = await postJSON(baseUrl, '/api/review/files/README.md/comments/resolve-all', {});
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.resolved).toBe(2);

        // Verify via GET
        const getRes = await request(baseUrl, '/api/review/files/README.md');
        const comments = JSON.parse(getRes.body).comments;
        for (const c of comments) {
            expect(c.status).toBe('resolved');
        }
    });

    it('returns 400 for path traversal', async () => {
        const res = await postJSON(baseUrl, '/api/review/files/..%2Fetc%2Fpasswd/comments/resolve-all', {});
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// DELETE /api/review/files/:path/comments — delete all comments for file
// ============================================================================

describe('DELETE /api/review/files/:path/comments', () => {
    it('deletes all comments for the file', async () => {
        // Create comments
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'To delete 1',
        });
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 },
            selectedText: 'World',
            comment: 'To delete 2',
        });

        const res = await del(baseUrl, '/api/review/files/README.md/comments');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.deleted).toBe(2);

        // Verify via GET
        const getRes = await request(baseUrl, '/api/review/files/README.md');
        expect(JSON.parse(getRes.body).comments).toEqual([]);
    });
});

// ============================================================================
// GET /api/review/images/:path — serve images
// ============================================================================

describe('GET /api/review/images/:path', () => {
    it('serves a PNG image with correct content-type', async () => {
        const res = await request(baseUrl, `/api/review/images/${encodeURIComponent('images/logo.png')}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
    });

    it('returns 404 for non-existent image', async () => {
        const res = await request(baseUrl, '/api/review/images/missing.png');
        expect(res.status).toBe(404);
    });

    it('returns 400 for path traversal', async () => {
        const res = await request(baseUrl, '/api/review/images/..%2F..%2Fetc%2Fpasswd');
        expect(res.status).toBe(400);
    });
});

// ============================================================================
// Comment counts reflected in file listing
// ============================================================================

describe('comment count in file listing', () => {
    it('reflects actual comment count after adding comments', async () => {
        // Add a comment to README.md
        await postJSON(baseUrl, '/api/review/files/README.md/comments', {
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 },
            selectedText: '# Hello',
            comment: 'Count test',
        });

        const res = await request(baseUrl, '/api/review/files');
        const body = JSON.parse(res.body);
        const readme = body.files.find((f: any) => f.path === 'README.md');
        expect(readme).toBeDefined();
        expect(readme.commentCount).toBe(1);
    });
});
