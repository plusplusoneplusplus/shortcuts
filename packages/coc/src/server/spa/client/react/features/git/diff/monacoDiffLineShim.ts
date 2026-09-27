/**
 * TEMPORARY COMPATIBILITY SHIM — synthesizes the classic viewer's `DiffLine[]`
 * from Monaco's line changes so `onLinesReady` consumers (`useDiffComments`'
 * relocation, comment row indices) keep working with `MonacoFileDiffViewer`.
 *
 * Exists only until the last diff surface stops consuming `DiffLine[]`; delete
 * it together with the `onLinesReady` prop at that point. Do not build new
 * features on it.
 *
 * Output mirrors a single-file unified patch body: one `hunk-header` row per
 * hunk followed by `context` / `removed` / `added` rows whose `content` keeps
 * the one-character `' '`/`'-'`/`'+'` prefix, like `UnifiedDiffViewer`.
 * Line changes closer than twice the context size merge into one hunk, as in
 * `git diff`.
 */

import type { DiffLine } from './UnifiedDiffViewer';
import { createLineSource, type DiffLineChange } from './diffCoords';

const DEFAULT_CONTEXT = 3;

interface ChangeSpan {
    /** 1-based, inclusive; `end < start` for an empty side. */
    oStart: number;
    oEnd: number;
    mStart: number;
    mEnd: number;
}

/** Monaco encodes an empty side as end 0 with start = line above. */
function toSpan(change: DiffLineChange): ChangeSpan {
    const oEmpty = change.originalEndLineNumber === 0;
    const mEmpty = change.modifiedEndLineNumber === 0;
    return {
        oStart: oEmpty ? change.originalStartLineNumber + 1 : change.originalStartLineNumber,
        oEnd: oEmpty ? change.originalStartLineNumber : change.originalEndLineNumber,
        mStart: mEmpty ? change.modifiedStartLineNumber + 1 : change.modifiedStartLineNumber,
        mEnd: mEmpty ? change.modifiedStartLineNumber : change.modifiedEndLineNumber,
    };
}

/**
 * Lines as `git diff` counts them: the empty string after a final newline is
 * not a line, unless Monaco reports a change on it (trailing-newline edits).
 */
function patchLineCount(text: string, monacoCount: number, referenced: number): number {
    if (text.length === 0) return 0;
    const count = /(\r\n|\r|\n)$/.test(text) ? monacoCount - 1 : monacoCount;
    return Math.max(count, referenced);
}

/** `git diff` range syntax: `start,len`, `start` alone for one line, `start-1,0` when empty. */
function hunkRange(start: number, length: number): string {
    if (length === 0) return `${start - 1},0`;
    return length === 1 ? `${start}` : `${start},${length}`;
}

export function synthesizeDiffLines(
    original: string,
    modified: string,
    lineChanges: readonly DiffLineChange[],
    context = DEFAULT_CONTEXT,
): DiffLine[] {
    const oSrc = createLineSource(original);
    const mSrc = createLineSource(modified);
    const spans = lineChanges.map(toSpan);
    const oCount = patchLineCount(original, oSrc.getLineCount(), spans.reduce((max, s) => Math.max(max, s.oEnd), 0));
    const mCount = patchLineCount(modified, mSrc.getLineCount(), spans.reduce((max, s) => Math.max(max, s.mEnd), 0));

    // Group spans whose context windows touch.
    const groups: ChangeSpan[][] = [];
    for (const span of spans) {
        const last = groups[groups.length - 1];
        const prev = last?.[last.length - 1];
        if (prev && span.oStart - prev.oEnd - 1 <= context * 2) last.push(span);
        else groups.push([span]);
    }

    const lines: DiffLine[] = [];
    const push = (line: Omit<DiffLine, 'index'>) => lines.push({ index: lines.length, ...line });

    for (const group of groups) {
        const first = group[0];
        const last = group[group.length - 1];
        // Context before, in original coordinates; the offset between the
        // sides is constant across unchanged lines.
        const oFrom = Math.max(1, first.oStart - context);
        const shift = first.mStart - first.oStart;
        const oTo = Math.min(oCount, last.oEnd + context);
        const tailShift = last.mEnd - last.oEnd;
        const mFrom = oFrom + shift;
        const mTo = oTo + tailShift;
        const oLen = Math.max(0, oTo - oFrom + 1);
        const mLen = Math.max(0, mTo - mFrom + 1);
        push({ type: 'hunk-header', content: `@@ -${hunkRange(oFrom, oLen)} +${hunkRange(mFrom, mLen)} @@` });

        let o = oFrom;
        let m = mFrom;
        for (const span of group) {
            for (; o < span.oStart; o++, m++) {
                push({ type: 'context', oldLine: o, newLine: m, content: ` ${mSrc.getLineContent(m)}` });
            }
            for (; o <= span.oEnd; o++) {
                push({ type: 'removed', oldLine: o, content: `-${oSrc.getLineContent(o)}` });
            }
            for (; m <= span.mEnd; m++) {
                push({ type: 'added', newLine: m, content: `+${mSrc.getLineContent(m)}` });
            }
        }
        for (; o <= oTo && m <= mCount; o++, m++) {
            push({ type: 'context', oldLine: o, newLine: m, content: ` ${mSrc.getLineContent(m)}` });
        }
    }
    return lines;
}
