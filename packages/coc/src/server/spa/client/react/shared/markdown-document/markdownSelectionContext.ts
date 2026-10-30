import { strippedFrontmatterLineCount } from '../../../diff/markdown-renderer';

/**
 * Raw-file line range (1-based, inclusive) a selection in a rendered Markdown
 * preview covers, or null when the range is not inside `root`.
 *
 * The renderer emits one top-level `div.md-line[data-line]` per source line of
 * the frontmatter-stripped text; code blocks, tables and diagrams are single
 * top-level blocks between them, so a boundary inside one resolves to the
 * block's source lines from its neighbouring line markers.
 */
export function markdownPreviewSelectionLines(rawContent: string, root: HTMLElement, range: Range): { start: number; end: number } | null {
    if (range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
    const offset = strippedFrontmatterLineCount(rawContent);
    const lastLine = rawContent.split('\n').length - offset;
    const startBlock = topLevelBlock(root, range.startContainer, range.startOffset, 'start');
    const endBlock = topLevelBlock(root, range.endContainer, range.endOffset, 'end');
    if (!startBlock || !endBlock) return null;
    const start = blockLine(startBlock, 'start', lastLine);
    let end = blockLine(endBlock, 'end', lastLine);
    // A paragraph/triple-click selection ends at the very start of the next line.
    if (end > start && lineNumber(endBlock) !== null && isAtBlockStart(endBlock, range)) end -= 1;
    return { start: start + offset, end: Math.max(start, end) + offset };
}

function topLevelBlock(root: HTMLElement, container: Node, offset: number, edge: 'start' | 'end'): Element | null {
    let node: Node | null = container === root
        ? root.childNodes[edge === 'start' ? offset : offset - 1] ?? null
        : container;
    while (node && node.parentNode !== root) node = node.parentNode;
    // Whitespace text between blocks belongs to the block on the selection's inner side.
    while (node && !(node instanceof Element)) node = edge === 'start' ? node.nextSibling : node.previousSibling;
    return node;
}

function isAtBlockStart(block: Element, range: Range): boolean {
    if (!block.contains(range.endContainer)) return false;
    const before = block.ownerDocument.createRange();
    before.setStart(block, 0);
    before.setEnd(range.endContainer, range.endOffset);
    return before.toString() === '';
}

function lineNumber(element: Element): number | null {
    if (!element.classList.contains('md-line')) return null;
    const line = Number(element.getAttribute('data-line'));
    return Number.isInteger(line) && line > 0 ? line : null;
}

function blockLine(block: Element, edge: 'start' | 'end', lastLine: number): number {
    const own = lineNumber(block);
    if (own !== null) return own;
    for (let node = edge === 'start' ? block.previousElementSibling : block.nextElementSibling; node;
        node = edge === 'start' ? node.previousElementSibling : node.nextElementSibling) {
        const line = lineNumber(node);
        if (line !== null) return edge === 'start' ? line + 1 : line - 1;
    }
    return edge === 'start' ? 1 : lastLine;
}
