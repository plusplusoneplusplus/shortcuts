/**
 * Turns a text selection in a Git diff into a diff-selection context drag
 * payload. Everything is derived from the parsed diff line model (not DOM
 * text) so the `+`/`-`/space markers and line numbers are exact.
 */
import {
    createDiffSelectionContextDragPayload,
    writeDiffSelectionContextDragData,
    type DiffSelectionContextDragPayload,
    type DiffSelectionLineRange,
    type DiffSelectionRef,
} from '../../chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
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

/** Where a diff viewer's content comes from; enables dragging a selection into chat. */
export interface DiffSelectionDragSource {
    workspaceId: string;
    ref: DiffSelectionRef;
    /** Path used when the diff has no `diff --git` header (single-file views). */
    filePath?: string;
}

/** Walk up from `node` (stopping at `boundary`) to the nearest diff row element. */
function findDiffLineElement(node: Node | null, boundary: Element): Element | null {
    let current: Node | null = node;
    while (current && current !== boundary) {
        if (current.nodeType === 1 && (current as Element).hasAttribute('data-diff-line-index')) {
            return current as Element;
        }
        current = current.parentNode;
    }
    return null;
}

function lineIndexOf(el: Element): number {
    const value = Number.parseInt(el.getAttribute('data-diff-line-index') ?? '', 10);
    return Number.isInteger(value) && value >= 0 ? value : -1;
}

/**
 * Build a drag payload from the browser selection inside a rendered diff.
 * Rows are located via `data-diff-line-index`; in Split view the column the
 * selection starts in (`data-split-side`) picks the side. Returns null when
 * the selection is empty, outside `container`, or covers no code line.
 */
export function createDiffSelectionDragPayloadFromDomSelection(options: {
    selection: Selection | null;
    container: Element;
    diffLines: readonly DiffLine[];
    source: DiffSelectionDragSource;
    splitView?: boolean;
}): DiffSelectionContextDragPayload | null {
    const { selection, container, diffLines, source, splitView } = options;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const startEl = findDiffLineElement(range.startContainer, container);
    if (!startEl) return null;
    const endEl = findDiffLineElement(range.endContainer, container) ?? startEl;
    const startIndex = lineIndexOf(startEl);
    const endIndex = lineIndexOf(endEl);
    if (startIndex < 0 || endIndex < 0) return null;

    let side: DiffSelectionSide | undefined;
    if (splitView) {
        const column = startEl.closest('[data-split-side]')?.getAttribute('data-split-side');
        side = column === 'left' ? 'old' : column === 'right' ? 'new' : undefined;
    }
    return createDiffSelectionDragPayloadFromLines({
        diffLines,
        startIndex,
        endIndex,
        side,
        workspaceId: source.workspaceId,
        ref: source.ref,
        fallbackFilePath: source.filePath,
    });
}

/**
 * `dragstart` handler body shared by the Unified and Split diff viewers. It
 * only adds CoC data to the browser's native text drag, so selection, copy,
 * find, and the comment menu keep working. No-op when the feature is off or
 * the selection does not map to diff lines.
 */
export function writeDiffSelectionDragStart(
    event: { dataTransfer: DataTransfer | null },
    options: {
        container: Element | null;
        diffLines: readonly DiffLine[];
        source: DiffSelectionDragSource | undefined;
        splitView?: boolean;
    },
): boolean {
    if (!options.source || !options.container || !event.dataTransfer) return false;
    if (!isSessionContextAttachmentsEnabled()) return false;
    const payload = createDiffSelectionDragPayloadFromDomSelection({
        selection: typeof window !== 'undefined' ? window.getSelection() : null,
        container: options.container,
        diffLines: options.diffLines,
        source: options.source,
        splitView: options.splitView,
    });
    if (!payload) return false;
    writeDiffSelectionContextDragData(event.dataTransfer, payload);
    return true;
}

/** Add CoC context data to a Monaco selection drag handle. */
export function writeMonacoDiffSelectionDragStart(
    event: { dataTransfer: DataTransfer | null },
    options: {
        selection: {
            oldLineStart?: number;
            oldLineEnd?: number;
            newLineStart?: number;
            newLineEnd?: number;
        };
        selectedText: string;
        source: DiffSelectionDragSource | undefined;
    },
): boolean {
    const { source, selection, selectedText } = options;
    if (!source || !event.dataTransfer || !selectedText || !isSessionContextAttachmentsEnabled()) return false;
    const payload = createMonacoDiffSelectionDragPayload(selection, selectedText, source);
    if (!payload) return false;
    writeDiffSelectionContextDragData(event.dataTransfer, payload);
    return true;
}

/** Build chat context directly from Monaco's persisted selection coordinates. */
export function createMonacoDiffSelectionDragPayload(
    selection: {
        oldLineStart?: number;
        oldLineEnd?: number;
        newLineStart?: number;
        newLineEnd?: number;
    },
    selectedText: string,
    source: DiffSelectionDragSource,
): DiffSelectionContextDragPayload | null {
    const oldRange = selection.oldLineStart !== undefined && selection.oldLineEnd !== undefined
        ? { start: selection.oldLineStart, end: selection.oldLineEnd }
        : undefined;
    const newRange = selection.newLineStart !== undefined && selection.newLineEnd !== undefined
        ? { start: selection.newLineStart, end: selection.newLineEnd }
        : undefined;
    return createDiffSelectionContextDragPayload({
        sourceWorkspaceId: source.workspaceId,
        filePath: source.filePath,
        oldRange,
        newRange,
        ref: source.ref,
        snippet: selectedText,
    });
}
