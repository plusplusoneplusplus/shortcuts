/**
 * Tests for diffCoords — conversion between persisted DiffCommentSelection
 * coordinates and Monaco diff-editor ranges (AC-02). Pure: no Monaco runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    counterpartLine,
    createDiffLineIndexResolver,
    createLineSource,
    isChangedLine,
    monacoToSelection,
    selectionToMonaco,
    sideForSelection,
    type DiffLineChange,
} from '../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import type { DiffCommentSelection } from '../../../../../src/server/spa/client/comments/diff-comment-types';
import type { DiffLine } from '../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';

function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// original:            modified:
// 1 import a            1 import a
// 2 const x = 1;        2 const x = 2;      (line 2 changed)
// 3 keep                3 keep
// 4 drop me             -                   (line 4 removed)
// 5 tail                4 tail
// -                     5 added 🎉 end      (line 5 added)
const ORIGINAL = 'import a\nconst x = 1;\nkeep\ndrop me\ntail';
const MODIFIED = 'import a\nconst x = 2;\nkeep\ntail\nadded 🎉 end';
const CHANGES: DiffLineChange[] = [
    { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
    { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 3, modifiedEndLineNumber: 0 },
    { originalStartLineNumber: 5, originalEndLineNumber: 0, modifiedStartLineNumber: 5, modifiedEndLineNumber: 5 },
];
const original = createLineSource(ORIGINAL);
const modified = createLineSource(MODIFIED);

function sel(overrides: Partial<DiffCommentSelection>): DiffCommentSelection {
    return { diffLineStart: 0, diffLineEnd: 0, side: 'context', startColumn: 0, endColumn: 0, ...overrides };
}

/** Selections as the classic viewers persist them for this fixture. */
const CORPUS: Array<[string, DiffCommentSelection]> = [
    ['context line', sel({ side: 'context', oldLineStart: 3, oldLineEnd: 3, newLineStart: 3, newLineEnd: 3, startColumn: 0, endColumn: 4 })],
    ['added line', sel({ side: 'added', newLineStart: 2, newLineEnd: 2, startColumn: 6, endColumn: 11 })],
    ['removed line', sel({ side: 'removed', oldLineStart: 4, oldLineEnd: 4, startColumn: 0, endColumn: 7 })],
    ['changed-then-removed original span', sel({ side: 'removed', oldLineStart: 2, oldLineEnd: 4, newLineEnd: undefined, startColumn: 2, endColumn: 3 })],
    ['multi-line context', sel({ side: 'context', oldLineStart: 1, oldLineEnd: 3, newLineStart: 1, newLineEnd: 3, startColumn: 3, endColumn: 2 })],
    ['zero-length', sel({ side: 'context', oldLineStart: 5, oldLineEnd: 5, newLineStart: 4, newLineEnd: 4, startColumn: 2, endColumn: 2 })],
    ['emoji on added line', sel({ side: 'added', newLineStart: 5, newLineEnd: 5, startColumn: 6, endColumn: 12 })],
];

describe('diffCoords', () => {
    describe('selectionToMonaco', () => {
        it('shifts columns by one and keeps one-based file lines', () => {
            const placement = selectionToMonaco(CORPUS[1][1], { original, modified });
            expect(placement).toEqual({
                status: 'exact',
                clamped: false,
                range: { side: 'modified', startLineNumber: 2, startColumn: 7, endLineNumber: 2, endColumn: 12 },
            });
        });

        it('places context selections on the modified editor', () => {
            expect(sideForSelection({ side: 'context' })).toBe('modified');
            const placement = selectionToMonaco(sel({ side: 'context', oldLineStart: 5, oldLineEnd: 5, newLineStart: 4, newLineEnd: 4 }));
            expect(placement.status === 'exact' && placement.range).toMatchObject({ side: 'modified', startLineNumber: 4 });
        });

        it('picks the side from the selection side, not the range', () => {
            // Classic selection started on a removed line and ended on an added one.
            const placement = selectionToMonaco(
                sel({ side: 'removed', oldLineStart: 4, oldLineEnd: undefined, newLineStart: undefined, newLineEnd: 5, startColumn: 1, endColumn: 3 }),
                { original, modified },
            );
            expect(placement).toEqual({
                status: 'exact',
                clamped: false,
                range: { side: 'original', startLineNumber: 4, startColumn: 2, endLineNumber: 4, endColumn: 8 },
            });
        });

        it('treats NaN, null and 0 file lines as missing', () => {
            const placement = selectionToMonaco(
                sel({ side: 'added', oldLineStart: NaN, newLineStart: null as unknown as number, newLineEnd: 0 }),
            );
            expect(placement).toEqual({ status: 'unresolved', side: 'modified' });
        });

        it('clamps a selection past the end of the file instead of throwing', () => {
            const placement = selectionToMonaco(
                sel({ side: 'added', newLineStart: 40, newLineEnd: 42, startColumn: 3, endColumn: 99 }),
                { original, modified },
            );
            expect(placement).toEqual({
                status: 'exact',
                clamped: true,
                range: { side: 'modified', startLineNumber: 5, startColumn: 4, endLineNumber: 5, endColumn: 13 },
            });
        });

        it('clamps columns past the end of a line', () => {
            const placement = selectionToMonaco(sel({ side: 'context', newLineStart: 3, newLineEnd: 3, startColumn: 1, endColumn: 50 }), { modified });
            expect(placement).toMatchObject({ status: 'exact', clamped: true, range: { endColumn: 5 } });
        });

        it('handles an empty file', () => {
            const empty = createLineSource('');
            expect(empty.getLineCount()).toBe(1);
            const placement = selectionToMonaco(sel({ side: 'added', newLineStart: 3, newLineEnd: 3, startColumn: 4, endColumn: 4 }), { modified: empty });
            expect(placement).toEqual({
                status: 'exact',
                clamped: true,
                range: { side: 'modified', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            });
        });

        it('splits CRLF and lone CR like Monaco', () => {
            const src = createLineSource('a\r\nb\rc\n');
            expect(src.getLineCount()).toBe(4);
            expect([1, 2, 3, 4].map((n) => src.getLineContent(n))).toEqual(['a', 'b', 'c', '']);
        });

        it('without text sources it converts without clamping', () => {
            const placement = selectionToMonaco(sel({ side: 'added', newLineStart: 400, newLineEnd: 400, startColumn: 9, endColumn: 10 }));
            expect(placement).toEqual({
                status: 'exact',
                clamped: false,
                range: { side: 'modified', startLineNumber: 400, startColumn: 10, endLineNumber: 400, endColumn: 11 },
            });
        });
    });

    describe('legacy fingerprint recovery', () => {
        const legacy = sel({ side: 'added', diffLineStart: 17, diffLineEnd: 17, startColumn: 0, endColumn: 5 });

        it('recovers a selection with only diffLineStart via the anchor, tagged as recovered', () => {
            const anchor = { selectedText: 'x = 2', contextBefore: '', contextAfter: '', originalLine: 17, textHash: hashText('x = 2') };
            expect(selectionToMonaco(legacy, { original, modified, anchor })).toEqual({
                status: 'recovered',
                clamped: false,
                range: { side: 'modified', startLineNumber: 2, startColumn: 7, endLineNumber: 2, endColumn: 12 },
            });
        });

        it('searches the original side for removed selections', () => {
            const anchor = { selectedText: 'drop', contextBefore: '', contextAfter: '', originalLine: 3, textHash: 'nomatch' };
            const placement = selectionToMonaco({ ...legacy, side: 'removed' }, { original, modified, anchor });
            expect(placement).toMatchObject({ status: 'recovered', range: { side: 'original', startLineNumber: 4, startColumn: 1, endColumn: 5 } });
        });

        it('keeps the legacy line span when the text spans lines', () => {
            const anchor = { selectedText: 'import a\nconst', contextBefore: '', contextAfter: '', originalLine: 0, textHash: hashText('import a') };
            const placement = selectionToMonaco({ ...legacy, diffLineStart: 3, diffLineEnd: 4 }, { modified, anchor });
            expect(placement).toMatchObject({ status: 'recovered', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 13 } });
        });

        it('is unresolved when the fingerprint no longer matches', () => {
            const anchor = { selectedText: 'gone', contextBefore: '', contextAfter: '', originalLine: 3, textHash: 'nomatch' };
            expect(selectionToMonaco(legacy, { original, modified, anchor })).toEqual({ status: 'unresolved', side: 'modified' });
        });

        it('is unresolved without an anchor or text', () => {
            expect(selectionToMonaco(legacy, { modified })).toEqual({ status: 'unresolved', side: 'modified' });
            const anchor = { selectedText: 'x = 2', contextBefore: '', contextAfter: '', originalLine: 0, textHash: '' };
            expect(selectionToMonaco(legacy, { anchor })).toEqual({ status: 'unresolved', side: 'modified' });
        });
    });

    describe('line-change mapping', () => {
        it('classifies changed and unchanged lines on each side', () => {
            expect([1, 2, 3, 4, 5].map((n) => isChangedLine('original', n, CHANGES))).toEqual([false, true, false, true, false]);
            expect([1, 2, 3, 4, 5].map((n) => isChangedLine('modified', n, CHANGES))).toEqual([false, true, false, false, true]);
        });

        it('maps unchanged lines to their counterpart across insertions and deletions', () => {
            expect([1, 2, 3, 4, 5].map((n) => counterpartLine('original', n, CHANGES))).toEqual([1, undefined, 3, undefined, 4]);
            expect([1, 2, 3, 4, 5].map((n) => counterpartLine('modified', n, CHANGES))).toEqual([1, undefined, 3, 5, undefined]);
        });

        it('handles an insertion at the top of the file', () => {
            const changes = [{ originalStartLineNumber: 0, originalEndLineNumber: 0, modifiedStartLineNumber: 1, modifiedEndLineNumber: 2 }];
            expect(counterpartLine('original', 1, changes)).toBe(3);
            expect(counterpartLine('modified', 3, changes)).toBe(1);
        });
    });

    describe('monacoToSelection', () => {
        it('converts a modified-editor range on an added line', () => {
            const selection = monacoToSelection('modified', { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 6 }, { lineChanges: CHANGES });
            expect(selection).toEqual({
                diffLineStart: -1,
                diffLineEnd: -1,
                side: 'added',
                oldLineStart: undefined,
                oldLineEnd: undefined,
                newLineStart: 5,
                newLineEnd: 5,
                startColumn: 0,
                endColumn: 5,
            });
        });

        it('marks unchanged lines as context from either editor', () => {
            const fromModified = monacoToSelection('modified', { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 3 }, { lineChanges: CHANGES });
            expect(fromModified).toMatchObject({ side: 'context', oldLineStart: 5, newLineStart: 4 });
            const fromOriginal = monacoToSelection('original', { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 3 }, { lineChanges: CHANGES });
            expect(fromOriginal).toMatchObject({ side: 'context', oldLineStart: 5, newLineStart: 4 });
            // Context always goes back to the modified editor.
            expect(selectionToMonaco(fromOriginal)).toMatchObject({ range: { side: 'modified', startLineNumber: 4 } });
        });

        it('marks changed lines on the original editor as removed', () => {
            expect(monacoToSelection('original', { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 }, { lineChanges: CHANGES }))
                .toMatchObject({ side: 'removed', oldLineStart: 4, newLineStart: undefined });
        });

        it('fills diffLineStart/End from the classic patch resolver', () => {
            const lines: DiffLine[] = [
                { index: 0, type: 'meta', content: 'diff --git a/f b/f' },
                { index: 1, type: 'hunk-header', content: '@@ -1,5 +1,5 @@' },
                { index: 2, type: 'context', content: 'import a', oldLine: 1, newLine: 1 },
                { index: 3, type: 'removed', content: 'const x = 1;', oldLine: 2 },
                { index: 4, type: 'added', content: 'const x = 2;', newLine: 2 },
                { index: 5, type: 'context', content: 'keep', oldLine: 3, newLine: 3 },
            ];
            const diffLineIndexOf = createDiffLineIndexResolver(lines);
            const selection = monacoToSelection('modified', { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 2 }, { lineChanges: CHANGES, diffLineIndexOf });
            expect(selection).toMatchObject({ diffLineStart: 4, diffLineEnd: 5 });
            expect(diffLineIndexOf('old', 2)).toBe(3);
            expect(diffLineIndexOf('new', 99)).toBeUndefined();
        });
    });

    describe('round trip', () => {
        it.each(CORPUS)('%s survives selection → Monaco → selection', (_name, selection) => {
            const placement = selectionToMonaco(selection, { original, modified });
            expect(placement.status).toBe('exact');
            if (placement.status !== 'exact') {return;}
            expect(placement.clamped).toBe(false);
            const { side, ...range } = placement.range;
            const back = monacoToSelection(side, range, { lineChanges: CHANGES });
            expect(back.side).toBe(selection.side);
            expect(back.startColumn).toBe(selection.startColumn);
            if (sideForSelection(selection) === 'original') {
                expect(back.oldLineStart).toBe(selection.oldLineStart);
            } else {
                expect(back.newLineStart).toBe(selection.newLineStart);
                expect(back.newLineEnd).toBe(selection.newLineEnd);
                expect(back.endColumn).toBe(selection.endColumn);
            }
            // Re-placing the converted selection lands on the identical range.
            expect(selectionToMonaco(back, { original, modified })).toEqual(placement);
        });

        it('keeps UTF-16 columns around an emoji', () => {
            const line = modified.getLineContent(5);
            const start = line.indexOf('🎉');
            const selection = sel({ side: 'added', newLineStart: 5, newLineEnd: 5, startColumn: start, endColumn: start + '🎉'.length });
            const placement = selectionToMonaco(selection, { modified });
            expect(placement.status === 'exact' && line.slice(placement.range.startColumn - 1, placement.range.endColumn - 1)).toBe('🎉');
            if (placement.status !== 'exact') {return;}
            const back = monacoToSelection('modified', placement.range, { lineChanges: CHANGES });
            expect([back.startColumn, back.endColumn]).toEqual([6, 8]);
            // The text after the emoji starts at the UTF-16 offset, not the code-point offset.
            expect(line.slice(back.endColumn)).toBe(' end');
        });

        it('detects an off-by-one column error', () => {
            const selection = CORPUS[1][1];
            const placement = selectionToMonaco(selection);
            if (placement.status !== 'exact') {throw new Error('expected exact');}
            const shifted = { ...placement.range, startColumn: placement.range.startColumn + 1 };
            expect(monacoToSelection('modified', shifted, { lineChanges: CHANGES }).startColumn).not.toBe(selection.startColumn);
        });
    });

    it('has no runtime import of monaco-editor', () => {
        const src = readFileSync(join(__dirname, '../../../../../src/server/spa/client/react/features/git/diff/diffCoords.ts'), 'utf8');
        const valueImports = src.split('\n').filter((l) => /^import\s+(?!type\b)/.test(l));
        expect(valueImports.some((l) => l.includes('monaco-editor'))).toBe(false);
        expect(src).not.toMatch(/TODO/);
        const testSrc = readFileSync(__filename, 'utf8');
        expect(testSrc.split('\n').some((l) => /^import\s+(?!type\b).*['"]monaco-editor/.test(l))).toBe(false);
    });
});
