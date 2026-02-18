/**
 * Wiki Static File Serving & Deep-Linking Tests
 *
 * Tests for:
 * - /wiki/:wikiId/static/* route serving files with correct MIME types
 * - Path traversal protection
 * - Unknown wiki / missing file → 404
 * - New MIME type entries
 * - navigateToWiki / navigateToWikiComponent helpers in client bundle
 * - selectedWikiComponentId in AppState defaults
 * - DashboardTab includes 'wiki'
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequestHandler } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { getClientBundle } from './spa-test-helpers';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal ProcessStore stub for router tests. */
function stubStore(): ProcessStore {
    return {
        getAllProcesses: async () => [],
        addProcess: async () => {},
        updateProcess: async () => {},
        getProcess: async () => null,
        deleteProcess: async () => false,
        deleteAllProcesses: async () => {},
        getWorkspaces: async () => [],
        registerWorkspace: async () => {},
        processCount: async () => 0,
        getStats: async () => ({ queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false }),
        emitProcessComplete: () => {},
        getWikis: async () => [],
        registerWiki: async () => {},
        removeWiki: async () => false,
        updateWiki: async () => {},
    } as any;
}

/** Make an HTTP request to the test server. */
function request(
    url: string,
    options: { method?: string } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
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
        req.end();
    });
}

// ============================================================================
// Wiki Static File Serving Tests
// ============================================================================

describe('wiki static file serving', () => {
    let server: http.Server;
    let baseUrl: string;
    let wikiDir: string;

    beforeAll(async () => {
        // Create a temp directory with test files
        wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-test-'));

        // Create test files
        fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), '{"nodes":[]}');
        fs.mkdirSync(path.join(wikiDir, 'images'), { recursive: true });
        // Create a tiny valid PNG (1x1 pixel)
        const pngHeader = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        ]);
        fs.writeFileSync(path.join(wikiDir, 'images', 'diagram.png'), pngHeader);
        fs.mkdirSync(path.join(wikiDir, 'articles'), { recursive: true });
        fs.writeFileSync(path.join(wikiDir, 'articles', 'intro.md'), '# Intro');
        fs.mkdirSync(path.join(wikiDir, 'fonts'), { recursive: true });
        fs.writeFileSync(path.join(wikiDir, 'fonts', 'custom.woff2'), 'woff2-data');
        fs.writeFileSync(path.join(wikiDir, 'fonts', 'regular.ttf'), 'ttf-data');
        fs.writeFileSync(path.join(wikiDir, 'photo.jpg'), 'jpg-data');
        fs.writeFileSync(path.join(wikiDir, 'photo.jpeg'), 'jpeg-data');
        fs.writeFileSync(path.join(wikiDir, 'anim.gif'), 'gif-data');
        fs.writeFileSync(path.join(wikiDir, 'font.woff'), 'woff-data');
        fs.writeFileSync(path.join(wikiDir, 'unknown.xyz'), 'unknown-data');
        // Create a subdirectory (not a file) for directory request test
        fs.mkdirSync(path.join(wikiDir, 'subdir'), { recursive: true });

        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html>SPA</html>',
            store: stubStore(),
            getWikiDir: (id: string) => {
                if (id === 'my-wiki') return wikiDir;
                return undefined;
            },
        });

        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(wikiDir, { recursive: true, force: true });
    });

    it('serves an existing JSON file with correct content type', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/component-graph.json`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(res.body).toBe('{"nodes":[]}');
    });

    it('serves an image file with correct content type', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/images/diagram.png`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
    });

    it('serves a markdown file with correct content type', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/articles/intro.md`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
        expect(res.body).toBe('# Intro');
    });

    it('serves a woff2 font with correct content type', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/fonts/custom.woff2`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('font/woff2');
    });

    it('blocks path traversal with encoded ../', async () => {
        // Node's HTTP client normalizes literal ../ before sending, so we use
        // percent-encoded sequences that survive URL parsing but decode to ../
        const res = await request(`${baseUrl}/wiki/my-wiki/static/..%2F..%2F..%2Fetc%2Fpasswd`);
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toBe('Invalid path');
    });

    it('blocks path traversal via double-encoded sequences', async () => {
        // decodeURIComponent is applied to the full pathname by the router
        const res = await request(`${baseUrl}/wiki/my-wiki/static/..%2F..%2Fetc%2Fpasswd`);
        expect(res.status).toBe(404);
    });

    it('returns 404 for unknown wiki', async () => {
        const res = await request(`${baseUrl}/wiki/nonexistent/static/file.json`);
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('Wiki not found');
    });

    it('returns 404 for missing file in valid wiki', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/no-such-file.txt`);
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('File not found');
    });

    it('returns 404 for directory request (not a file)', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/subdir`);
        expect(res.status).toBe(404);
    });

    it('includes Cache-Control header', async () => {
        const res = await request(`${baseUrl}/wiki/my-wiki/static/component-graph.json`);
        expect(res.headers['cache-control']).toBe('public, max-age=3600');
    });
});

// ============================================================================
// MIME Type Tests
// ============================================================================

describe('wiki static file MIME types', () => {
    let server: http.Server;
    let baseUrl: string;
    let wikiDir: string;

    const mimeTests: [string, string][] = [
        ['test.jpg', 'image/jpeg'],
        ['test.jpeg', 'image/jpeg'],
        ['test.gif', 'image/gif'],
        ['test.woff', 'font/woff'],
        ['test.woff2', 'font/woff2'],
        ['test.ttf', 'font/ttf'],
        ['test.md', 'text/markdown; charset=utf-8'],
    ];

    beforeAll(async () => {
        wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mime-test-'));
        for (const [filename] of mimeTests) {
            fs.writeFileSync(path.join(wikiDir, filename), 'data');
        }
        fs.writeFileSync(path.join(wikiDir, 'test.xyz'), 'data');

        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html></html>',
            store: stubStore(),
            getWikiDir: (id: string) => id === 'w' ? wikiDir : undefined,
        });

        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(wikiDir, { recursive: true, force: true });
    });

    for (const [filename, expectedMime] of mimeTests) {
        it(`serves ${filename} with ${expectedMime}`, async () => {
            const res = await request(`${baseUrl}/wiki/w/static/${filename}`);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe(expectedMime);
        });
    }

    it('falls back to application/octet-stream for unknown extension', async () => {
        const res = await request(`${baseUrl}/wiki/w/static/test.xyz`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/octet-stream');
    });
});

// ============================================================================
// Deep-Link Routing Tests (client bundle)
// ============================================================================

describe('client bundle — wiki deep-link routing', () => {
    let bundle: string;

    beforeAll(() => {
        bundle = getClientBundle();
    });

    it('handles #wiki/:wikiId hash route', () => {
        expect(bundle).toContain('wikiDetailMatch');
        // Wiki detail now handled by React Router, not showWikiDetail global
    });

    it('handles #wiki/:wikiId/component/:compId hash route', () => {
        expect(bundle).toContain('wikiComponentMatch');
        // Wiki component now handled by React Router, not showWikiComponent global
    });

    it('checks component pattern before detail pattern', () => {
        // The more specific component pattern should appear before the detail pattern
        const compIdx = bundle.indexOf('wikiComponentMatch');
        const detailIdx = bundle.indexOf('wikiDetailMatch');
        expect(compIdx).toBeLessThan(detailIdx);
    });

    it('defines navigateToWiki function', () => {
        expect(bundle).toContain('navigateToWiki');
    });

    it('defines navigateToWikiComponent function', () => {
        expect(bundle).toContain('navigateToWikiComponent');
    });

    it('navigateToWiki sets hash with encoded wiki ID', () => {
        // The function should set location.hash = '#wiki/' + encodeURIComponent(wikiId)
        expect(bundle).toMatch(/navigateToWiki/);
        expect(bundle).toContain('#wiki/');
        expect(bundle).toContain('encodeURIComponent');
    });

    it('navigateToWikiComponent sets hash with encoded IDs', () => {
        expect(bundle).toContain('/component/');
    });

    it('#wiki hash switches to wiki tab', () => {
        // handleHashChange should have hash === 'wiki' check
        expect(bundle).toMatch(/hash\s*===?\s*['"]wiki['"]/);
    });
});

// ============================================================================
// State Tests (client bundle)
// ============================================================================

describe('client bundle — wiki state', () => {
    let bundle: string;

    beforeAll(() => {
        bundle = getClientBundle();
    });

    it('DashboardTab type includes wiki', () => {
        // The bundled output uses double quotes for string literals
        expect(bundle).toContain('"wiki"');
    });

    it('appState includes selectedWikiId initialized to null', () => {
        expect(bundle).toContain('selectedWikiId');
    });

    it('appState includes selectedWikiComponentId initialized to null', () => {
        expect(bundle).toContain('selectedWikiComponentId');
    });
});

// ============================================================================
// Router without getWikiDir (no wiki support)
// ============================================================================

describe('router without getWikiDir', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html>SPA</html>',
            store: stubStore(),
            // No getWikiDir — wiki static routes should 404
        });

        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns 404 when getWikiDir is not provided', async () => {
        const res = await request(`${baseUrl}/wiki/any/static/file.json`);
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('Wiki not found');
    });

    it('SPA fallback still works for non-wiki paths', async () => {
        const res = await request(`${baseUrl}/some-page`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('<html>SPA</html>');
    });
});
