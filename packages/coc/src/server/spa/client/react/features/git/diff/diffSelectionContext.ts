/**
 * Turns a text selection in a Git diff into a diff-selection context drag
 * payload. Everything is derived from the parsed diff line model (not DOM
 * text) so the `+`/`-`/space markers and line numbers are exact.
 */
import {
    createDiffSelectionContextDragPayload,
    type DiffSelectionContextDragPayload,
    type DiffSelectionLineRange,
    type DiffSelectionRef,
} from '../../chat/sessionContextDrag';
import { extractFilePathFromDiffHeader, type DiffLine } from './UnifiedDiffViewer';

/** In Split view a selection lives on one column; `old` = left, `new` = right. */
export type DiffSelectionSide = 'old' | 'new';

export interface DiffLineSelection {
    /** File path from the `diff --git` header above the selection, or null for header-less single-file diffs. */
    filePath: string | null;
    snippet: string;
    oldRange?: DiffSelectionLineRange;
    newRange?: DiffSelectionLineRange;
}

function isFileHeader(line: DiffLine): boolean {
    return line.type === 'meta' && line.content.startsWith('diff --git');
}

function isCodeLine(line: DiffLine): boolean {
    if (line.type !== 'added' && line.type !== 'removed' && line.type !== 'context') return false;
    // `\ No newline at end of file` is classified as context but is not a real line.
    return !line.content.startsWith('\\');
}

function onSide(line: DiffLine, side: DiffSelectionSide | undefined): boolean {
    if (!side) return true;
    return side === 'old' ? line.type !== 'added' : line.type !== 'removed';
}

function extendRange(range: DiffSelectionLineRange | undefined, lineNumber: number | undefined): DiffSelectionLineRange | undefined {
    if (lineNumber === undefined) return range;
    if (!range) return { start: lineNumber, end: lineNumber };
    return { start: Math.min(range.start, lineNumber), end: Math.max(range.end, lineNumber) };
}

/**
 * Collect the diff lines between two line indices (inclusive, either order).
 * The selection is clamped to the file where it started: it stops at the next
 * `diff --git` header. With `side`, only that column's lines and range count.
 * Returns null when no code line is covered.
 */
export function buildDiffLineSelection(
    diffLines: readonly DiffLine[],
    startIndex: number,
    endIndex: number,
    side?: DiffSelectionSide,
): DiffLineSelection | null {
    if (diffLines.length === 0) return null;
    const clamp = (value: number) => Math.min(Math.max(value, 0), diffLines.length - 1);
    const from = clamp(Math.min(startIndex, endIndex));
    const to = clamp(Math.max(startIndex, endIndex));

    let filePath: string | null = null;
    for (let i = from; i >= 0; i--) {
        if (isFileHeader(diffLines[i])) {
            filePath = extractFilePathFromDiffHeader(diffLines[i].content);
            break;
        }
    }

    const selected: string[] = [];
    let oldRange: DiffSelectionLineRange | undefined;
    let newRange: DiffSelectionLineRange | undefined;
    for (let i = from; i <= to; i++) {
        const line = diffLines[i];
        if (i > from && isFileHeader(line)) break;
        if (!isCodeLine(line) || !onSide(line, side)) continue;
        selected.push(line.content);
        if (side !== 'new') oldRange = extendRange(oldRange, line.oldLine);
        if (side !== 'old') newRange = extendRange(newRange, line.newLine);
    }
    if (selected.length === 0) return null;

    return {
        filePath,
        snippet: selected.join('\n'),
        ...(oldRange ? { oldRange } : {}),
        ...(newRange ? { newRange } : {}),
    };
}

export interface CreateDiffSelectionDragPayloadOptions {
    diffLines: readonly DiffLine[];
    startIndex: number;
    endIndex: number;
    side?: DiffSelectionSide;
    workspaceId: string | null | undefined;
    ref: DiffSelectionRef | null | undefined;
    /** Used when the diff has no `diff --git` header (single-file views). */
    fallbackFilePath?: string | null;
}

export function createDiffSelectionDragPayloadFromLines(
    options: CreateDiffSelectionDragPayloadOptions,
): DiffSelectionContextDragPayload | null {
    const selection = buildDiffLineSelection(options.diffLines, options.startIndex, options.endIndex, options.side);
    if (!selection) return null;
    return createDiffSelectionContextDragPayload({
        sourceWorkspaceId: options.workspaceId,
        filePath: selection.filePath ?? options.fallbackFilePath ?? undefined,
        oldRange: selection.oldRange,
        newRange: selection.newRange,
        ref: options.ref,
        snippet: selection.snippet,
    });
}
