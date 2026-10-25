/**
 * Path Traversal Prevention Tests (Section 9)
 *
 * Unit tests for `isWithinDirectory` from @plusplusoneplusplus/forge and a
 * router regression check that no `/wiki/:id/static/*` file route remains.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { createRequestHandler } from '../../src/server/router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { vi } from 'vitest';

// ============================================================================
// Unit tests: isWithinDirectory
// ============================================================================

describe('isWithinDirectory', () => {
    it('returns true when target is inside base directory', () => {
        const sep = path.sep;
        const base = path.join('/site', 'out');
        const target = path.join('/site', 'out', 'valid', 'file.html');
        expect(isWithinDirectory(target, base)).toBe(true);
    });

    it('returns false for directory traversal via ..', () => {
        // Resolves to /etc/passwd or similar, outside /site/out
        const base = path.join('/site', 'out');
        const target = path.resolve(base, '..', '..', '..', 'etc', 'passwd');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns true when target equals base (the directory itself)', () => {
        const base = path.join('/site', 'out');
        expect(isWithinDirectory(base, base)).toBe(true);
    });

    it('returns false for paths that share a prefix but are not children', () => {
        // /site/outmore/file should NOT be considered inside /site/out
        const base = path.join('/site', 'out');
        const target = path.join('/site', 'outmore', 'file');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns false when target is a sibling directory', () => {
        const base = path.join('/site', 'out');
        const target = path.join('/site', 'other');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns false when target is parent of base', () => {
        const base = path.join('/site', 'out');
        const target = path.join('/site');
        expect(isWithinDirectory(target, base)).toBe(false);
    });

    it('returns true for deep nested path', () => {
        const base = path.join('/site', 'out');
        const target = path.join('/site', 'out', 'a', 'b', 'c', 'deep.html');
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
// Integration test: the removed wiki static route serves no files
// ============================================================================

function createMockStore(): ProcessStore {
    return {
        getProcessCount: vi.fn(async () => 0),
        getStorageStats: vi.fn(async () => ({ totalProcesses: 0, totalWorkspaces: 0, storageSize: 0 })),
    } as unknown as ProcessStore;
}

describe('former wiki static route', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html>spa</html>',
            store: createMockStore(),
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
    });

    it('falls through to the SPA instead of serving files', async () => {
        const res = await fetch(`${baseUrl}/wiki/demo/static/index.html`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>spa</html>');
    });
});
