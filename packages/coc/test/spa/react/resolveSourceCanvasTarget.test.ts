/**
 * Tests for resolveSourceCanvasTarget — pure path + workspace resolution for
 * the docked source canvas (AC-06). Covers explicit wsId hints, longest-prefix
 * rootPath matching, first-workspace fallback, relative-path resolution against
 * the source file or workspace root, Windows path normalization, and the
 * unresolvable error paths.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveSourceCanvasTarget,
    isSourceCanvasResolveError,
} from '../../../src/server/spa/client/react/features/chat/source-canvas/resolve';

const WS = [
    { id: 'ws-root', rootPath: '/home/u/proj' },
    { id: 'ws-pkg', rootPath: '/home/u/proj/packages/coc' },
];

describe('resolveSourceCanvasTarget', () => {
    it('uses an explicit wsId hint and leaves an absolute path unchanged', () => {
        const r = resolveSourceCanvasTarget(
            { fullPath: '/anywhere/foo.ts', wsId: 'ws-explicit' },
            WS,
        );
        expect(isSourceCanvasResolveError(r)).toBe(false);
        expect(r).toEqual({ wsId: 'ws-explicit', path: '/anywhere/foo.ts' });
    });

    it('picks the workspace with the longest matching rootPath prefix', () => {
        const r = resolveSourceCanvasTarget(
            { fullPath: '/home/u/proj/packages/coc/src/foo.ts' },
            WS,
        );
        expect(r).toEqual({
            wsId: 'ws-pkg',
            path: '/home/u/proj/packages/coc/src/foo.ts',
        });
    });

    it('matches the shorter root when the path is only under it', () => {
        const r = resolveSourceCanvasTarget({ fullPath: '/home/u/proj/README.md' }, WS);
        expect(r).toEqual({ wsId: 'ws-root', path: '/home/u/proj/README.md' });
    });

    it('falls back to the first workspace when no rootPath matches', () => {
        const r = resolveSourceCanvasTarget({ fullPath: '/elsewhere/x.ts' }, WS);
        expect(r).toEqual({ wsId: 'ws-root', path: '/elsewhere/x.ts' });
    });

    it('does not match sibling paths that only share a root prefix', () => {
        const r = resolveSourceCanvasTarget(
            { fullPath: '/home/u/proj-other/src/foo.ts' },
            [
                { id: 'ws-proj', rootPath: '/home/u/proj' },
                { id: 'ws-home', rootPath: '/home/u' },
            ],
        );
        expect(r).toEqual({ wsId: 'ws-home', path: '/home/u/proj-other/src/foo.ts' });
    });

    it('returns an error (with attempted path) when there are no workspaces', () => {
        const r = resolveSourceCanvasTarget({ fullPath: '/elsewhere/x.ts' }, []);
        expect(isSourceCanvasResolveError(r)).toBe(true);
        expect(r).toEqual({ error: 'No workspace available', attemptedPath: '/elsewhere/x.ts' });
    });

    it('resolves a relative path against the source file directory', () => {
        const r = resolveSourceCanvasTarget(
            {
                fullPath: './util/helper.ts',
                sourceFilePath: '/home/u/proj/packages/coc/src/index.ts',
            },
            WS,
        );
        expect(r).toEqual({
            wsId: 'ws-pkg',
            path: '/home/u/proj/packages/coc/src/util/helper.ts',
        });
    });

    it('resolves a `../` relative path against the source file directory', () => {
        const r = resolveSourceCanvasTarget(
            {
                fullPath: '../shared/types.ts',
                sourceFilePath: '/home/u/proj/packages/coc/src/index.ts',
            },
            WS,
        );
        expect(r).toEqual({
            wsId: 'ws-pkg',
            path: '/home/u/proj/packages/coc/shared/types.ts',
        });
    });

    it('honors a wsId hint even for a relative path with a source file', () => {
        const r = resolveSourceCanvasTarget(
            {
                fullPath: './a.ts',
                sourceFilePath: '/home/u/proj/src/index.ts',
                wsId: 'ws-hint',
            },
            WS,
        );
        expect(r).toEqual({ wsId: 'ws-hint', path: '/home/u/proj/src/a.ts' });
    });

    it('resolves a workspace-relative path against the hinted workspace root', () => {
        const r = resolveSourceCanvasTarget({ fullPath: 'src/foo.ts', wsId: 'ws-pkg' }, WS);
        expect(r).toEqual({
            wsId: 'ws-pkg',
            path: '/home/u/proj/packages/coc/src/foo.ts',
        });
    });

    it('resolves a workspace-relative path against the first workspace root without a hint', () => {
        const r = resolveSourceCanvasTarget({ fullPath: 'src/foo.ts' }, WS);
        expect(r).toEqual({
            wsId: 'ws-root',
            path: '/home/u/proj/src/foo.ts',
        });
    });

    it('returns an error for an unrooted relative path with an unknown workspace hint', () => {
        const r = resolveSourceCanvasTarget({ fullPath: 'src/foo.ts', wsId: 'missing-ws' }, WS);
        expect(isSourceCanvasResolveError(r)).toBe(true);
        expect(r).toEqual({ error: 'No workspace root available', attemptedPath: 'src/foo.ts' });
    });

    it('normalizes Windows backslashes for prefix matching', () => {
        const r = resolveSourceCanvasTarget(
            { fullPath: 'C:\\work\\proj\\src\\foo.ts' },
            [{ id: 'ws-win', rootPath: 'C:/work/proj' }],
        );
        expect(r).toEqual({ wsId: 'ws-win', path: 'C:\\work\\proj\\src\\foo.ts' });
    });

    it('resolves a Windows workspace-relative path against the hinted workspace root', () => {
        const r = resolveSourceCanvasTarget(
            { fullPath: 'src\\foo.ts', wsId: 'ws-win' },
            [{ id: 'ws-win', rootPath: 'C:\\work\\proj' }],
        );
        expect(r).toEqual({ wsId: 'ws-win', path: 'C:/work/proj/src/foo.ts' });
    });
});
