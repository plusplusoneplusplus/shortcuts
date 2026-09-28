/**
 * Pure engine selection and fallback reasons for the working-tree diff (AC-07).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    FALLBACK_REASON_MESSAGE,
    FALLBACK_REASON_PRECEDENCE,
    isRetryableFallback,
    resolveDiffEngineSelection,
    type DiffEngineResolutionInput,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffEngineResolution';

const loaded = (flags: { binary?: boolean; tooLarge?: boolean } = {}) =>
    ({ status: 'loaded', binary: !!flags.binary, tooLarge: !!flags.tooLarge }) as const;

function resolve(input: Partial<DiffEngineResolutionInput>) {
    return resolveDiffEngineSelection({
        preference: 'monaco', stage: 'unstaged', content: loaded(), editorFailed: false, ...input,
    });
}

describe('resolveDiffEngineSelection', () => {
    it('uses the editor for loaded text content', () => {
        expect(resolve({})).toEqual({ engine: 'monaco' });
        expect(resolve({ stage: 'staged' })).toEqual({ engine: 'monaco' });
    });

    it('selects classic with no banner when the user chose Classic', () => {
        expect(resolve({ preference: 'legacy' })).toEqual({ engine: 'legacy', fallback: null });
        // Even content that would otherwise fall back is not reported as a fallback.
        expect(resolve({ preference: 'legacy', content: { status: 'failed' }, editorFailed: true }))
            .toEqual({ engine: 'legacy', fallback: null });
    });

    it('leaves untracked files alone: no editor, no banner', () => {
        expect(resolve({ stage: 'untracked', content: null })).toEqual({ engine: 'legacy', fallback: null });
    });

    it('waits while content is loading or not yet requested', () => {
        expect(resolve({ content: null })).toEqual({ engine: 'loading' });
        expect(resolve({ content: { status: 'loading' } })).toEqual({ engine: 'loading' });
    });

    it('selects classic plus the specific reason for binary and oversized files', () => {
        expect(resolve({ content: loaded({ binary: true }) })).toEqual({ engine: 'legacy', fallback: 'binary' });
        expect(resolve({ content: loaded({ tooLarge: true }) })).toEqual({ engine: 'legacy', fallback: 'tooLarge' });
    });

    it('selects the generic load-failure reason when content fails', () => {
        expect(resolve({ content: { status: 'failed' } })).toEqual({ engine: 'legacy', fallback: 'loadFailed' });
    });

    it('selects editorFailed when the editor reports an error', () => {
        expect(resolve({ editorFailed: true })).toEqual({ engine: 'legacy', fallback: 'editorFailed' });
    });

    it('picks one reason deterministically when several apply', () => {
        expect(resolve({ content: loaded({ binary: true, tooLarge: true }), editorFailed: true }))
            .toEqual({ engine: 'legacy', fallback: 'binary' });
        expect(resolve({ content: loaded({ tooLarge: true }), editorFailed: true }))
            .toEqual({ engine: 'legacy', fallback: 'tooLarge' });
        expect(resolve({ content: { status: 'failed' }, editorFailed: true }))
            .toEqual({ engine: 'legacy', fallback: 'loadFailed' });
        expect(FALLBACK_REASON_PRECEDENCE).toEqual(['binary', 'tooLarge', 'loadFailed', 'editorFailed']);
    });

    it('renders deleted files in the editor (empty modified side), not as a fallback', () => {
        // Deletion is carried by head.exists=false with empty content; the flags stay clear.
        expect(resolve({ content: loaded() })).toEqual({ engine: 'monaco' });
    });

    it('offers retry only for reasons a fresh attempt could fix', () => {
        expect(isRetryableFallback('loadFailed')).toBe(true);
        expect(isRetryableFallback('editorFailed')).toBe(true);
        expect(isRetryableFallback('binary')).toBe(false);
        expect(isRetryableFallback('tooLarge')).toBe(false);
    });

    it('has a plain-words message for every reason', () => {
        for (const reason of FALLBACK_REASON_PRECEDENCE) {
            expect(FALLBACK_REASON_MESSAGE[reason]).toMatch(/classic diff/);
        }
    });
});

describe('fallback source assertions', () => {
    const root = path.resolve(__dirname, '../../../../../../src/server/spa/client/react/features/git');
    const surface = fs.readFileSync(path.join(root, 'working-tree/WorkingTreeFileDiff.tsx'), 'utf8');
    const files = [
        surface,
        fs.readFileSync(path.join(root, 'diff/diffEngineResolution.ts'), 'utf8'),
        fs.readFileSync(path.join(root, 'diff/DiffEngineFallbackBanner.tsx'), 'utf8'),
    ];

    it('never falls back through console output only', () => {
        for (const source of files) expect(source).not.toMatch(/console\.(warn|error|log)/);
        expect(surface).toContain('<DiffEngineFallbackBanner');
        expect(surface).toContain('onEditorError={handleEditorError}');
    });

    it('adds no TODOs', () => {
        for (const source of files) expect(source).not.toMatch(/TODO|FIXME/);
    });
});
