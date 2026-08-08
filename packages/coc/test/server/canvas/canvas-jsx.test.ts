/**
 * Tests for the extension-canvas JSX transform.
 *
 * The load-bearing part beyond "does it compile JSX" is *when* esbuild is
 * loaded. This module is reachable from `server/index.ts` through an all-static
 * import chain (prompt-builder → canvas-tools → here), so a top-level
 * `import * as esbuild` turns any esbuild problem into a server startup crash —
 * which is exactly how the packaged desktop app died when esbuild was still a
 * devDependency and electron-builder pruned it out of the asar.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { transformCanvasJsx } from '../../../src/server/canvas/canvas-jsx';

const SOURCE_FILE = path.resolve(__dirname, '../../../src/server/canvas/canvas-jsx.ts');

describe('transformCanvasJsx', () => {
    afterEach(() => {
        vi.doUnmock('esbuild');
        vi.resetModules();
    });

    it('rewrites JSX to classic React.createElement calls', async () => {
        const result = await transformCanvasJsx('const App = () => <div className="x">hi</div>;');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.code).toContain('React.createElement');
        expect(result.code).not.toContain('jsx-runtime');
    });

    it('reports a syntax error with a line number instead of throwing', async () => {
        const result = await transformCanvasJsx('const App = () => <div>;');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/line \d+:\d+:/);
    });

    it('loads esbuild lazily, not at module load time', () => {
        // Regression guard for the packaged-app boot crash: a top-level import
        // here makes esbuild a startup requirement for the whole server.
        const source = fs.readFileSync(SOURCE_FILE, 'utf8');
        expect(source).not.toMatch(/^import \* as esbuild from 'esbuild';$/m);
        expect(source).toMatch(/^import type \* as esbuild from 'esbuild';$/m);
        expect(source).toContain("await import('esbuild')");
    });

    it('degrades to a failed transform when esbuild cannot be loaded', async () => {
        vi.doMock('esbuild', () => {
            throw new Error("Cannot find module 'esbuild'");
        });
        vi.resetModules();
        const { transformCanvasJsx: lazy } = await import('../../../src/server/canvas/canvas-jsx');

        const result = await lazy('const App = () => <div />;');

        // The point is that the failure stays inside the transform: a caller
        // gets a structured error, and importing this module never throws.
        // (The message is vitest's own mock-load wrapper, not esbuild's.)
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.length).toBeGreaterThan(0);
    });
});
