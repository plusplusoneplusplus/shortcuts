/**
 * useConversationSearchHighlight — AC-04 / AC-05 of the Ctrl+F Search Experience.
 *
 * When the chat-list FTS5 search box holds a query and a conversation is open in
 * the right panel, this hook client-side re-searches that query across the
 * rendered turns and highlights every matched text substring, then scrolls the
 * first occurrence into view. The highlight persists until the search box is
 * exited (Escape / ✕ / emptied query) — at which point the query prop becomes
 * empty and every highlight is torn down.
 *
 * Mechanism (constraint [assumption]): the CSS Custom Highlight API
 * (`CSS.highlights` + `Range` + `::highlight(...)`) so we never mutate the
 * React-managed markdown DOM. The API is feature-detected; when it is absent
 * (older browsers, jsdom) the hook is a no-op and native find-in-page handles
 * the case instead. There is NO `window.electron` dependency, so this works in
 * both the desktop (Electron) and web builds.
 *
 * Scope is best-effort: only currently rendered `[data-turn-index]` turns are
 * searched. Matches inside virtualized / not-yet-loaded turns, or split across
 * element boundaries (e.g. partially bolded text), may be missed.
 */

import { useEffect, useRef } from 'react';

/** Name registered in `CSS.highlights` and referenced by the `::highlight()` rule. */
export const SEARCH_HIGHLIGHT_NAME = 'coc-search-highlight';
const STYLE_ELEMENT_ID = 'coc-search-highlight-style';

type HighlightCtor = new (...ranges: Range[]) => unknown;

/** Feature-detect the CSS Custom Highlight API (absent in jsdom + older browsers). */
export function isHighlightApiSupported(): boolean {
    return (
        typeof CSS !== 'undefined' &&
        !!(CSS as unknown as { highlights?: unknown }).highlights &&
        typeof (globalThis as unknown as { Highlight?: unknown }).Highlight === 'function' &&
        typeof Range !== 'undefined' &&
        typeof document !== 'undefined'
    );
}

/** Inject the single `::highlight()` style rule once per document. */
function ensureHighlightStyle(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    // A translucent yellow reads on both light and dark themes; `color: inherit`
    // keeps the underlying text legible.
    style.textContent = `::highlight(${SEARCH_HIGHLIGHT_NAME}){background-color:rgba(250,204,21,0.5);color:inherit;}`;
    document.head.appendChild(style);
}

/** Remove any active search highlight (AC-05 teardown). Safe to call unconditionally. */
export function clearSearchHighlight(): void {
    if (typeof CSS === 'undefined') return;
    const highlights = (CSS as unknown as { highlights?: { delete?: (name: string) => void } }).highlights;
    try {
        highlights?.delete?.(SEARCH_HIGHLIGHT_NAME);
    } catch {
        /* ignore */
    }
}

/** Text nodes inside rendered turn bubbles, skipping the pinned-section duplicates. */
function collectTurnTextNodes(container: HTMLElement): Text[] {
    const turns = container.querySelectorAll<HTMLElement>('[data-turn-index]');
    const nodes: Text[] = [];
    turns.forEach(turn => {
        // The pinned section renders duplicate copies of turns — ignore them so we
        // don't highlight (and scroll to) the same text twice.
        if (turn.closest('[data-pinned-section]')) return;
        const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (node.nodeValue && node.nodeValue.length > 0) nodes.push(node as Text);
            node = walker.nextNode();
        }
    });
    return nodes;
}

/** All case-insensitive occurrences of `term` within the given text nodes, as Ranges. */
function rangesForTerm(textNodes: Text[], term: string): Range[] {
    const ranges: Range[] = [];
    const needle = term.toLowerCase();
    if (!needle) return ranges;
    for (const node of textNodes) {
        const hay = (node.nodeValue ?? '').toLowerCase();
        let from = 0;
        let idx = hay.indexOf(needle, from);
        while (idx !== -1) {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + needle.length);
            ranges.push(range);
            from = idx + needle.length;
            idx = hay.indexOf(needle, from);
        }
    }
    return ranges;
}

/**
 * Build the highlight ranges for `query` within `container`.
 *
 * Query matching (constraint [assumption]): first look for the raw (trimmed)
 * query string; only if it does not appear anywhere do we fall back to the
 * whitespace-split terms. Exported for unit testing.
 */
export function buildHighlightRanges(container: HTMLElement, query: string): Range[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const textNodes = collectTurnTextNodes(container);
    if (textNodes.length === 0) return [];

    const full = rangesForTerm(textNodes, trimmed);
    if (full.length > 0) return full;

    // Fallback: whitespace-split terms (skip the degenerate single-term case that
    // equals the full string we already tried).
    const terms = trimmed.split(/\s+/).filter(Boolean);
    if (terms.length <= 1) return [];
    const out: Range[] = [];
    for (const term of terms) out.push(...rangesForTerm(textNodes, term));
    return out;
}

/** Scroll the element containing the first match into view (smooth, best-effort). */
function scrollRangeIntoView(range: Range): void {
    const node = range.startContainer;
    const el = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) as HTMLElement | null;
    if (!el) return;
    try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
        try {
            el.scrollIntoView();
        } catch {
            /* jsdom / unsupported — ignore */
        }
    }
}

export interface ConversationSearchHighlightOptions {
    /** Active search query while the chat-list search box is open; empty/undefined tears highlights down. */
    query: string | undefined;
    /** Ref to the container wrapping the rendered turn bubbles (`turnsContainerRef`). */
    containerRef: React.RefObject<HTMLElement | null> | undefined;
    /** Re-run when the rendered turns change (async load, streaming). */
    turns: unknown[];
    /** Master switch (defaults to true). */
    enabled?: boolean;
}

/**
 * Highlights `query` across the rendered conversation turns and scrolls the
 * first match into view. Re-runs whenever the query or the turns change, and
 * clears the highlight on teardown / empty query.
 */
export function useConversationSearchHighlight({
    query,
    containerRef,
    turns,
    enabled = true,
}: ConversationSearchHighlightOptions): void {
    // Latch so we scroll to the first match only once per opened conversation
    // (this hook re-mounts per conversation because ChatDetail is keyed by
    // taskId), not on every keystroke or streaming re-render.
    const hasScrolledRef = useRef(false);

    const trimmed = (query ?? '').trim();

    // Reset the scroll latch whenever the query is cleared, so re-typing in an
    // already-open conversation scrolls to the first match again.
    useEffect(() => {
        if (!trimmed) hasScrolledRef.current = false;
    }, [trimmed]);

    useEffect(() => {
        if (!enabled || !trimmed) {
            clearSearchHighlight();
            return;
        }
        if (!isHighlightApiSupported()) return; // native find-in-page handles this case
        ensureHighlightStyle();

        const container = containerRef?.current;
        if (!container) {
            clearSearchHighlight();
            return;
        }

        const ranges = buildHighlightRanges(container, trimmed);
        if (ranges.length === 0) {
            clearSearchHighlight();
            return;
        }

        const HighlightImpl = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
        const highlights = (CSS as unknown as { highlights: { set: (name: string, h: unknown) => void } }).highlights;
        try {
            highlights.set(SEARCH_HIGHLIGHT_NAME, new HighlightImpl(...ranges));
        } catch {
            clearSearchHighlight();
            return;
        }

        if (!hasScrolledRef.current) {
            hasScrolledRef.current = true;
            scrollRangeIntoView(ranges[0]);
        }
    }, [enabled, trimmed, turns, containerRef]);

    // Teardown on unmount (switching conversations, closing the pane).
    useEffect(() => () => clearSearchHighlight(), []);
}
