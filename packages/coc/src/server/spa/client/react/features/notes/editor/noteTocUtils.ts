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

/**
 * Gap (px) left above a heading after a TOC jump so the sticky toolbar and the
 * heading's own top margin do not visually swallow it.
 */
export const TOC_SCROLL_OFFSET_PX = 12;

/** A heading is "current" once its top is within this many px of the viewport top. */
export const TOC_ACTIVE_THRESHOLD_PX = 8;

const HEADING_TAGS = new Set(['H1', 'H2', 'H3']);

/**
 * Resolve a TOC entry's ProseMirror position to the rendered heading element.
 *
 * Matching by position (rather than by DOM index or heading text) is what keeps
 * the TOC honest: `extractHeadings` skips empty headings, so a plain
 * `querySelectorAll('h1, h2, h3')` list does not line up with the entry list,
 * and duplicate titles make text matching ambiguous.
 *
 * Returns `null` outside a DOM environment or when the entry is not rendered.
 */
export function resolveHeadingElement(editor: Editor, pos: number): HTMLElement | null {
    const view = editor?.view as any;
    if (!view) return null;
    try {
        const direct = typeof view.nodeDOM === 'function' ? view.nodeDOM(pos) : null;
        if (direct && direct.nodeType === 1 && HEADING_TAGS.has((direct as HTMLElement).tagName)) {
            return direct as HTMLElement;
        }
        if (typeof view.domAtPos !== 'function') return null;
        // `pos` is the position *before* the heading node; `pos + 1` is its
        // inline start, which resolves into the heading element itself.
        const at = view.domAtPos(pos + 1);
        let node: Node | null = at?.node ?? null;
        if (node && node.nodeType !== 1) node = (node as any).parentElement ?? null;
        let el = node as HTMLElement | null;
        while (el && !HEADING_TAGS.has(el.tagName)) el = el.parentElement;
        return el;
    } catch {
        return null;
    }
}

/**
 * `scrollTop` that pins `heading` to the top of `container`, minus a small
 * offset. Computed from live rects plus the current `scrollTop` so it is
 * immune to the CSS `zoom` wrapper sitting between the two elements.
 */
export function computeTocScrollTop(
    container: HTMLElement,
    heading: HTMLElement,
    offsetPx: number = TOC_SCROLL_OFFSET_PX,
): number {
    const containerTop = container.getBoundingClientRect().top;
    const headingTop = heading.getBoundingClientRect().top;
    return Math.max(0, container.scrollTop + (headingTop - containerTop) - offsetPx);
}

/**
 * Move the caret to a heading and pin it near the top of the scroll container.
 *
 * ProseMirror's own `scrollIntoView()` cannot do this job: it scrolls outward
 * from the *DOM* selection, and a TOC click leaves the editor unfocused with no
 * selection range, so it silently scrolls nothing. Even focused it only ever
 * scrolls the minimum needed. So we focus the editor for the caret and set
 * `scrollTop` ourselves for the scroll.
 */
export function jumpToHeading(editor: Editor, container: HTMLElement | null, entry: TocEntry): void {
    // `entry.pos` is the position before the heading node; `+ 1` is its inline
    // start, so the caret lands on the heading text rather than on the node
    // boundary in front of it.
    editor.chain().setTextSelection(entry.pos + 1).focus(undefined, { scrollIntoView: false }).run();
    const headingEl = resolveHeadingElement(editor, entry.pos);
    if (container && headingEl) container.scrollTop = computeTocScrollTop(container, headingEl);
}

/**
 * Index of the entry whose heading is the last one at or above the top of the
 * scroll container — i.e. the section the reader is currently in. Returns
 * `null` when the reader is above the first heading.
 */
export function findActiveTocIndex(
    entries: TocEntry[],
    editor: Editor,
    container: HTMLElement,
    thresholdPx: number = TOC_ACTIVE_THRESHOLD_PX,
): number | null {
    const containerTop = container.getBoundingClientRect().top;
    let active: number | null = null;
    for (const entry of entries) {
        const el = resolveHeadingElement(editor, entry.pos);
        if (!el) continue;
        if (el.getBoundingClientRect().top - containerTop <= thresholdPx) active = entry.index;
    }
    return active;
}

// ── Heading anchors ─────────────────────────────────────────────────────────

/**
 * Turn heading text into a GitHub-style anchor slug: lowercase, punctuation
 * dropped in place, every remaining space turned into a hyphen.
 *
 * Dropping punctuation *in place* (rather than collapsing what is left) is what
 * makes `Fun & Games` slug to `fun--games`, the same doubled dash GitHub emits.
 * Unicode dashes are the one exception: ` — ` between two words reads as a
 * single separator, so it normalizes to one hyphen instead of three.
 *
 * Used on both sides of every anchor comparison — the fragment an author wrote
 * by hand and the live heading text — so the two agree on punctuated headings.
 */
export function slugifyHeading(text: string): string {
    return text
        .toLowerCase()
        // en/em/figure dashes and the minus sign all read as a plain hyphen.
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
        .trim()
        // A spaced-out dash is one separator, not three.
        .replace(/\s+-+\s+/g, '-')
        .replace(/\s/g, '-');
}

const HEADING_SELECTOR = '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3';

/**
 * Scroll the rendered note to the heading matching `heading`, used by the
 * cross-note `[[note:path#heading]]` jump once the target note has loaded.
 *
 * Headings carry no `id`, so the id/`data-toc-id` lookups are only there for a
 * host that does emit them; the text match is what actually resolves, and it
 * compares slugs so a heading full of punctuation still lands. Falls back to
 * the first heading (i.e. the top of the note) when nothing matches.
 *
 * Returns whether an actual match was found.
 */
export function scrollToHeadingByText(heading: string, doc: Document = document): boolean {
    const slug = slugifyHeading(heading);
    const scroll = (el: Element) => el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const byId = doc.getElementById(slug) ?? doc.querySelector(`[data-toc-id="${slug}"]`);
    if (byId) {
        scroll(byId);
        return true;
    }

    const headings = doc.querySelectorAll(HEADING_SELECTOR);
    for (const el of headings) {
        if (slugifyHeading((el.textContent ?? '').trim()) === slug) {
            scroll(el);
            return true;
        }
    }

    const first = headings[0];
    if (first) scroll(first);
    return false;
}
