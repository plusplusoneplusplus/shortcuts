/**
 * diffFindModel — pure search-model unit tests for the in-diff Ctrl+F find.
 *
 * Covers full-model match counting across multiple files, case sensitivity,
 * next/prev wrap-around, per-line grouping with active flagging, and the
 * HTML overlay that wraps match ranges without breaking hljs syntax spans.
 */

import { describe, it, expect } from 'vitest';
import {
    computeDiffLines,
} from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import {
    computeDiffMatches,
    nextMatchIndex,
    prevMatchIndex,
    groupMatchesByLine,
    applyMatchHighlights,
    isSearchableLine,
    lineSearchText,
    type DiffMatch,
} from '../../../src/server/spa/client/react/features/git/diff/diffFindModel';

function diffLinesOf(raw: string) {
    return computeDiffLines(raw.split('\n'));
}

const TWO_FILE_DIFF = [
    'diff --git a/alpha.ts b/alpha.ts',
    '--- a/alpha.ts',
    '+++ b/alpha.ts',
    '@@ -1,3 +1,3 @@',
    ' const foo = 1;',
    '-const bar = foo;',
    '+const bar = FOO;',
    'diff --git a/beta.ts b/beta.ts',
    '--- a/beta.ts',
    '+++ b/beta.ts',
    '@@ -1,2 +1,2 @@',
    ' return foo + bar;',
    '+const baz = foo;',
].join('\n');

describe('isSearchableLine / lineSearchText', () => {
    it('treats added/removed/context lines with content as searchable and strips the prefix', () => {
        const lines = diffLinesOf(TWO_FILE_DIFF);
        const added = lines.find(l => l.content === '+const bar = FOO;')!;
        const removed = lines.find(l => l.content === '-const bar = foo;')!;
        const context = lines.find(l => l.content === ' const foo = 1;')!;
        expect(isSearchableLine(added)).toBe(true);
        expect(isSearchableLine(removed)).toBe(true);
        expect(isSearchableLine(context)).toBe(true);
        expect(lineSearchText(added)).toBe('const bar = FOO;');
        expect(lineSearchText(context)).toBe('const foo = 1;');
    });

    it('never treats hunk headers or git meta lines as searchable', () => {
        const lines = diffLinesOf(TWO_FILE_DIFF);
        const hunk = lines.find(l => l.type === 'hunk-header')!;
        const meta = lines.find(l => l.type === 'meta')!;
        expect(isSearchableLine(hunk)).toBe(false);
        expect(isSearchableLine(meta)).toBe(false);
    });
});

describe('computeDiffMatches', () => {
    it('counts matches across all files in the model (not just one)', () => {
        const lines = diffLinesOf(TWO_FILE_DIFF);
        // Case-insensitive "foo": alpha context (1) + alpha removed (1) +
        // alpha added FOO (1) + beta context (1) + beta added (1) = 5.
        const matches = computeDiffMatches(lines, 'foo', false);
        expect(matches.length).toBe(5);
        // Document order: ascending line index.
        const indices = matches.map(m => m.lineIndex);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
    });

    it('honors case sensitivity', () => {
        const lines = diffLinesOf(TWO_FILE_DIFF);
        const insensitive = computeDiffMatches(lines, 'FOO', false);
        const sensitive = computeDiffMatches(lines, 'FOO', true);
        expect(insensitive.length).toBe(5);
        // Only the `+const bar = FOO;` line has an uppercase FOO.
        expect(sensitive.length).toBe(1);
        expect(lineSearchText(lines[sensitive[0].lineIndex])).toContain('FOO');
    });

    it('does not match hunk headers, file paths, or line numbers', () => {
        const lines = diffLinesOf(TWO_FILE_DIFF);
        // "alpha" appears only in the git meta + header lines, never in content.
        expect(computeDiffMatches(lines, 'alpha', false)).toEqual([]);
        // "@@" is a hunk-header token, never content.
        expect(computeDiffMatches(lines, '@@', false)).toEqual([]);
    });

    it('returns non-overlapping matches and correct offsets', () => {
        const lines = diffLinesOf([
            'diff --git a/x.txt b/x.txt',
            '@@ -1 +1 @@',
            '+aaaa',
        ].join('\n'));
        const matches = computeDiffMatches(lines, 'aa', false);
        expect(matches.length).toBe(2);
        expect(matches[0]).toMatchObject({ start: 0, end: 2 });
        expect(matches[1]).toMatchObject({ start: 2, end: 4 });
    });

    it('returns nothing for an empty query', () => {
        const lines = diffLinesOf(TWO_FILE_DIFF);
        expect(computeDiffMatches(lines, '', false)).toEqual([]);
    });
});

describe('nextMatchIndex / prevMatchIndex', () => {
    it('wraps forward and starts at 0 when nothing active', () => {
        expect(nextMatchIndex(-1, 3)).toBe(0);
        expect(nextMatchIndex(0, 3)).toBe(1);
        expect(nextMatchIndex(2, 3)).toBe(0); // wrap
    });

    it('wraps backward and starts at the last when nothing active', () => {
        expect(prevMatchIndex(-1, 3)).toBe(2);
        expect(prevMatchIndex(2, 3)).toBe(1);
        expect(prevMatchIndex(0, 3)).toBe(2); // wrap
    });

    it('returns -1 when there are no matches', () => {
        expect(nextMatchIndex(-1, 0)).toBe(-1);
        expect(prevMatchIndex(-1, 0)).toBe(-1);
    });
});

describe('groupMatchesByLine', () => {
    it('groups ranges per line and flags the active one', () => {
        const matches: DiffMatch[] = [
            { lineIndex: 4, start: 0, end: 3 },
            { lineIndex: 4, start: 10, end: 13 },
            { lineIndex: 7, start: 2, end: 5 },
        ];
        const grouped = groupMatchesByLine(matches, 2);
        expect(grouped.get(4)!.map(r => r.active)).toEqual([false, false]);
        expect(grouped.get(7)!.map(r => r.active)).toEqual([true]);
        expect(grouped.get(4)!.length).toBe(2);
    });
});

describe('applyMatchHighlights', () => {
    it('wraps a plain-text match in a mark', () => {
        const out = applyMatchHighlights('const foo = 1;', [{ start: 6, end: 9, active: false }], 'm', 'am');
        expect(out).toBe('const <mark class="m">foo</mark> = 1;');
    });

    it('uses the active class for the active range', () => {
        const out = applyMatchHighlights('foo', [{ start: 0, end: 3, active: true }], 'm', 'am');
        expect(out).toBe('<mark class="am">foo</mark>');
    });

    it('counts an HTML entity as a single source character', () => {
        // Source text: `a<b` → highlighter escapes `<` to `&lt;`. Matching "b"
        // is at source offset 2, which sits after the entity.
        const html = 'a&lt;b';
        const out = applyMatchHighlights(html, [{ start: 2, end: 3, active: false }], 'm', 'am');
        expect(out).toBe('a&lt;<mark class="m">b</mark>');
    });

    it('does not break hljs spans — splits the mark across a tag boundary', () => {
        // `<span class="hljs-keyword">const</span> foo` — matching "const foo"
        // (offsets 0..9) must not nest a mark across the closing </span>.
        const html = '<span class="hljs-keyword">const</span> foo';
        const out = applyMatchHighlights(html, [{ start: 0, end: 9, active: false }], 'm', 'am');
        expect(out).toBe(
            '<span class="hljs-keyword"><mark class="m">const</mark></span><mark class="m"> foo</mark>'
        );
        // Every opened <mark> is closed (balanced) and no </span> is left dangling.
        expect((out.match(/<mark/g) || []).length).toBe((out.match(/<\/mark>/g) || []).length);
    });

    it('handles multiple ranges on one line', () => {
        const out = applyMatchHighlights(
            'foo bar foo',
            [{ start: 0, end: 3, active: false }, { start: 8, end: 11, active: true }],
            'm',
            'am',
        );
        expect(out).toBe('<mark class="m">foo</mark> bar <mark class="am">foo</mark>');
    });

    it('returns the input unchanged when there are no ranges', () => {
        expect(applyMatchHighlights('foo', [], 'm', 'am')).toBe('foo');
    });
});
