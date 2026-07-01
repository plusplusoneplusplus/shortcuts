import {
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/forge/editor/anchor';
import { selectionToSourcePosition } from '../../utils/selection-position';

export interface MarkdownReviewSelection {
    text: string;
    range: Range;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export function buildMarkdownCommentAnchor(
    rawContent: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
) {
    try {
        return createAnchorData(rawContent, startLine, endLine, startColumn, endColumn, DEFAULT_ANCHOR_MATCH_CONFIG);
    } catch {
        return undefined;
    }
}

/**
 * Resolve a rendered markdown selection back to source coordinates.
 *
 * The primary path uses renderer-provided data-line metadata. The fallback is
 * intentionally text-offset based so review hosts can still create comments in
 * code blocks, tables, or other rendered blocks without line attributes.
 */
export function resolveMarkdownReviewSelection(
    rawContent: string,
    previewEl: HTMLElement,
    range: Range,
    text: string,
): MarkdownReviewSelection | null {
    const sourcePos = selectionToSourcePosition(rawContent, previewEl, range);
    if (sourcePos) {
        return { text, range: range.cloneRange(), ...sourcePos };
    }

    const previewText = previewEl.textContent || '';
    const startOffset = getTextOffset(previewEl, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(previewEl, range.endContainer, range.endOffset);
    const startPos = offsetToPosition(previewText, startOffset);
    const endPos = offsetToPosition(previewText, endOffset);
    return {
        text,
        range: range.cloneRange(),
        startLine: startPos.line,
        startColumn: startPos.column,
        endLine: endPos.line,
        endColumn: endPos.column,
    };
}

function getTextOffset(container: Node, targetNode: Node, targetOffset: number): number {
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (walker.currentNode === targetNode) return offset + targetOffset;
        offset += (walker.currentNode.textContent || '').length;
    }
    return offset + targetOffset;
}

function offsetToPosition(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const before = text.substring(0, clamped);
    const lines = before.split('\n');
    return { line: lines.length, column: (lines[lines.length - 1]?.length || 0) + 1 };
}
