/**
 * Pure-ish helpers for capturing a Quick Ask selection inside an assistant
 * turn. The DOM-reading entry point (`getQuickAskSelection`) is thin; the
 * context-derivation logic is factored into pure functions for unit testing.
 */

import type { QuickAskSelection } from './types';

/** Minimum selectable length (chars) that raises the Ask pill. */
export const MIN_SELECTION_CHARS = 2;

/** Context window (chars) captured on each side of the selection. */
export const CONTEXT_CHARS = 80;

/** Whether a raw selection string is worth offering a lookup for. */
export function isSelectableText(text: string): boolean {
    const trimmed = (text ?? '').trim();
    return trimmed.length >= MIN_SELECTION_CHARS;
}

/**
 * Derive surrounding context from the container's full text and the selected
 * substring. Returns empty context when the selection can't be located
 * (e.g. whitespace normalization differences) — the lookup still works, just
 * with less grounding.
 */
export function deriveContext(
    fullText: string,
    selectedText: string,
    maxChars: number = CONTEXT_CHARS,
): { contextBefore: string; contextAfter: string } {
    const idx = fullText.indexOf(selectedText);
    if (idx < 0) {return { contextBefore: '', contextAfter: '' };}
    const before = fullText.slice(Math.max(0, idx - maxChars), idx);
    const after = fullText.slice(idx + selectedText.length, idx + selectedText.length + maxChars);
    return { contextBefore: before, contextAfter: after };
}

/**
 * Read the current window selection and, if it is a non-trivial selection
 * inside `container`, return a `QuickAskSelection`. Otherwise returns null.
 */
export function getQuickAskSelection(
    container: HTMLElement,
    turnIndex: number,
): QuickAskSelection | null {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {return null;}

    const raw = sel.toString();
    if (!isSelectableText(raw)) {return null;}

    const range = sel.getRangeAt(0);
    // Selection must be fully within this turn's content container.
    if (!container.contains(range.commonAncestorContainer)) {return null;}

    const rectDom = range.getBoundingClientRect();
    if (!rectDom || (rectDom.width === 0 && rectDom.height === 0)) {return null;}

    const selectedText = raw.trim();
    const fullText = container.textContent || '';
    const { contextBefore, contextAfter } = deriveContext(fullText, selectedText);

    return {
        turnIndex,
        selectedText,
        contextBefore,
        contextAfter,
        rect: {
            top: rectDom.top,
            left: rectDom.left,
            bottom: rectDom.bottom,
            right: rectDom.right,
        },
    };
}
