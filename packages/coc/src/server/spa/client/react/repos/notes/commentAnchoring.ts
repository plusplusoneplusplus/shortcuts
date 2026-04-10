import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { TextAnchor } from '../notesApi';

/**
 * Walk the ProseMirror doc to convert a plain-text character offset
 * to a ProseMirror position. ProseMirror positions include node boundaries
 * (each block adds +1), so we accumulate text lengths across text nodes.
 */
export function textOffsetToPos(doc: ProseMirrorNode, offset: number): number {
    let pos = 0;
    let textSoFar = 0;
    let found = false;

    doc.descendants((node, nodePos) => {
        if (found) return false;
        if (node.isText) {
            const len = node.text!.length;
            if (textSoFar + len >= offset) {
                pos = nodePos + (offset - textSoFar);
                found = true;
                return false;
            }
            textSoFar += len;
        }
        return true;
    });

    // If offset is past all text, return end of document
    if (!found) {
        pos = doc.content.size;
    }
    return pos;
}

/**
 * Convert a ProseMirror position to a plain-text character offset.
 */
export function posToTextOffset(doc: ProseMirrorNode, targetPos: number): number {
    let textSoFar = 0;
    let result = 0;
    let found = false;

    doc.descendants((node, nodePos) => {
        if (found) return false;
        if (node.isText) {
            const len = node.text!.length;
            if (nodePos + len >= targetPos) {
                result = textSoFar + (targetPos - nodePos);
                found = true;
                return false;
            }
            textSoFar += len;
        }
        return true;
    });

    if (!found) {
        result = textSoFar;
    }
    return result;
}

const CONTEXT_CHARS = 50;

/**
 * Create a TextAnchor from the editor's current selection.
 * Extracts the selected text plus surrounding context for relocation.
 */
export function createTextAnchorFromSelection(editor: Editor): TextAnchor | null {
    const { from, to } = editor.state.selection;
    if (from === to) return null;

    const doc = editor.state.doc;
    const selectedText = doc.textBetween(from, to, '');

    // Get surrounding context from the full plain text
    const fullText = doc.textContent;
    const startOffset = posToTextOffset(doc, from);
    const endOffset = posToTextOffset(doc, to);

    const prefix = fullText.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset);
    const suffix = fullText.slice(endOffset, endOffset + CONTEXT_CHARS);

    return {
        quotedText: selectedText,
        prefix,
        suffix,
    };
}

/**
 * Find the location of an anchor's quoted text in the editor's plain text,
 * using context for disambiguation. Returns ProseMirror from/to positions
 * or null if the text cannot be found.
 */
export function findAnchorInDoc(
    doc: ProseMirrorNode,
    anchor: TextAnchor,
): { from: number; to: number } | null {
    const fullText = doc.textContent;
    const { quotedText, prefix, suffix } = anchor;

    if (!quotedText) return null;

    // Find all occurrences of the quoted text
    const occurrences: number[] = [];
    let searchFrom = 0;
    while (true) {
        const idx = fullText.indexOf(quotedText, searchFrom);
        if (idx === -1) break;
        occurrences.push(idx);
        searchFrom = idx + 1;
    }

    if (occurrences.length === 0) return null;

    // Pick the best occurrence by scoring context overlap
    let bestIdx = occurrences[0];
    let bestScore = -1;

    for (const idx of occurrences) {
        let score = 0;
        // Score prefix match
        const actualPrefix = fullText.slice(Math.max(0, idx - prefix.length), idx);
        if (actualPrefix === prefix) {
            score += 2;
        } else if (prefix && actualPrefix.endsWith(prefix.slice(-10))) {
            score += 1;
        }
        // Score suffix match
        const end = idx + quotedText.length;
        const actualSuffix = fullText.slice(end, end + suffix.length);
        if (actualSuffix === suffix) {
            score += 2;
        } else if (suffix && actualSuffix.startsWith(suffix.slice(0, 10))) {
            score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
        }
    }

    const from = textOffsetToPos(doc, bestIdx);
    const to = textOffsetToPos(doc, bestIdx + quotedText.length);
    return { from, to };
}

/**
 * Apply a comment mark to a specific range in the editor for a given thread ID.
 * Preserves the user's current selection afterward.
 */
export function applyCommentMark(
    editor: Editor,
    threadId: string,
    from: number,
    to: number,
): void {
    const savedSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
    editor.chain()
        .setTextSelection({ from, to })
        .setComment(threadId)
        .setTextSelection(savedSelection)
        .run();
}

/**
 * Re-create a fresh TextAnchor for a thread whose mark is still in the editor.
 * Returns null if the mark can't be found.
 */
export function buildAnchorFromMark(
    editor: Editor,
    threadId: string,
): TextAnchor | null {
    let markFrom: number | null = null;
    let markTo: number | null = null;

    editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        const commentMark = node.marks.find(
            (m) => m.type.name === 'comment' && m.attrs.commentId === threadId,
        );
        if (commentMark) {
            if (markFrom === null) markFrom = pos;
            markTo = pos + node.nodeSize;
        }
    });

    if (markFrom === null || markTo === null) return null;

    const doc = editor.state.doc;
    const quotedText = doc.textBetween(markFrom, markTo, '');
    const fullText = doc.textContent;
    const startOffset = posToTextOffset(doc, markFrom);
    const endOffset = posToTextOffset(doc, markTo);

    return {
        quotedText,
        prefix: fullText.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset),
        suffix: fullText.slice(endOffset, endOffset + CONTEXT_CHARS),
    };
}
