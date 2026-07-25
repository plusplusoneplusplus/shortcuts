/**
 * sidenoteHighlight — DOM primitives for AC-01: persistently highlight a
 * resolved side-note source phrase, scroll it into view, and flash the whole
 * turn when the source cannot be located.
 *
 * The rendered assistant turn is plain markdown DOM (not a ProseMirror editor),
 * so the highlight is a set of wrapper `<span>` elements injected around the
 * matched text nodes — NOT a persisted mark. Wrapping is text-neutral (the spans
 * add no characters), so `container.textContent` is unchanged and
 * `resolveSidenoteAnchor` keeps resolving correctly across repeated clicks.
 *
 * Pure DOM logic with no React dependency, so the primitives are unit-testable
 * (jsdom provides `splitText`/`normalize`/`insertBefore`). `scrollIntoView` is
 * absent in jsdom, so callers go through the guarded helper below.
 */

import { collectTextNodes } from './sidenoteAnchoring';

/** Marker attribute stamped on every highlight span (used to find + unwrap). */
export const SIDENOTE_HIGHLIGHT_ATTR = 'data-quick-ask-highlight';
/** Visual class for the persistent source highlight (see sidenoteHighlight.css). */
export const SIDENOTE_HIGHLIGHT_CLASS = 'quick-ask-sidenote-highlight';
/** Whole-turn flash class for the not-located fallback (see sidenoteHighlight.css). */
export const SIDENOTE_FLASH_CLASS = 'quick-ask-sidenote-flash';

/**
 * Remove every side-note highlight span inside `container`, moving each span's
 * children back out before deleting it, then merging the split text nodes so a
 * subsequent resolve/highlight sees clean, un-fragmented nodes. Idempotent.
 */
export function clearSidenoteHighlights(container: HTMLElement | null): void {
    if (!container) {return;}
    const spans = container.querySelectorAll(`[${SIDENOTE_HIGHLIGHT_ATTR}]`);
    if (spans.length === 0) {return;}
    spans.forEach(span => {
        const parent = span.parentNode;
        if (!parent) {return;}
        while (span.firstChild) {parent.insertBefore(span.firstChild, span);}
        parent.removeChild(span);
    });
    container.normalize();
}

/** Wrap a single text node's [start, end) slice in a highlight span. */
function wrapSlice(doc: Document, node: Text, start: number, end: number): HTMLElement | null {
    const s = Math.max(0, start);
    const e = Math.min(node.data.length, end);
    if (s >= e) {return null;}
    let slice = node;
    if (e < slice.data.length) {slice.splitText(e);}
    if (s > 0) {slice = slice.splitText(s);}
    const parent = slice.parentNode;
    if (!parent) {return null;}
    const span = doc.createElement('span');
    span.setAttribute(SIDENOTE_HIGHLIGHT_ATTR, '');
    span.className = SIDENOTE_HIGHLIGHT_CLASS;
    parent.insertBefore(span, slice);
    span.appendChild(slice);
    return span;
}

/**
 * Highlight the plain-text half-open interval `[from, to)` inside `container`
 * by wrapping the overlapping portion of each text node in a highlight span.
 * Offsets are into `container.textContent` (as returned by `resolveSidenoteAnchor`).
 * Returns the spans created in document order; empty when nothing overlapped.
 *
 * Nodes are collected up front; splitting one node never shifts another node's
 * data or the pre-computed offset accounting, so a single pass is correct even
 * when the phrase straddles inline-markup boundaries.
 */
export function highlightSidenoteRange(container: HTMLElement, from: number, to: number): HTMLElement[] {
    const doc = container.ownerDocument;
    if (!doc || to <= from) {return [];}
    const nodes = collectTextNodes(container);
    const spans: HTMLElement[] = [];
    let acc = 0;
    for (const node of nodes) {
        const nodeStart = acc;
        const nodeEnd = acc + node.data.length;
        acc = nodeEnd;
        const s = Math.max(from, nodeStart);
        const e = Math.min(to, nodeEnd);
        if (s >= e) {continue;}
        const span = wrapSlice(doc, node, s - nodeStart, e - nodeStart);
        if (span) {spans.push(span);}
    }
    return spans;
}

/**
 * Scroll an element into view, guarded for environments (jsdom) where
 * `scrollIntoView` is not implemented.
 */
export function scrollElementIntoView(el: Element | null | undefined, opts?: ScrollIntoViewOptions): void {
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
        (el as HTMLElement).scrollIntoView(opts);
    }
}

/**
 * Briefly flash `container` (the not-located fallback): re-adds the flash class
 * after a reflow so a second click restarts the animation, and clears it once
 * the animation has run.
 */
export function flashTurn(container: HTMLElement | null): void {
    if (!container) {return;}
    container.classList.remove(SIDENOTE_FLASH_CLASS);
    // Force reflow so re-adding the class restarts the CSS animation.
    void container.offsetWidth;
    container.classList.add(SIDENOTE_FLASH_CLASS);
    const win = container.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
    win?.setTimeout(() => container.classList.remove(SIDENOTE_FLASH_CLASS), 1200);
}
