/**
 * Tests for the temporary DiffLine[] shim (AC-03). Parity is checked against
 * real `git diff`: line changes come from `git diff -U0` (the same encoding
 * Monaco's ILineChange uses), and the shim's rows must equal the classic
 * parser's rows for `git diff -U3` of the same two files.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { synthesizeDiffLines } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffLineShim';
import { computeDiffLines, type DiffLine } from '../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { createGitDiffFixture } from './gitDiffFixture';

const fixture = createGitDiffFixture('monaco-shim-');
afterAll(() => fixture.dispose());
const { gitDiff, lineChangesFromGit } = fixture;

// Row identity only: git appends function context to `@@` headers, the shim does not.
const strip = (lines: DiffLine[]) => lines.map(({ index: _index, ...rest }) =>
    rest.type === 'hunk-header' ? { ...rest, content: rest.content.replace(/^(@@ [^@]+ @@).*$/, '$1') } : rest);

function expectGitParity(original: string, modified: string) {
    const classic = computeDiffLines(gitDiff(original, modified, 3)).filter(line => line.type !== 'meta');
    const shim = synthesizeDiffLines(original, modified, lineChangesFromGit(original, modified));
    expect(strip(shim)).toEqual(strip(classic));
    expect(shim.map(line => line.index)).toEqual(shim.map((_, i) => i));
}

const numbered = (n: number, edit: (i: number) => string | null = i => `line ${i}`) =>
    Array.from({ length: n }, (_, i) => edit(i + 1)).filter((line): line is string => line !== null).join('\n') + '\n';

describe('synthesizeDiffLines — parity with git diff -U3', () => {
    it.each([
        ['single modification', numbered(10), numbered(10, i => (i === 5 ? 'changed' : `line ${i}`))],
        ['addition at the top', numbered(6), 'new\n' + numbered(6)],
        ['removal at the bottom', numbered(8), numbered(7)],
        ['removal in the middle', numbered(12), numbered(12, i => (i === 6 || i === 7 ? null : `line ${i}`))],
        ['two nearby changes merge into one hunk', numbered(20), numbered(20, i => (i === 5 || i === 11 ? `x${i}` : `line ${i}`))],
        ['two distant changes stay two hunks', numbered(40), numbered(40, i => (i === 3 || i === 30 ? `x${i}` : `line ${i}`))],
        ['new file', '', numbered(3)],
        ['deleted file', numbered(3), ''],
        ['unicode and emoji', 'α\nβ 😀\nγ\n', 'α\nβ 😃\nγ\n'],
        ['multi-line replacement', numbered(15), numbered(15, i => (i >= 4 && i <= 9 ? `r${i}` : `line ${i}`))],
    ])('%s', (_name, original, modified) => {
        expectGitParity(original, modified);
    });

    it('CRLF files keep row identity with git (content without the CR)', () => {
        const original = 'a\r\nb\r\nc\r\n';
        const modified = 'a\r\nB\r\nc\r\n';
        const shim = synthesizeDiffLines(original, modified, lineChangesFromGit(original, modified));
        expect(shim.map(l => [l.type, l.oldLine, l.newLine, l.content])).toEqual([
            ['hunk-header', undefined, undefined, '@@ -1,3 +1,3 @@'],
            ['context', 1, 1, ' a'],
            ['removed', 2, undefined, '-b'],
            ['added', undefined, 2, '+B'],
            ['context', 3, 3, ' c'],
        ]);
    });

    it('an off-by-one line change fails parity (negative control)', () => {
        const original = numbered(10);
        const modified = numbered(10, i => (i === 5 ? 'changed' : `line ${i}`));
        const shifted = lineChangesFromGit(original, modified).map(c => ({
            ...c, originalStartLineNumber: c.originalStartLineNumber + 1, originalEndLineNumber: c.originalEndLineNumber + 1,
        }));
        const classic = computeDiffLines(gitDiff(original, modified, 3)).filter(line => line.type !== 'meta');
        expect(strip(synthesizeDiffLines(original, modified, shifted))).not.toEqual(strip(classic));
    });

    it('no line changes → no rows', () => {
        expect(synthesizeDiffLines('same\n', 'same\n', [])).toEqual([]);
    });
});
