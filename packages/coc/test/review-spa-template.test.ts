/**
 * Tests for the Review Editor SPA template and image handler.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { generateReviewEditorHtml, createImageRoute } from '../src/server/review-editor';
import type { ReviewEditorOptions } from '../src/server/review-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function defaultOptions(overrides?: Partial<ReviewEditorOptions>): ReviewEditorOptions {
    return {
        filePath: '/workspace/docs/readme.md',
        fileDir: '/workspace/docs',
        workspaceRoot: '/workspace',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// generateReviewEditorHtml
// ---------------------------------------------------------------------------

describe('generateReviewEditorHtml', () => {
    let html: string;

    beforeAll(() => {
        html = generateReviewEditorHtml(defaultOptions());
    });

    it('generates valid HTML', () => {
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html');
        expect(html).toContain('</html>');
    });

    it('inlines all 6 CSS files', () => {
        // Distinctive selectors from each CSS file
        expect(html).toContain('.editor-container');          // webview.css
        expect(html).toContain('.md-h1');                     // markdown.css
        expect(html).toContain('.floating-comment-panel');    // comments.css
        expect(html).toContain('.modal-overlay');             // components.css
        expect(html).toContain('.search-bar');                // search.css
        expect(html).toContain('.context-menu');              // shared-context-menu.css
    });

    it('inlines webview JS', () => {
        // The bundled webview.js contains the webpack IIFE output
        // Look for a string that should be in the compiled JS
        const webviewJs = fs.readFileSync(path.join(REPO_ROOT, 'dist', 'webview.js'), 'utf-8');
        // The JS should be present somewhere in the HTML
        expect(html.length).toBeGreaterThan(webviewJs.length);
        // Check for a known substring from the bundle
        expect(html).toContain('<script>');
    });

    it('includes review config with serveMode true', () => {
        expect(html).toContain('window.__REVIEW_CONFIG__');
        expect(html).toContain('"serveMode":true');
    });

    it('includes config values from options', () => {
        expect(html).toContain('"/workspace/docs/readme.md"');
        expect(html).toContain('"/workspace/docs"');
        expect(html).toContain('"/workspace"');
    });

    it('includes navigation header', () => {
        expect(html).toContain('review-nav-header');
        expect(html).toContain('← Dashboard');
    });

    it('uses custom dashboard URL', () => {
        const customHtml = generateReviewEditorHtml(defaultOptions({
            dashboardUrl: '/my-dashboard',
        }));
        expect(customHtml).toContain('href="/my-dashboard"');
    });

    it('defaults dashboard URL to /', () => {
        expect(html).toContain('href="/"');
    });

    it('shows basename in title and header', () => {
        expect(html).toContain('<title>Review: readme.md</title>');
        expect(html).toContain('class="review-filename">readme.md</span>');
    });

    it('CSP allows self and CDN', () => {
        expect(html).toContain('Content-Security-Policy');
        expect(html).toContain("script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com");
        expect(html).toContain("connect-src 'self' ws: wss:");
    });

    it('includes highlight.js CDN script', () => {
        expect(html).toContain('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js');
    });

    it('includes code-block theme CSS', () => {
        // Default theme is dark
        expect(html).toContain('.hljs-keyword');
        expect(html).toContain('#7dcfff'); // dark theme keyword color
    });

    it('supports light code-block theme', () => {
        const lightHtml = generateReviewEditorHtml(defaultOptions({
            codeBlockTheme: 'light',
        }));
        expect(lightHtml).toContain('#0000ff'); // light theme keyword color
    });

    it('includes editor body structure', () => {
        expect(html).toContain('id="editorContainer"');
        expect(html).toContain('id="editorWrapper"');
        expect(html).toContain('id="floatingCommentPanel"');
        expect(html).toContain('id="inlineEditPanel"');
        expect(html).toContain('id="contextMenu"');
        expect(html).toContain('id="followPromptDialog"');
        expect(html).toContain('id="updateDocumentDialog"');
        expect(html).toContain('id="refreshPlanDialog"');
    });

    it('escapes HTML in file basename', () => {
        const xssHtml = generateReviewEditorHtml(defaultOptions({
            filePath: '/workspace/docs/<img onerror=alert(1)>.md',
        }));
        // Title and nav header must be escaped
        expect(xssHtml).toContain('<title>Review: &lt;img onerror=alert(1)&gt;.md</title>');
        expect(xssHtml).toContain('class="review-filename">&lt;img onerror=alert(1)&gt;.md</span>');
    });

    it('includes navigation header CSS', () => {
        expect(html).toContain('.review-nav-header');
        expect(html).toContain('.review-nav-header a');
        expect(html).toContain('.review-filename');
    });

    it('includes API and WS paths in config', () => {
        const customHtml = generateReviewEditorHtml(defaultOptions({
            apiBasePath: '/custom-api',
            wsPath: '/custom-ws',
        }));
        expect(customHtml).toContain('"/custom-api"');
        expect(customHtml).toContain('"/custom-ws"');
    });
});

// ---------------------------------------------------------------------------
// createImageRoute
// ---------------------------------------------------------------------------

describe('createImageRoute', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-img-test-'));
        // Create a test PNG file (minimal 1x1 PNG)
        const pngHeader = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
            0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, // width=1
            0x00, 0x00, 0x00, 0x01, // height=1
            0x08, 0x02, 0x00, 0x00, 0x00, // 8-bit RGB
            0x90, 0x77, 0x53, 0xde, // CRC
        ]);
        fs.writeFileSync(path.join(tmpDir, 'test.png'), pngHeader);
        // Create a subdirectory with an image
        fs.mkdirSync(path.join(tmpDir, 'sub'));
        fs.writeFileSync(path.join(tmpDir, 'sub', 'nested.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns a valid Route object', () => {
        const route = createImageRoute(tmpDir);
        expect(route.method).toBe('GET');
        expect(route.pattern).toBeInstanceOf(RegExp);
        expect(typeof route.handler).toBe('function');
    });

    it('pattern matches /review/images/foo/bar.png', () => {
        const route = createImageRoute(tmpDir);
        const match = '/review/images/foo/bar.png'.match(route.pattern as RegExp);
        expect(match).not.toBeNull();
        expect(match![1]).toBe('foo/bar.png');
    });

    it('pattern matches /review/images/simple.png', () => {
        const route = createImageRoute(tmpDir);
        const match = '/review/images/simple.png'.match(route.pattern as RegExp);
        expect(match).not.toBeNull();
        expect(match![1]).toBe('simple.png');
    });

    it('pattern does not match /review/images/', () => {
        const route = createImageRoute(tmpDir);
        const match = '/review/images/'.match(route.pattern as RegExp);
        // The regex requires at least one char after /review/images/
        // /review/images/ ends with / and (.+) requires at least 1 char
        expect(match).toBeNull();
    });

    // Use a real HTTP server to test the handler end-to-end
    describe('handler integration', () => {
        let server: http.Server;
        let baseUrl: string;
        let route: ReturnType<typeof createImageRoute>;

        beforeAll(async () => {
            route = createImageRoute(tmpDir);
            server = http.createServer((req, res) => {
                const match = req.url!.match(route.pattern as RegExp);
                if (match) {
                    route.handler(req, res, match);
                } else {
                    res.writeHead(404);
                    res.end('No route');
                }
            });
            await new Promise<void>((resolve) => {
                server.listen(0, '127.0.0.1', () => resolve());
            });
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
        });

        afterAll(async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        });

        async function fetch(urlPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
            return new Promise((resolve, reject) => {
                http.get(`${baseUrl}${urlPath}`, (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c: Buffer) => chunks.push(c));
                    res.on('end', () => resolve({
                        status: res.statusCode!,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                    }));
                    res.on('error', reject);
                }).on('error', reject);
            });
        }

        it('serves existing PNG with correct MIME', async () => {
            const res = await fetch('/review/images/test.png');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
            expect(res.headers['cache-control']).toBe('public, max-age=3600');
            expect(res.body.length).toBeGreaterThan(0);
        });

        it('serves nested image', async () => {
            const res = await fetch('/review/images/sub/nested.jpg');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/jpeg');
        });

        it('returns 404 for missing file', async () => {
            const res = await fetch('/review/images/nonexistent.png');
            expect(res.status).toBe(404);
        });

        it('rejects directory traversal with 403', async () => {
            // HTTP clients normalize literal ../, so use encoded form
            const res = await fetch('/review/images/..%2F..%2F..%2Fetc%2Fpasswd');
            expect(res.status).toBe(403);
        });

        it('rejects encoded traversal with 403', async () => {
            const res = await fetch('/review/images/sub%2F..%2F..%2Fetc%2Fpasswd');
            expect(res.status).toBe(403);
        });

        it('returns application/octet-stream for unknown extension', async () => {
            // Create a file with unknown extension
            fs.writeFileSync(path.join(tmpDir, 'data.xyz'), 'test');
            const res = await fetch('/review/images/data.xyz');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('application/octet-stream');
            fs.unlinkSync(path.join(tmpDir, 'data.xyz'));
        });

        it('returns 404 for directory path', async () => {
            const res = await fetch('/review/images/sub');
            expect(res.status).toBe(404);
        });
    });
});

// ---------------------------------------------------------------------------
// Barrel export
// ---------------------------------------------------------------------------

describe('review-editor barrel export', () => {
    it('exports generateReviewEditorHtml', () => {
        expect(typeof generateReviewEditorHtml).toBe('function');
    });

    it('exports createImageRoute', () => {
        expect(typeof createImageRoute).toBe('function');
    });
});
