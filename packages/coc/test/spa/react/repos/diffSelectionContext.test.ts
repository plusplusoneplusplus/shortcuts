import { describe, expect, it } from 'vitest';
import { computeDiffLines } from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import {
    buildDiffLineSelection,
    createDiffSelectionDragPayloadFromLines,
    createMonacoDiffSelectionDragPayload,
} from '../../../../src/server/spa/client/react/features/git/diff/diffSelectionContext';
import {
    buildDiffSelectionLabel,
    createDiffSelectionContextDragPayload,
    DIFF_SELECTION_CONTEXT_DRAG_KIND,
    DIFF_SELECTION_CONTEXT_DRAG_MIME,
    formatDiffSelectionRef,
    writeDiffSelectionContextDragData,
} from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

const MULTI_FILE_DIFF = [
    'diff --git a/src/a.ts b/src/a.ts',     // 0
    'index 111..222 100644',                // 1
    '--- a/src/a.ts',                       // 2
    '+++ b/src/a.ts',                       // 3
    '@@ -10,4 +10,4 @@ fn',                 // 4
    ' const keep = 1;',                     // 5  old 10 / new 10
    '-const oldValue = 2;',                 // 6  old 11
    '+const newValue = 2;',                 // 7  new 11
    '+const extra = 3;',                    // 8  new 12
    ' return keep;',                        // 9  old 12 / new 13
    '\\ No newline at end of file',         // 10
    'diff --git a/src/b.ts b/src/b.ts',     // 11
    '--- a/src/b.ts',                       // 12
    '+++ b/src/b.ts',                       // 13
    '@@ -1,1 +1,1 @@',                      // 14
    '-b old',                               // 15
    '+b new',                               // 16
];

const lines = computeDiffLines(MULTI_FILE_DIFF);

describe('buildDiffLineSelection', () => {
    it('keeps markers and both ranges for a selection spanning context, removed, and added lines', () => {
        expect(buildDiffLineSelection(lines, 5, 9)).toEqual({
            filePath: 'src/a.ts',
            snippet: [' const keep = 1;', '-const oldValue = 2;', '+const newValue = 2;', '+const extra = 3;', ' return keep;'].join('\n'),
            oldRange: { start: 10, end: 12 },
            newRange: { start: 10, end: 13 },
        });
    });

    it('accepts reversed start/end (selection made bottom-up)', () => {
        expect(buildDiffLineSelection(lines, 9, 5)).toEqual(buildDiffLineSelection(lines, 5, 9));
    });

    it('omits the old range when only added lines are selected', () => {
        expect(buildDiffLineSelection(lines, 7, 8)).toEqual({
            filePath: 'src/a.ts',
            snippet: '+const newValue = 2;\n+const extra = 3;',
            newRange: { start: 11, end: 12 },
        });
    });

    it('skips hunk headers and the no-newline marker', () => {
        const selection = buildDiffLineSelection(lines, 4, 10);
        expect(selection?.snippet.split('\n')).toHaveLength(5);
        expect(selection?.snippet).not.toContain('@@');
        expect(selection?.snippet).not.toContain('No newline');
    });

    it('clamps a cross-file selection to the file where it started', () => {
        const selection = buildDiffLineSelection(lines, 8, 16);
        expect(selection).toEqual({
            filePath: 'src/a.ts',
            snippet: '+const extra = 3;\n return keep;',
            oldRange: { start: 12, end: 12 },
            newRange: { start: 12, end: 13 },
        });
    });

    it('resolves the file of a later file section', () => {
        expect(buildDiffLineSelection(lines, 15, 16)?.filePath).toBe('src/b.ts');
    });

    it('keeps only the old side in a left-column split-view selection', () => {
        expect(buildDiffLineSelection(lines, 5, 9, 'old')).toEqual({
            filePath: 'src/a.ts',
            snippet: ' const keep = 1;\n-const oldValue = 2;\n return keep;',
            oldRange: { start: 10, end: 12 },
        });
    });

    it('keeps only the new side in a right-column split-view selection', () => {
        expect(buildDiffLineSelection(lines, 5, 9, 'new')).toEqual({
            filePath: 'src/a.ts',
            snippet: ' const keep = 1;\n+const newValue = 2;\n+const extra = 3;\n return keep;',
            newRange: { start: 10, end: 13 },
        });
    });

    it('returns null when no code line is covered', () => {
        expect(buildDiffLineSelection(lines, 0, 4)).toBeNull();
        expect(buildDiffLineSelection([], 0, 0)).toBeNull();
    });

    it('returns a null file path for header-less single-file diffs', () => {
        const single = computeDiffLines(['@@ -3,1 +3,1 @@', '-x', '+y']);
        expect(buildDiffLineSelection(single, 1, 2)?.filePath).toBeNull();
    });
});

describe('createDiffSelectionDragPayloadFromLines', () => {
    it('builds a full payload with the commit ref and label', () => {
        const payload = createDiffSelectionDragPayloadFromLines({
            diffLines: lines,
            startIndex: 5,
            endIndex: 9,
            workspaceId: 'ws-1',
            ref: { type: 'commit', commitHash: '585e64d1234567890abcdef' },
        });
        expect(payload).toEqual({
            kind: DIFF_SELECTION_CONTEXT_DRAG_KIND,
            version: 1,
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/a.ts',
            oldRange: { start: 10, end: 12 },
            newRange: { start: 10, end: 13 },
            ref: { type: 'commit', commitHash: '585e64d1234567890abcdef' },
            snippet: [' const keep = 1;', '-const oldValue = 2;', '+const newValue = 2;', '+const extra = 3;', ' return keep;'].join('\n'),
            label: 'src/a.ts:L10-L13 @ 585e64d',
        });
    });

    it('uses the fallback file path for header-less diffs', () => {
        const single = computeDiffLines(['@@ -3,1 +3,1 @@', '-x', '+y']);
        const payload = createDiffSelectionDragPayloadFromLines({
            diffLines: single,
            startIndex: 1,
            endIndex: 1,
            workspaceId: 'ws-1',
            ref: { type: 'working-tree' },
            fallbackFilePath: 'lib/x.ts',
        });
        expect(payload?.filePath).toBe('lib/x.ts');
        expect(payload?.oldRange).toEqual({ start: 3, end: 3 });
        expect(payload?.newRange).toBeUndefined();
        expect(payload?.label).toBe('lib/x.ts:L3 @ working tree');
    });

    it('returns null without a workspace, ref, file path, or selected code', () => {
        const base = { diffLines: lines, startIndex: 5, endIndex: 9, workspaceId: 'ws-1', ref: { type: 'staged' as const } };
        expect(createDiffSelectionDragPayloadFromLines({ ...base, workspaceId: null })).toBeNull();
        expect(createDiffSelectionDragPayloadFromLines({ ...base, ref: null })).toBeNull();
        expect(createDiffSelectionDragPayloadFromLines({ ...base, startIndex: 0, endIndex: 3 })).toBeNull();
        const single = computeDiffLines(['@@ -1,1 +1,1 @@', '+y']);
        expect(createDiffSelectionDragPayloadFromLines({ ...base, diffLines: single, startIndex: 1, endIndex: 1 })).toBeNull();
    });
});

describe('createMonacoDiffSelectionDragPayload', () => {
    it('uses Monaco selection line coordinates without patch-row reconstruction', () => {
        expect(createMonacoDiffSelectionDragPayload(
            { oldLineStart: 10, oldLineEnd: 12, newLineStart: 10, newLineEnd: 13 },
            'const selected = true;',
            { workspaceId: 'ws-1', filePath: 'src/a.ts', ref: { type: 'commit', commitHash: 'abcdef123456' } },
        )).toMatchObject({
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/a.ts',
            oldRange: { start: 10, end: 12 },
            newRange: { start: 10, end: 13 },
            snippet: 'const selected = true;',
            ref: { type: 'commit', commitHash: 'abcdef123456' },
        });
    });

    it('preserves a one-sided added-line selection', () => {
        const payload = createMonacoDiffSelectionDragPayload(
            { newLineStart: 5, newLineEnd: 7 },
            'added',
            { workspaceId: 'ws-1', filePath: 'src/a.ts', ref: { type: 'range', baseRef: 'main', headRef: 'feature' } },
        );
        expect(payload?.oldRange).toBeUndefined();
        expect(payload?.newRange).toEqual({ start: 5, end: 7 });
    });
});

describe('diff selection drag payload helpers', () => {
    it('formats refs', () => {
        expect(formatDiffSelectionRef({ type: 'commit', commitHash: 'abcdef1234567890' })).toBe('abcdef1');
        expect(formatDiffSelectionRef({ type: 'range', baseRef: 'main', headRef: 'feature/x' })).toBe('main..feature/x');
        expect(formatDiffSelectionRef({ type: 'range', baseRef: 'aaaaaaaaaaaa', headRef: 'bbbbbbbbbbbb' })).toBe('aaaaaaa..bbbbbbb');
        expect(formatDiffSelectionRef({ type: 'working-tree' })).toBe('working tree');
        expect(formatDiffSelectionRef({ type: 'staged' })).toBe('staged');
    });

    it('labels by the new range, falling back to the old range', () => {
        const ref = { type: 'staged' as const };
        expect(buildDiffSelectionLabel('a.ts', { oldRange: { start: 1, end: 2 }, newRange: { start: 5, end: 9 } }, ref)).toBe('a.ts:L5-L9 @ staged');
        expect(buildDiffSelectionLabel('a.ts', { oldRange: { start: 1, end: 2 } }, ref)).toBe('a.ts:L1-L2 @ staged');
    });

    it('rejects absolute file paths, local-path workspace ids, and malformed refs', () => {
        const base = { sourceWorkspaceId: 'ws-1', filePath: 'a.ts', snippet: '+x', ref: { type: 'staged' } };
        expect(createDiffSelectionContextDragPayload(base)).not.toBeNull();
        expect(createDiffSelectionContextDragPayload({ ...base, filePath: '/home/me/a.ts' })).toBeNull();
        expect(createDiffSelectionContextDragPayload({ ...base, filePath: 'C:\\repo\\a.ts' })).toBeNull();
        expect(createDiffSelectionContextDragPayload({ ...base, sourceWorkspaceId: '/tmp/ws' })).toBeNull();
        expect(createDiffSelectionContextDragPayload({ ...base, ref: { type: 'commit' } })).toBeNull();
        expect(createDiffSelectionContextDragPayload({ ...base, ref: { type: 'bogus' } })).toBeNull();
        expect(createDiffSelectionContextDragPayload({ ...base, snippet: '   ' })).toBeNull();
    });

    it('drops invalid line ranges', () => {
        const payload = createDiffSelectionContextDragPayload({
            sourceWorkspaceId: 'ws-1', filePath: 'a.ts', snippet: '+x', ref: { type: 'staged' },
            oldRange: { start: 5, end: 2 }, newRange: { start: 1, end: 1 },
        });
        expect(payload?.oldRange).toBeUndefined();
        expect(payload?.newRange).toEqual({ start: 1, end: 1 });
    });

    it('writes the JSON payload plus raw diff text as text/plain', () => {
        const data = new Map<string, string>();
        const dataTransfer = { setData: (format: string, value: string) => { data.set(format, value); }, effectAllowed: undefined as any };
        const payload = createDiffSelectionContextDragPayload({ sourceWorkspaceId: 'ws-1', filePath: 'a.ts', snippet: '-a\n+b', ref: { type: 'staged' } })!;
        writeDiffSelectionContextDragData(dataTransfer, payload);
        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(JSON.parse(data.get(DIFF_SELECTION_CONTEXT_DRAG_MIME)!)).toEqual(payload);
        expect(data.get('text/plain')).toBe('-a\n+b');
    });
});
