/**
 * TOC jump + scroll-spy.
 *
 * Regression cover for the bug where clicking a TOC entry closed the panel but
 * scrolled nothing: `handleTocJump` relied on ProseMirror's `scrollIntoView()`,
 * which scrolls outward from the *DOM* selection — and a TOC click leaves the
 * editor unfocused with no selection range, so it silently scrolled nothing.
 * Confirmed in a live browser repro (scrollTop stayed 0, no console errors).
 *
 * Also covers the scroll-spy highlight, which zipped the entry list against
 * `querySelectorAll('h1, h2, h3')` by index even though `extractHeadings`
 * skips empty headings, so the two lists drifted apart.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    computeTocScrollTop,
    extractHeadings,
    findActiveTocIndex,
    jumpToHeading,
    resolveHeadingElement,
    TOC_SCROLL_OFFSET_PX,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/noteTocUtils';
import type { TocEntry } from '../../../../../../src/server/spa/client/react/features/notes/editor/noteTocUtils';

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface HeadingSpec {
    level: 1 | 2 | 3;
    text: string;
    /** ProseMirror position *before* the heading node. */
    pos: number;
    /** Rendered `getBoundingClientRect().top`, in client px. */
    top: number;
}

function makeRectEl(tagName: string, top: number): HTMLElement {
    return {
        nodeType: 1,
        tagName,
        parentElement: null,
        getBoundingClientRect: () => ({ top } as DOMRect),
    } as unknown as HTMLElement;
}

function makeContainer(top: number, scrollTop: number): HTMLElement {
    return {
        scrollTop,
        getBoundingClientRect: () => ({ top } as DOMRect),
    } as unknown as HTMLElement;
}

/**
 * Editor whose doc yields `specs` in order and whose view maps each heading's
 * position back to a rendered element — the same contract the real
 * `EditorView.nodeDOM` provides.
 */
function makeEditor(specs: HeadingSpec[]) {
    const elements = new Map<number, HTMLElement>();
    for (const s of specs) elements.set(s.pos, makeRectEl(`H${s.level}`, s.top));
    const chain = {
        setTextSelection: vi.fn(() => chain),
        focus: vi.fn(() => chain),
        run: vi.fn(() => true),
    };
    return {
        chain: vi.fn(() => chain),
        _chain: chain,
        state: {
            doc: {
                descendants: (cb: (node: any, pos: number) => void) => {
                    for (const s of specs) {
                        cb({ type: { name: 'heading' }, attrs: { level: s.level }, textContent: s.text }, s.pos);
                    }
                },
            },
        },
        view: { nodeDOM: (pos: number) => elements.get(pos) ?? null },
    } as any;
}

/** Empty heading in the middle, and a title that appears twice. */
const MIXED_HEADINGS: HeadingSpec[] = [
    { level: 1, text: 'Alpha', pos: 0, top: 100 },
    { level: 2, text: '', pos: 20, top: 300 },
    { level: 2, text: 'Bravo', pos: 40, top: 500 },
    { level: 2, text: 'Charlie', pos: 60, top: 700 },
    { level: 2, text: 'Bravo', pos: 80, top: 900 },
];

// ── resolveHeadingElement ────────────────────────────────────────────────────

describe('resolveHeadingElement', () => {
    it('resolves an entry position to its rendered heading element', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const el = resolveHeadingElement(editor, 40);
        expect(el?.tagName).toBe('H2');
        expect(el?.getBoundingClientRect().top).toBe(500);
    });

    it('resolves duplicate titles to their own occurrence, not the first match', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        expect(resolveHeadingElement(editor, 40)?.getBoundingClientRect().top).toBe(500);
        expect(resolveHeadingElement(editor, 80)?.getBoundingClientRect().top).toBe(900);
    });

    it('falls back to domAtPos and climbs to the heading when nodeDOM misses', () => {
        const heading = makeRectEl('H3', 42);
        const textNode = { nodeType: 3, parentElement: heading } as unknown as Node;
        const editor = {
            view: {
                nodeDOM: () => null,
                domAtPos: (pos: number) => (pos === 41 ? { node: textNode, offset: 0 } : null),
            },
        } as any;
        expect(resolveHeadingElement(editor, 40)).toBe(heading);
    });

    it('returns null when the editor has no view (non-DOM environment)', () => {
        expect(resolveHeadingElement({} as any, 10)).toBeNull();
    });

    it('returns null instead of throwing when the view rejects the position', () => {
        const editor = {
            view: {
                nodeDOM: () => { throw new RangeError('Position outside of fragment'); },
            },
        } as any;
        expect(resolveHeadingElement(editor, 9999)).toBeNull();
    });
});

// ── computeTocScrollTop ──────────────────────────────────────────────────────

describe('computeTocScrollTop', () => {
    it('pins the heading to the top of the container, minus the offset', () => {
        const container = makeContainer(100, 0);
        const heading = makeRectEl('H2', 900);
        expect(computeTocScrollTop(container, heading)).toBe(800 - TOC_SCROLL_OFFSET_PX);
    });

    it('accounts for the container being already scrolled', () => {
        const container = makeContainer(100, 500);
        const heading = makeRectEl('H2', 900);
        expect(computeTocScrollTop(container, heading)).toBe(500 + 800 - TOC_SCROLL_OFFSET_PX);
    });

    it('scrolls back up for a heading above the current position', () => {
        const container = makeContainer(100, 1000);
        const heading = makeRectEl('H2', -400); // 500px above the container top
        expect(computeTocScrollTop(container, heading)).toBe(1000 - 500 - TOC_SCROLL_OFFSET_PX);
    });

    it('never returns a negative scrollTop', () => {
        const container = makeContainer(100, 0);
        const heading = makeRectEl('H1', 104);
        expect(computeTocScrollTop(container, heading)).toBe(0);
    });
});

// ── jumpToHeading ────────────────────────────────────────────────────────────

describe('jumpToHeading', () => {
    it('sets scrollTop so a below-the-fold heading lands at the top', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        const container = makeContainer(100, 0);

        // 'Charlie' renders at client-y 700, far below the container top.
        jumpToHeading(editor, container, entries.find(e => e.text === 'Charlie')!);

        expect(container.scrollTop).toBe(600 - TOC_SCROLL_OFFSET_PX);
    });

    it('selects the heading inline start (pos + 1), not the node boundary', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entry = extractHeadings(editor).find(e => e.text === 'Charlie')!;
        expect(entry.pos).toBe(60);

        jumpToHeading(editor, makeContainer(100, 0), entry);

        expect(editor._chain.setTextSelection).toHaveBeenCalledWith(61);
    });

    it('focuses the editor without letting ProseMirror do its own scrolling', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        jumpToHeading(editor, makeContainer(100, 0), entries[0]);

        expect(editor._chain.focus).toHaveBeenCalledWith(undefined, { scrollIntoView: false });
        expect(editor._chain.run).toHaveBeenCalled();
    });

    it('jumps to the clicked occurrence of a duplicated title', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        const duplicates = entries.filter(e => e.text === 'Bravo');
        expect(duplicates).toHaveLength(2);

        const container = makeContainer(100, 0);
        jumpToHeading(editor, container, duplicates[1]);

        expect(container.scrollTop).toBe(800 - TOC_SCROLL_OFFSET_PX);
    });

    it('still moves the caret when there is no scroll container', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        expect(() => jumpToHeading(editor, null, entries[0])).not.toThrow();
        expect(editor._chain.setTextSelection).toHaveBeenCalledWith(1);
    });
});

// ── findActiveTocIndex ───────────────────────────────────────────────────────

describe('findActiveTocIndex', () => {
    it('ignores the skipped empty heading instead of drifting by its index', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        // The empty heading is dropped, so 'Charlie' is entry 2 of 4 even though
        // it is the 4th heading element in the document.
        expect(entries.map(e => e.text)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Bravo']);

        // Container top at 700 → Alpha/Bravo/Charlie are at or above it, the
        // second Bravo (top 900) is still below.
        expect(findActiveTocIndex(entries, editor, makeContainer(700, 0))).toBe(2);
    });

    it('resolves duplicate titles to the correct occurrence', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        // Everything has scrolled above the top → the *second* Bravo is active.
        expect(findActiveTocIndex(entries, editor, makeContainer(910, 0))).toBe(3);
    });

    it('returns null while the reader is above the first heading', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        expect(findActiveTocIndex(entries, editor, makeContainer(0, 0))).toBeNull();
    });

    it('reports the section the reader is in when an empty heading is on screen', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries = extractHeadings(editor);
        // Container top at 310: the empty heading (300) is just above the fold,
        // but it has no TOC row — the highlight stays on the preceding 'Alpha'.
        expect(findActiveTocIndex(entries, editor, makeContainer(310, 0))).toBe(0);
    });

    it('skips entries that are not rendered', () => {
        const editor = makeEditor(MIXED_HEADINGS);
        const entries: TocEntry[] = [
            ...extractHeadings(editor),
            { index: 4, level: 2, text: 'Unrendered', pos: 999 },
        ];
        expect(findActiveTocIndex(entries, editor, makeContainer(910, 0))).toBe(3);
    });
});
