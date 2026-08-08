import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { TextAnchor } from './textAnchor';

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
 * Locate the range covered by a thread's comment mark in the editor doc.
 * Returns null when the mark is absent (e.g. the thread was resolved, which
 * strips the mark).
 */
export function findCommentMarkRange(
    editor: Editor,
    threadId: string,
): { from: number; to: number } | null {
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
    return { from: markFrom, to: markTo };
}

/** How long the clicked comment stays visibly highlighted, in ms. */
export const COMMENT_ACTIVE_HIGHLIGHT_MS = 1500;

/**
 * Scroll the commented text for a thread into view and flash it.
 *
 * Selecting the range alone is not enough: when the click comes from the
 * comments sidebar the editor is not focused, so ProseMirror paints no
 * selection and its own scrollIntoView does not reliably move the editor's
 * scroll container. So we focus first, then centre the mark's span in its
 * scroll container ourselves and toggle `comment-active` on it.
 *
 * Falls back to the thread's text anchor when the mark is gone (resolved
 * threads have their mark stripped), so those cards still navigate.
 *
 * Returns true when a target was found.
 */
export function revealCommentThread(
    editor: Editor,
    threadId: string,
    thread?: { anchor?: TextAnchor } | null,
): boolean {
    const range =
        findCommentMarkRange(editor, threadId)
        ?? (thread?.anchor ? findAnchorInDoc(editor.state.doc, thread.anchor) : null);

    if (!range) return false;

    editor.chain()
        .focus()
        .setTextSelection(range)
        .scrollIntoView()
        .run();

    scrollCommentSpanIntoView(editor, threadId);
    return true;
}

/**
 * Centre a thread's rendered span in the editor's scroll container and flash
 * the `comment-active` class on it. No-op when the span is not rendered
 * (resolved threads, or a non-DOM test environment).
 */
function scrollCommentSpanIntoView(editor: Editor, threadId: string): void {
    const root = editor.view?.dom as HTMLElement | undefined;
    if (!root || typeof root.querySelector !== 'function') return;

    const span = root.querySelector<HTMLElement>(`span[data-comment-id="${threadId}"]`);
    if (!span) return;

    const scrollContainer = span.closest('.overflow-y-auto') ?? root.parentElement;
    if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const spanRect = span.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop
            + (spanRect.top - containerRect.top)
            - containerRect.height / 2
            + spanRect.height / 2;
        scrollContainer.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
    }

    // Clear any leftover highlight from a previous click before flashing this one.
    root.querySelectorAll<HTMLElement>('span[data-comment-id].comment-active')
        .forEach((el) => el.classList.remove('comment-active'));

    span.classList.add('comment-active');
    setTimeout(() => span.classList.remove('comment-active'), COMMENT_ACTIVE_HIGHLIGHT_MS);
}

/**
 * Re-create a fresh TextAnchor for a thread whose mark is still in the editor.
 * Returns null if the mark can't be found.
 */
export function buildAnchorFromMark(
    editor: Editor,
    threadId: string,
): TextAnchor | null {
    const range = findCommentMarkRange(editor, threadId);
    if (!range) return null;
    const { from: markFrom, to: markTo } = range;

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
