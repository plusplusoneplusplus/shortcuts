/**
 * Caret resolution for a file-path drop onto a composer.
 *
 * A drop can land on a composer that is not focused, so the tracked cursor
 * offset is often stale or 0. When the browser can tell us which character the
 * pointer was over we prefer that; jsdom implements neither API, so the caller
 * falls back to the tracked offset.
 */

type CaretDocument = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node | null; offset: number } | null;
};

/** Number of text characters in `root` that precede `node` in document order. */
function textLengthBefore(root: Node, node: Node): number | null {
    let total = 0;
    let found = false;
    const walk = (current: Node) => {
        if (found) return;
        if (current === node) {
            found = true;
            return;
        }
        if (current.nodeType === Node.TEXT_NODE) {
            total += current.textContent?.length ?? 0;
            return;
        }
        for (const child of Array.from(current.childNodes)) {
            walk(child);
            if (found) return;
        }
    };
    walk(root);
    return found ? total : null;
}

/**
 * Convert a DOM (node, offset) caret position into a flat text offset relative
 * to `root`. Only text nodes contribute length, matching how RichTextInput's
 * `setValue` walks the tree when it restores a caret.
 */
export function textOffsetOfCaret(root: HTMLElement, node: Node, offset: number): number | null {
    const before = textLengthBefore(root, node);
    if (before === null) return null;
    let local = 0;
    if (node.nodeType === Node.TEXT_NODE) {
        local = Math.min(Math.max(0, offset), node.textContent?.length ?? 0);
    } else {
        // For an element container the offset is a child index.
        local = Array.from(node.childNodes)
            .slice(0, Math.max(0, offset))
            .reduce((sum, child) => sum + (child.textContent?.length ?? 0), 0);
    }
    const total = root.textContent?.length ?? 0;
    return Math.min(before + local, total);
}

/**
 * Text offset inside `editable` for a pointer at viewport (clientX, clientY),
 * or null when the browser cannot resolve it or the point falls outside the
 * editor.
 */
export function textOffsetFromPoint(
    editable: HTMLElement | null | undefined,
    clientX: number,
    clientY: number,
): number | null {
    if (!editable || typeof document === 'undefined') return null;
    let node: Node | null = null;
    let offset = 0;
    try {
        const doc = document as CaretDocument;
        if (typeof doc.caretRangeFromPoint === 'function') {
            const range = doc.caretRangeFromPoint(clientX, clientY);
            if (range) {
                node = range.startContainer;
                offset = range.startOffset;
            }
        } else if (typeof doc.caretPositionFromPoint === 'function') {
            const position = doc.caretPositionFromPoint(clientX, clientY);
            if (position?.offsetNode) {
                node = position.offsetNode;
                offset = position.offset;
            }
        }
    } catch {
        return null;
    }
    if (!node || !editable.contains(node)) return null;
    return textOffsetOfCaret(editable, node, offset);
}

/** The contentEditable element a composer's drop target wraps, if present. */
export function findComposerEditable(container: Element | null | undefined): HTMLElement | null {
    if (!container) return null;
    return container.querySelector<HTMLElement>('[data-rich-input]');
}
