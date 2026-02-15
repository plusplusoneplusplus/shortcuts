/**
 * Review Integration Tests
 *
 * Tests for the review editor SPA integration:
 * - Navigation links in HTML
 * - Review page containers in HTML
 * - __REVIEW_CONFIG__ injection
 * - Router handling of /review paths
 * - Content save endpoint
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequestHandler, sendJson } from '../../src/server/router';
import { registerReviewRoutes, safePath } from '../../src/server/review-handler';
import { generateDashboardHtml } from '../../src/server/spa';
import type { Route } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

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
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ============================================================================
// HTML Template Tests
// ============================================================================

describe('Review SPA — HTML Template', () => {
    it('dashboard nav shows Review link', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('href="/review"');
        expect(html).toContain('class="nav-link"');
        expect(html).toContain('>Review<');
    });

    it('dashboard nav shows Dashboard link', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('href="/"');
        expect(html).toContain('>Dashboard<');
    });

    it('contains review-browser page container', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="page-review-browser"');
        expect(html).toContain('id="review-browser-content"');
        expect(html).toContain('id="review-search"');
    });

    it('contains review-editor page container', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('id="page-review-editor"');
        expect(html).toContain('id="review-content"');
        expect(html).toContain('id="review-comments-panel"');
        expect(html).toContain('id="review-file-name"');
        expect(html).toContain('id="review-resolve-all"');
    });

    it('does NOT inject __REVIEW_CONFIG__ script block without reviewFilePath', () => {
        const html = generateDashboardHtml();
        // The string appears in the bundled JS, but the script injection block should NOT exist
        expect(html).not.toContain("window.__REVIEW_CONFIG__ = {");
    });

    it('always injects __DASHBOARD_CONFIG__', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('__DASHBOARD_CONFIG__');
    });

    it('injects __REVIEW_CONFIG__ when reviewFilePath is set', () => {
        const html = generateDashboardHtml({ reviewFilePath: 'README.md', projectDir: '/test' });
        expect(html).toContain("window.__REVIEW_CONFIG__ = {");
        expect(html).toContain("filePath: 'README.md'");
        expect(html).toContain("projectDir: '/test'");
    });

    it('still injects __DASHBOARD_CONFIG__ when reviewFilePath is set', () => {
        const html = generateDashboardHtml({ reviewFilePath: 'README.md' });
        expect(html).toContain('__DASHBOARD_CONFIG__');
        expect(html).toContain("window.__REVIEW_CONFIG__ = {");
    });

    it('escapes special characters in reviewFilePath', () => {
        const html = generateDashboardHtml({ reviewFilePath: 'path/<script>.md' });
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain("filePath: 'path/<script>.md'");
    });

    it('review pages are initially hidden', () => {
        const html = generateDashboardHtml();
        expect(html).toMatch(/class="page-container hidden"[^>]*id="page-review-browser"/);
        expect(html).toMatch(/class="page-container hidden"[^>]*id="page-review-editor"/);
    });
});

// ============================================================================
// Router Tests
// ============================================================================

describe('Review SPA — Router', () => {
    let tmpDir: string;
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-router-'));
        fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello');
        fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide');

        const spaHtml = generateDashboardHtml();
        const routes: Route[] = [];
        registerReviewRoutes(routes, tmpDir);

        const handler = createRequestHandler({
            routes,
            spaHtml,
            store: stubStore(),
            generateReviewHtml: (filePath: string) => {
                return generateDashboardHtml({
                    reviewFilePath: filePath,
                    projectDir: tmpDir,
                });
            },
        });

        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('GET / returns SPA HTML without __REVIEW_CONFIG__ injection', async () => {
        const res = await request(baseUrl, '/');
        expect(res.status).toBe(200);
        expect(res.body).toContain('__DASHBOARD_CONFIG__');
        expect(res.body).not.toContain("window.__REVIEW_CONFIG__ = {");
    });

    it('GET /review returns SPA HTML (file browser)', async () => {
        const res = await request(baseUrl, '/review');
        expect(res.status).toBe(200);
        expect(res.body).toContain('id="page-review-browser"');
        expect(res.body).not.toContain("window.__REVIEW_CONFIG__ = {");
    });

    it('GET /review/README.md returns SPA with __REVIEW_CONFIG__', async () => {
        const res = await request(baseUrl, '/review/README.md');
        expect(res.status).toBe(200);
        expect(res.body).toContain("window.__REVIEW_CONFIG__ = {");
        expect(res.body).toContain("filePath: 'README.md'");
    });

    it('GET /review/path/to/deep/file.md handles nested paths', async () => {
        const nestedPath = encodeURIComponent('docs/guide.md');
        const res = await request(baseUrl, `/review/${nestedPath}`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('__REVIEW_CONFIG__');
        expect(res.body).toContain('docs/guide.md');
    });

    it('POST /api/review/files/:path/content saves file', async () => {
        const newContent = '# Updated Content\n\nHello world!';
        const res = await request(baseUrl, `/api/review/files/${encodeURIComponent('README.md')}/content`, {
            method: 'POST',
            body: JSON.stringify({ content: newContent }),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(200);
        const saved = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf-8');
        expect(saved).toBe(newContent);
    });

    it('POST /api/review/files/:path/content rejects missing content', async () => {
        const res = await request(baseUrl, `/api/review/files/${encodeURIComponent('README.md')}/content`, {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('POST /api/review/files/:path/content rejects path traversal', async () => {
        const res = await request(baseUrl, `/api/review/files/${encodeURIComponent('../../../etc/passwd')}/content`, {
            method: 'POST',
            body: JSON.stringify({ content: 'hack' }),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });
});
