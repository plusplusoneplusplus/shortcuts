import type { Editor } from '@tiptap/core';

export interface TocEntry {
    /** Stable position in the list (0-based). */
    index: number;
    level: 1 | 2 | 3;
    /** Plain-text content of the heading. */
    text: string;
    /** ProseMirror document position. */
    pos: number;
}

/**
 * Walk editor.state.doc and collect all heading nodes (H1/H2/H3).
 * Returns a flat list ordered by document position.
 */
export function extractHeadings(editor: Editor): TocEntry[] {
    const entries: TocEntry[] = [];
    if (!editor.state?.doc || typeof editor.state.doc.descendants !== 'function') return entries;
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return;
        const level = node.attrs.level as number;
        if (level < 1 || level > 3) return;
        const text = node.textContent.trim();
        if (!text) return;
        entries.push({ index: entries.length, level: level as 1 | 2 | 3, text, pos });
    });
    return entries;
}
