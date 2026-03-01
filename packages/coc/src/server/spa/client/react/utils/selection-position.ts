/**
 * DOM-aware selection-to-source-position mapping.
 *
 * Converts a browser `Range` into 1-based source line/column coordinates
 * by reading `data-line` attributes from the rendered `<div class="md-line">`
 * elements produced by `markdown-renderer.ts`.
 */

export interface SourcePosition {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

/**
 * Walk up from `node` to find the closest ancestor `div.md-line[data-line]`.
 * Returns `null` when the node lives inside a block element (code block, table)
 * that is not wrapped in an `md-line` div.
 */
export function findMdLineAncestor(node: Node): HTMLElement | null {
    let current: Node | null = node;
    while (current) {
        if (
            current instanceof HTMLElement &&
            current.classList.contains('md-line') &&
            current.hasAttribute('data-line')
        ) {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

/**
 * Compute the character offset of `(targetNode, targetOffset)` within the
 * text content of `container` by walking all text nodes in document order.
 */
export function getTextOffsetInContainer(container: Node, targetNode: Node, targetOffset: number): number {
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (walker.currentNode === targetNode) return offset + targetOffset;
        offset += (walker.currentNode.textContent || '').length;
    }
    return offset + targetOffset;
}

/**
 * Map a rendered column offset to a source column by finding the selected
 * rendered text within the raw source line.
 *
 * Returns a 1-based column, or falls back to `clamp(renderedOffset + 1, rawLineLength + 1)`.
 */
export function mapRenderedOffsetToSourceColumn(
    rawLine: string,
    renderedLineText: string,
    renderedOffset: number,
): number {
    if (renderedOffset < 0) return 1;

    // Extract rendered text from the offset to the end — use it to locate in the raw line.
    // Try progressively shorter prefixes of the suffix to handle cases where
    // markdown syntax splits the rendered text (e.g. "bold text" vs "**bold** text").
    const renderedSuffix = renderedLineText.substring(renderedOffset);
    if (renderedSuffix.length > 0) {
        for (let len = renderedSuffix.length; len > 0; len--) {
            const probe = renderedSuffix.substring(0, len);
            const idx = rawLine.indexOf(probe);
            if (idx >= 0) return idx + 1;
        }
    }

    // Try matching the prefix before the offset
    if (renderedOffset > 0) {
        const renderedPrefix = renderedLineText.substring(0, renderedOffset);
        if (renderedPrefix.length > 0) {
            const idx = rawLine.indexOf(renderedPrefix);
            if (idx >= 0) return idx + renderedPrefix.length + 1;
        }
    }

    // Offset 0 with no suffix match: start of line
    if (renderedOffset === 0) return 1;

    // Fallback: clamp to raw line bounds
    return Math.min(renderedOffset + 1, rawLine.length + 1);
}

/**
 * Convert a DOM `Range` into source-accurate 1-based line/column positions
 * by reading `data-line` attributes from ancestor `div.md-line` elements.
 *
 * Returns `null` when the selection lives inside a block element (code block,
 * table, mermaid) that has no `md-line` ancestor — callers should degrade
 * gracefully.
 */
export function selectionToSourcePosition(
    rawContent: string,
    _previewRoot: HTMLElement,
    range: Range,
): SourcePosition | null {
    const startMdLine = findMdLineAncestor(range.startContainer);
    const endMdLine = findMdLineAncestor(range.endContainer);

    if (!startMdLine || !endMdLine) {
        // Selection overlaps a block element without md-line wrapping
        return null;
    }

    const startLine = parseInt(startMdLine.getAttribute('data-line')!, 10);
    const endLine = parseInt(endMdLine.getAttribute('data-line')!, 10);

    if (isNaN(startLine) || isNaN(endLine)) return null;

    const rawLines = rawContent.split('\n');
    const rawStartLine = rawLines[startLine - 1] ?? '';
    const rawEndLine = rawLines[endLine - 1] ?? '';

    // Rendered character offsets within their respective md-line divs
    const renderedStartOffset = getTextOffsetInContainer(startMdLine, range.startContainer, range.startOffset);
    const renderedEndOffset = getTextOffsetInContainer(endMdLine, range.endContainer, range.endOffset);

    const startRenderedText = startMdLine.textContent || '';
    const endRenderedText = endMdLine.textContent || '';

    let startColumn: number;
    let endColumn: number;

    if (startLine === endLine) {
        // Single-line: find the selected rendered text within the raw line
        const selectedRendered = startRenderedText.substring(renderedStartOffset, renderedEndOffset);
        const rawIdx = selectedRendered.length > 0 ? rawStartLine.indexOf(selectedRendered) : -1;

        if (rawIdx >= 0) {
            startColumn = rawIdx + 1;
            endColumn = rawIdx + selectedRendered.length + 1;
        } else {
            // Fallback: map each offset independently
            startColumn = mapRenderedOffsetToSourceColumn(rawStartLine, startRenderedText, renderedStartOffset);
            endColumn = mapRenderedOffsetToSourceColumn(rawEndLine, endRenderedText, renderedEndOffset);
        }
    } else {
        // Multi-line: map start and end columns independently
        startColumn = mapRenderedOffsetToSourceColumn(rawStartLine, startRenderedText, renderedStartOffset);
        endColumn = mapRenderedOffsetToSourceColumn(rawEndLine, endRenderedText, renderedEndOffset);
    }

    return { startLine, startColumn, endLine, endColumn };
}
