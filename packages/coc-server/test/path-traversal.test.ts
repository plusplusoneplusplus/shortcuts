/**
 * Path Traversal Prevention Tests (Section 9)
 *
 * Unit tests for `isWithinDirectory` from @plusplusoneplusplus/forge and
 * integration tests for the wiki static file serving endpoint in router.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { createRequestHandler } from '../src/router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { vi } from 'vitest';

// ============================================================================
// Unit tests: isWithinDirectory
// ============================================================================

describe('isWithinDirectory', () => {
    it('returns true when target is inside base directory', () => {
        const sep = path.sep;
        const base = path.join('/wiki', 'out');
        const target = path.join('/wiki', 'out', 'valid', 'file.html');
        expect(isWithinDirectory(target, base)).toBe(true);
    });

    it('returns false for directory traversal via ..', () => {
        // Resolves to /etc/passwd or similar, outside /wiki/out
        const base = path.join('/wiki', 'out');
        const target = path.resolve(base, '..', '..', '..', 'etc', 'passwd');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns true when target equals base (the directory itself)', () => {
        const base = path.join('/wiki', 'out');
        expect(isWithinDirectory(base, base)).toBe(true);
    });

    it('returns false for paths that share a prefix but are not children', () => {
        // /wiki/outmore/file should NOT be considered inside /wiki/out
        const base = path.join('/wiki', 'out');
        const target = path.join('/wiki', 'outmore', 'file');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns false when target is a sibling directory', () => {
        const base = path.join('/wiki', 'out');
        const target = path.join('/wiki', 'other');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns false when target is parent of base', () => {
        const base = path.join('/wiki', 'out');
        const target = path.join('/wiki');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns true for deep nested path', () => {
        const base = path.join('/wiki', 'out');
        const target = path.join('/wiki', 'out', 'a', 'b', 'c', 'deep.html');
        expect(isWithinDirectory(target, base)).toBe(true);
    });

    // Cross-platform: test with actual path.resolve behavior
    it('resolves relative base before comparing', () => {
        const cwd = process.cwd();
        const base = 'some-relative-dir';
        const resolvedBase = path.resolve(cwd, base);
        const target = path.join(resolvedBase, 'file.txt');
        expect(isWithinDirectory(target, base)).toBe(true);
    });
});

// ============================================================================
// Integration tests: wiki static file serving via HTTP
// ============================================================================

function createMockStore(): ProcessStore {
    return {
        addProcess: vi.fn(async () => {}),
        updateProcess: vi.fn(async () => {}),
        getProcess: vi.fn(async () => undefined),
        getAllProcesses: vi.fn(async () => []),
        removeProcess: vi.fn(async () => {}),
        clearProcesses: vi.fn(async () => 0),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(async () => {}),
        removeWorkspace: vi.fn(async () => false),
        updateWorkspace: vi.fn(async () => undefined),
        getWikis: vi.fn(async () => []),
        registerWiki: vi.fn(async () => {}),
        removeWiki: vi.fn(async () => false),
        updateWiki: vi.fn(async () => undefined),
        clearAllWorkspaces: vi.fn(async () => 0),
        clearAllWikis: vi.fn(async () => 0),
        getStorageStats: vi.fn(async () => ({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 })),
        onProcessOutput: vi.fn(() => () => {}),
        emitProcessOutput: vi.fn(),
        emitProcessComplete: vi.fn(),
        emitProcessEvent: vi.fn(),
    } as unknown as ProcessStore;
}

describe('Wiki static file path traversal (HTTP)', () => {
    let server: http.Server;
    let baseUrl: string;
    let wikiDir: string;

    beforeEach(async () => {
        // Create a temp wiki directory with a test file
        wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
        const testFile = path.join(wikiDir, 'index.html');
        fs.writeFileSync(testFile, '<html>test</html>');

        const store = createMockStore();
        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html>spa</html>',
            store,
            getWikiDir: (id: string) => id === 'test-wiki' ? wikiDir : undefined,
        });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server.on('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        fs.rmSync(wikiDir, { recursive: true, force: true });
    });

    it('serves a valid wiki static file', async () => {
        const res = await fetch(`${baseUrl}/wiki/test-wiki/static/index.html`);
        expect(res.status).toBe(200);
    });

    it('returns 404 for unknown wiki id', async () => {
        const res = await fetch(`${baseUrl}/wiki/nonexistent-wiki/static/index.html`);
        expect(res.status).toBe(404);
    });

    it('blocks directory traversal via URL-encoded segments', async () => {
        // %2F..%2F..%2Fetc%2Fpasswd
        const res = await fetch(`${baseUrl}/wiki/test-wiki/static/%2F..%2F..%2Fetc%2Fpasswd`);
        expect(res.status).toBe(404);
    });

    it('returns 404 for traversal attempt with literal dot-dot (raw HTTP request)', async () => {
        // Use raw http.request to avoid fetch normalizing the URL path
        const status = await new Promise<number>((resolve, reject) => {
            const addr = server.address() as { port: number };
            const rawPath = '/wiki/test-wiki/static/../../../etc/passwd';
            const req = http.request(
                { hostname: '127.0.0.1', port: addr.port, path: rawPath, method: 'GET' },
                (res) => {
                    res.resume(); // drain
                    res.on('end', () => resolve(res.statusCode ?? 0));
                },
            );
            req.on('error', reject);
            req.end();
        });
        expect(status).toBe(404);
    });

    it('returns 404 for file that does not exist', async () => {
        const res = await fetch(`${baseUrl}/wiki/test-wiki/static/missing.html`);
        expect(res.status).toBe(404);
    });
});
