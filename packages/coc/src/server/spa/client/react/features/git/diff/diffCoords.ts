/**
 * Pure conversions between the persisted diff-comment coordinates
 * (`DiffCommentSelection`) and Monaco diff-editor ranges (AC-02).
 *
 * Nothing here imports Monaco at runtime — only structural types — so the
 * layer is testable without a real editor and without the Monaco bundle.
 *
 * The two coordinate systems differ in these ways, each easy to get wrong:
 *
 *   - Persisted file lines (`oldLine*` / `newLine*`) are already one-based, the
 *     same as Monaco line numbers. Persisted columns are zero-based offsets;
 *     Monaco columns are one-based. Both count UTF-16 code units (a JS string
 *     index), so the conversion is a pure +1 and stays correct for astral-plane
 *     characters. Never count code points here.
 *   - `diffLineStart` / `diffLineEnd` index the classic viewer's rendered patch
 *     and mean nothing to Monaco. They are only produced (via an optional
 *     resolver) so the classic viewer can still place comments made in Monaco.
 *   - A `context` line exists on both sides. It is always placed on the
 *     modified editor, and a modified-editor range on an unchanged line always
 *     converts back to `context`, so round-tripping never flips the side.
 *   - Classic selections store `NaN`/`null`/`0` for a side that has no line
 *     (e.g. `oldLineStart` on an added line); all of those mean "missing".
 */

import type { DiffComment, DiffCommentSelection } from '../../../../comments/diff-comment-types';
import type { MonacoRange } from '../../language-servers/monacoBridge';
import type { DiffLine } from './UnifiedDiffViewer';
import { relocateDiffAnchor } from '../../../utils/relocateDiffAnchor';

/** Which editor of a Monaco diff editor a range lives in. */
export type DiffEditorSide = 'original' | 'modified';

/** A Monaco range tagged with the diff-editor side it belongs to. */
export interface DiffSideRange extends MonacoRange {
    side: DiffEditorSide;
}

/**
 * The slice of Monaco's `ITextModel` this module reads. A real model satisfies
 * it structurally; tests use `createLineSource`.
 */
export interface DiffLineSource {
    getLineCount(): number;
    getLineContent(lineNumber: number): string;
}

/**
 * Monaco's `ILineChange`, structurally typed. An `*EndLineNumber` of 0 means
 * that side has no lines in the change (a pure insertion or deletion), and the
 * matching start number is the line *after which* the change sits.
 */
export interface DiffLineChange {
    originalStartLineNumber: number;
    originalEndLineNumber: number;
    modifiedStartLineNumber: number;
    modifiedEndLineNumber: number;
}

/**
 * Outcome of placing a persisted selection in Monaco. AC-05 renders the three
 * statuses differently, so they are never collapsed:
 *   - `exact`: placed from the stored file-line coordinates.
 *   - `recovered`: file lines were missing (legacy comment); placed by the
 *     anchor fingerprint.
 *   - `unresolved`: neither worked; the comment is orphaned.
 * `clamped` is true when the stored position pointed past the current text.
 */
export type SelectionPlacement =
    | { status: 'exact'; range: DiffSideRange; clamped: boolean }
    | { status: 'recovered'; range: DiffSideRange; clamped: boolean }
    | { status: 'unresolved'; side: DiffEditorSide };

export interface SelectionToMonacoOptions {
    /** Current text of each side; enables clamping and fingerprint recovery. */
    original?: DiffLineSource;
    modified?: DiffLineSource;
    /** Fingerprint used when the selection has no usable file lines. */
    anchor?: DiffComment['anchor'];
}

export interface MonacoToSelectionContext {
    /** The diff editor's current line changes (`getLineChanges()`). */
    lineChanges: readonly DiffLineChange[];
    /**
     * Maps a file line to the classic viewer's patch index. When absent or
     * unresolved, `diffLineStart`/`diffLineEnd` are -1 ("not in the patch").
     */
    diffLineIndexOf?: (kind: 'old' | 'new', line: number) => number | undefined;
}

/** Splits text the way Monaco does: `\r\n`, `\r` and `\n` all end a line. */
export function createLineSource(text: string): DiffLineSource {
    const lines = text.split(/\r\n|\r|\n/);
    return {
        getLineCount: () => lines.length,
        getLineContent: (lineNumber) => lines[lineNumber - 1] ?? '',
    };
}

/** Editor side a persisted selection is shown on. `context` → modified. */
export function sideForSelection(selection: Pick<DiffCommentSelection, 'side'>): DiffEditorSide {
    return selection.side === 'removed' ? 'original' : 'modified';
}

function fileLine(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : undefined;
}

function column(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value + 1 : 1;
}

/** Clamps a range into `source`; returns whether anything moved. */
function clampRange(range: DiffSideRange, source: DiffLineSource | undefined): { range: DiffSideRange; clamped: boolean } {
    if (!source) {return { range, clamped: false };}
    const lineCount = Math.max(1, source.getLineCount());
    const maxColumn = (line: number) => source.getLineContent(line).length + 1;
    const startLineNumber = Math.min(range.startLineNumber, lineCount);
    const endLineNumber = Math.min(Math.max(range.endLineNumber, startLineNumber), lineCount);
    const startColumn = Math.min(range.startColumn, maxColumn(startLineNumber));
    let endColumn = Math.min(range.endColumn, maxColumn(endLineNumber));
    if (startLineNumber === endLineNumber && endColumn < startColumn) {endColumn = startColumn;}
    const clamped = startLineNumber !== range.startLineNumber
        || endLineNumber !== range.endLineNumber
        || startColumn !== range.startColumn
        || endColumn !== range.endColumn;
    return { range: { side: range.side, startLineNumber, startColumn, endLineNumber, endColumn }, clamped };
}

function recoverByFingerprint(
    selection: DiffCommentSelection,
    side: DiffEditorSide,
    anchor: NonNullable<DiffComment['anchor']>,
    source: DiffLineSource,
): DiffSideRange | undefined {
    const lines: DiffLine[] = [];
    for (let n = 1; n <= source.getLineCount(); n++) {
        const content = source.getLineContent(n);
        lines.push(side === 'original'
            ? { index: n - 1, type: 'context', content, oldLine: n }
            : { index: n - 1, type: 'context', content, newLine: n });
    }
    const index = relocateDiffAnchor({ anchor, selection }, lines);
    if (index === null || index < 0 || index >= lines.length) {return undefined;}
    const startLineNumber = index + 1;
    const span = Math.max(0, (selection.diffLineEnd ?? selection.diffLineStart) - selection.diffLineStart);
    const endLineNumber = Math.min(startLineNumber + span, lines.length);
    const text = anchor.selectedText;
    const at = text && !/[\r\n]/.test(text) ? lines[index].content.indexOf(text) : -1;
    if (at >= 0 && endLineNumber === startLineNumber) {
        return { side, startLineNumber, startColumn: at + 1, endLineNumber, endColumn: at + 1 + text.length };
    }
    return { side, startLineNumber, startColumn: 1, endLineNumber, endColumn: lines[endLineNumber - 1].content.length + 1 };
}

/**
 * Places a persisted selection in a Monaco diff editor. Uses the stored file
 * lines when present; otherwise falls back to the anchor fingerprint. Never
 * throws: out-of-range positions clamp and report `clamped`.
 */
export function selectionToMonaco(
    selection: DiffCommentSelection,
    options: SelectionToMonacoOptions = {},
): SelectionPlacement {
    const side = sideForSelection(selection);
    const source = side === 'original' ? options.original : options.modified;
    const start = side === 'original' ? fileLine(selection.oldLineStart) : fileLine(selection.newLineStart);
    const end = side === 'original' ? fileLine(selection.oldLineEnd) : fileLine(selection.newLineEnd);

    if (start === undefined && end === undefined) {
        if (!options.anchor || !source) {return { status: 'unresolved', side };}
        const recovered = recoverByFingerprint(selection, side, options.anchor, source);
        if (!recovered) {return { status: 'unresolved', side };}
        return { status: 'recovered', ...clampRange(recovered, source) };
    }

    const startLineNumber = start ?? end!;
    const endLineNumber = end ?? startLineNumber;
    const startColumn = column(selection.startColumn);
    // When the end line is unknown the stored end offset belongs to another
    // line, so the range runs to the end of the start line instead.
    const endColumn = end === undefined && start !== undefined
        ? (source ? source.getLineContent(startLineNumber).length + 1 : startColumn)
        : column(selection.endColumn);
    const ordered = endLineNumber < startLineNumber
        ? { startLineNumber: endLineNumber, startColumn: endColumn, endLineNumber: startLineNumber, endColumn: startColumn }
        : { startLineNumber, startColumn, endLineNumber, endColumn };
    return { status: 'exact', ...clampRange({ side, ...ordered }, source) };
}

/** Whether `line` on `side` is inside a change (added/removed) or unchanged. */
export function isChangedLine(side: DiffEditorSide, line: number, lineChanges: readonly DiffLineChange[]): boolean {
    return lineChanges.some((change) => {
        const startLine = side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
        const endLine = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
        return endLine > 0 && line >= startLine && line <= endLine;
    });
}

/**
 * The line on the other side that shows the same unchanged text, or
 * `undefined` when `line` is part of a change and has no counterpart.
 */
export function counterpartLine(side: DiffEditorSide, line: number, lineChanges: readonly DiffLineChange[]): number | undefined {
    if (isChangedLine(side, line, lineChanges)) {return undefined;}
    let delta = 0;
    for (const change of lineChanges) {
        const originalCount = change.originalEndLineNumber > 0
            ? change.originalEndLineNumber - change.originalStartLineNumber + 1 : 0;
        const modifiedCount = change.modifiedEndLineNumber > 0
            ? change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1 : 0;
        const ownEnd = side === 'original'
            ? (originalCount > 0 ? change.originalEndLineNumber : change.originalStartLineNumber)
            : (modifiedCount > 0 ? change.modifiedEndLineNumber : change.modifiedStartLineNumber);
        if (ownEnd >= line) {continue;}
        delta += side === 'original' ? modifiedCount - originalCount : originalCount - modifiedCount;
    }
    const mapped = line + delta;
    return mapped >= 1 ? mapped : undefined;
}

/**
 * Converts a range selected in a Monaco diff editor into the persisted
 * selection shape. The side comes from the range's start line: a changed line
 * is `removed`/`added`, an unchanged one is `context`.
 */
export function monacoToSelection(
    side: DiffEditorSide,
    range: MonacoRange,
    context: MonacoToSelectionContext,
): DiffCommentSelection {
    const { lineChanges } = context;
    const changed = isChangedLine(side, range.startLineNumber, lineChanges);
    const kind: DiffCommentSelection['side'] = !changed ? 'context' : side === 'original' ? 'removed' : 'added';
    const other = (line: number) => counterpartLine(side, line, lineChanges);
    const own = { start: range.startLineNumber, end: range.endLineNumber };
    const lines = side === 'original'
        ? { oldLineStart: own.start, oldLineEnd: own.end, newLineStart: other(own.start), newLineEnd: other(own.end) }
        : { oldLineStart: other(own.start), oldLineEnd: other(own.end), newLineStart: own.start, newLineEnd: own.end };
    const indexKind = side === 'original' ? 'old' : 'new';
    const diffLineStart = context.diffLineIndexOf?.(indexKind, own.start) ?? -1;
    const diffLineEnd = context.diffLineIndexOf?.(indexKind, own.end) ?? diffLineStart;
    return {
        diffLineStart,
        diffLineEnd,
        side: kind,
        ...lines,
        startColumn: range.startColumn - 1,
        endColumn: range.endColumn - 1,
    };
}

/**
 * Builds a `diffLineIndexOf` resolver over the classic viewer's rendered
 * patch so comments made in Monaco still land on the right classic row.
 */
export function createDiffLineIndexResolver(lines: readonly DiffLine[]): NonNullable<MonacoToSelectionContext['diffLineIndexOf']> {
    const oldIndex = new Map<number, number>();
    const newIndex = new Map<number, number>();
    for (const line of lines) {
        if (line.type !== 'added' && line.type !== 'removed' && line.type !== 'context') {continue;}
        if (line.oldLine !== undefined && !oldIndex.has(line.oldLine)) {oldIndex.set(line.oldLine, line.index);}
        if (line.newLine !== undefined && !newIndex.has(line.newLine)) {newIndex.set(line.newLine, line.index);}
    }
    return (kind, line) => (kind === 'old' ? oldIndex : newIndex).get(line);
}

/** Where an inline comment thread (view zone) sits in the diff editor. */
export interface ThreadZoneAnchor {
    side: DiffEditorSide;
    /** The zone renders below this line (Monaco `afterLineNumber`). */
    afterLineNumber: number;
}

/**
 * Line a comment thread renders below. In split view a thread sits under the
 * last line of its range on its own side. In unified view Monaco shows only
 * the modified editor (removed lines are drawn inside it but are not
 * addressable), so a thread on the original side moves to the modified
 * editor: below its unchanged counterpart, or below the change block that
 * replaced the removed lines (line 0 = above the first line).
 */
export function threadZoneAnchor(
    range: DiffSideRange,
    viewMode: 'unified' | 'split',
    lineChanges: readonly DiffLineChange[],
): ThreadZoneAnchor {
    if (range.side === 'modified' || viewMode === 'split') {
        return { side: range.side, afterLineNumber: range.endLineNumber };
    }
    const line = range.endLineNumber;
    const counterpart = counterpartLine('original', line, lineChanges);
    if (counterpart !== undefined) {return { side: 'modified', afterLineNumber: counterpart };}
    const change = lineChanges.find(c => c.originalEndLineNumber > 0
        && line >= c.originalStartLineNumber && line <= c.originalEndLineNumber);
    const afterLineNumber = !change ? 0
        : change.modifiedEndLineNumber > 0 ? change.modifiedEndLineNumber
            : change.modifiedStartLineNumber;
    return { side: 'modified', afterLineNumber };
}

/** Text covered by a Monaco range, lines joined with `\n`. */
export function textInRange(source: DiffLineSource, range: MonacoRange): string {
    const lines: string[] = [];
    for (let n = range.startLineNumber; n <= range.endLineNumber; n++) {
        const content = source.getLineContent(n);
        const from = n === range.startLineNumber ? range.startColumn - 1 : 0;
        const to = n === range.endLineNumber ? range.endColumn - 1 : content.length;
        lines.push(content.slice(from, to));
    }
    return lines.join('\n');
}
