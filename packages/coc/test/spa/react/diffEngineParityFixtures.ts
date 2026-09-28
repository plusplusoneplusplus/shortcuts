/**
 * Shared fixtures for Classic ↔ Monaco diff-engine parity (AC-08).
 *
 * Both engines start from the same source texts. The Classic path turns
 * rendered `git diff -U3` rows into the `DiffCommentSelection` its mouse-up
 * handler stores; the Monaco path converts the equivalent editor range through
 * `diffCoords` using `git diff -U0` line changes (Monaco's ILineChange shape).
 * `expectSelectionParity` is the single equality check every positive and
 * negative fixture goes through.
 */

import { expect } from 'vitest';
import { computeDiffLines, type DiffLine } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import {
    createDiffLineIndexResolver,
    createLineSource,
    monacoToSelection,
    selectionToMonaco,
    sideForSelection,
    type DiffLineChange,
    type DiffLineSource,
    type DiffSideRange,
} from '../../../src/server/spa/client/react/features/git/diff/diffCoords';
import type { DiffCommentSelection } from '../../../src/server/spa/client/comments/diff-comment-types';
import type { GitDiffFixture } from './features/git/monaco-diff/gitDiffFixture';

export interface ParityCase {
    name: string;
    original: string;
    modified: string;
    /** Single-line texts unique in the diff, used for legacy-anchor recovery. */
    legacyAnchors?: string[];
}

const BASE_ORIGINAL = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'].join('\n') + '\n';
const BASE_MODIFIED = ['alpha', 'BETA', 'gamma', 'delta', 'epsilon', 'new-1', 'new-2', 'zeta', 'eta', 'iota', 'kappa'].join('\n') + '\n';

export const PARITY_CASES: ParityCase[] = [
    { name: 'added lines', original: 'a\nb\nc\n', modified: 'a\nb\nadded-1\nadded-2\nc\n', legacyAnchors: ['added-2'] },
    { name: 'removed lines', original: 'a\nremoved-1\nremoved-2\nb\nc\n', modified: 'a\nb\nc\n', legacyAnchors: ['removed-1'] },
    { name: 'added, removed and context', original: BASE_ORIGINAL, modified: BASE_MODIFIED, legacyAnchors: ['BETA', 'theta', 'epsilon'] },
    { name: 'CRLF', original: BASE_ORIGINAL.replace(/\n/g, '\r\n'), modified: BASE_MODIFIED.replace(/\n/g, '\r\n'), legacyAnchors: ['new-1', 'theta'] },
    { name: 'trailing newline removed', original: 'one\ntwo\nthree\n', modified: 'one\ntwo\nthree', legacyAnchors: ['two'] },
    { name: 'trailing newline added', original: 'one\ntwo\nthree', modified: 'one\ntwo\nTHREE\n', legacyAnchors: ['THREE'] },
    { name: 'unicode', original: 'a\n😀 smile\nc\nd\n', modified: 'a\n😀 smiles\nc\né café\n', legacyAnchors: ['é café', 'smiles'] },
    { name: 'two hunks', original: [...Array(20)].map((_, i) => `line-${i + 1}`).join('\n') + '\n',
        modified: [...Array(20)].map((_, i) => (i === 1 ? 'first-change' : i === 17 ? 'second-change' : `line-${i + 1}`)).join('\n') + '\n',
        legacyAnchors: ['second-change'] },
];

/** A Classic selection over rendered rows `[start, end]` with DOM text offsets. */
export interface RowSelection {
    start: number;
    end: number;
    startColumn: number;
    endColumn: number;
}

export interface ParityContext {
    original: string;
    modified: string;
    /** All rendered Classic rows (`computeDiffLines` of `git diff -U3`). */
    rows: DiffLine[];
    lineChanges: DiffLineChange[];
    sources: Record<'original' | 'modified', DiffLineSource>;
}

export function buildParityContext(git: GitDiffFixture, testCase: Pick<ParityCase, 'original' | 'modified'>): ParityContext {
    return {
        original: testCase.original,
        modified: testCase.modified,
        rows: computeDiffLines(git.gitDiff(testCase.original, testCase.modified, 3)),
        lineChanges: git.lineChangesFromGit(testCase.original, testCase.modified),
        sources: { original: createLineSource(testCase.original), modified: createLineSource(testCase.modified) },
    };
}

function isSourceRow(row: DiffLine): boolean {
    return (row.type === 'added' || row.type === 'removed' || row.type === 'context')
        && (row.oldLine !== undefined || row.newLine !== undefined);
}

/**
 * Mirrors `UnifiedDiffViewer`'s mouse-up handler: side from the first row,
 * line numbers from the first/last rows' `data-*-line` attributes (an absent
 * number renders as `''` and parses to NaN), columns from the DOM offsets.
 */
export function classicSelection(rows: readonly DiffLine[], selection: RowSelection): DiffCommentSelection {
    const first = rows[selection.start];
    const last = rows[selection.end];
    const attr = (value: number | undefined) => parseInt(value === undefined ? '' : String(value), 10);
    return {
        diffLineStart: selection.start,
        diffLineEnd: selection.end,
        side: first.type as DiffCommentSelection['side'],
        oldLineStart: attr(first.oldLine),
        oldLineEnd: attr(last.oldLine),
        newLineStart: attr(first.newLine),
        newLineEnd: attr(last.newLine),
        startColumn: selection.startColumn,
        endColumn: selection.endColumn,
    };
}

/**
 * The Monaco range a user selects for the same rows: on the editor the Classic
 * side maps to, spanning the rows' lines on that side. `null` when some row
 * has no line on that side (Monaco cannot select it in one editor).
 */
export function equivalentMonacoRange(rows: readonly DiffLine[], selection: RowSelection): DiffSideRange | null {
    const side = sideForSelection({ side: rows[selection.start].type as DiffCommentSelection['side'] });
    const lineOf = (row: DiffLine) => (side === 'original' ? row.oldLine : row.newLine);
    const span = rows.slice(selection.start, selection.end + 1);
    if (span.some(row => !isSourceRow(row) || lineOf(row) === undefined)) {return null;}
    return {
        side,
        startLineNumber: lineOf(span[0])!,
        startColumn: selection.startColumn + 1,
        endLineNumber: lineOf(span[span.length - 1])!,
        endColumn: selection.endColumn + 1,
    };
}

/**
 * Every single-row and multi-row (2–3 rows, one hunk) selection that has a
 * Monaco equivalent, with columns taken from the side's real line text:
 * whole-line and from column 2 (past a surrogate pair on the unicode case).
 */
export function enumerateRowSelections(context: ParityContext): RowSelection[] {
    const { rows, sources } = context;
    const out: RowSelection[] = [];
    for (let start = 0; start < rows.length; start++) {
        if (!isSourceRow(rows[start])) {continue;}
        for (let end = start; end < Math.min(rows.length, start + 3); end++) {
            const probe = equivalentMonacoRange(rows, { start, end, startColumn: 0, endColumn: 0 });
            if (!probe) {break;}
            const source = sources[probe.side];
            const startLength = source.getLineContent(probe.startLineNumber).length;
            const endLength = source.getLineContent(probe.endLineNumber).length;
            out.push({ start, end, startColumn: 0, endColumn: endLength });
            if (startLength > 2) {out.push({ start, end, startColumn: 2, endColumn: endLength });}
        }
    }
    return out;
}

/** Persisted file-line fields with every "missing line" spelling as `null`. */
export function persistedFields(selection: DiffCommentSelection) {
    const line = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : null);
    return {
        diffLineStart: selection.diffLineStart,
        diffLineEnd: selection.diffLineEnd,
        side: selection.side,
        oldLineStart: line(selection.oldLineStart),
        oldLineEnd: line(selection.oldLineEnd),
        newLineStart: line(selection.newLineStart),
        newLineEnd: line(selection.newLineEnd),
        startColumn: selection.startColumn,
        endColumn: selection.endColumn,
    };
}

export interface ParityOptions {
    /** Line changes the Monaco path uses (defaults to the context's). */
    lineChanges?: readonly DiffLineChange[];
    /** Lets a negative fixture perturb the Monaco range before conversion. */
    mapRange?: (range: DiffSideRange) => DiffSideRange;
}

/**
 * The parity assertion: the Classic selection and the Monaco selection for
 * the same rows persist identical fields, and the Classic selection places
 * back on the same Monaco range.
 */
export function expectSelectionParity(context: ParityContext, selection: RowSelection, options: ParityOptions = {}): void {
    const label = `rows ${selection.start}-${selection.end} cols ${selection.startColumn}-${selection.endColumn}`;
    const classic = classicSelection(context.rows, selection);
    const baseRange = equivalentMonacoRange(context.rows, selection);
    expect(baseRange, label).not.toBeNull();
    const range = options.mapRange ? options.mapRange(baseRange!) : baseRange!;
    const monaco = monacoToSelection(range.side, range, {
        lineChanges: options.lineChanges ?? context.lineChanges,
        diffLineIndexOf: createDiffLineIndexResolver(context.rows),
    });
    expect(persistedFields(monaco), label).toEqual(persistedFields(classic));

    const placed = selectionToMonaco(classic, context.sources);
    expect(placed.status, label).toBe('exact');
    expect(placed.status === 'unresolved' ? null : placed.range, label).toEqual(range);
}
