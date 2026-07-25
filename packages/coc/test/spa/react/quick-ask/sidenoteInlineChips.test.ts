import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SIDENOTE_INLINE_ATTR,
    SIDENOTE_INLINE_CLASS,
    SIDENOTE_INLINE_ERROR_CLASS,
    SIDENOTE_INLINE_TESTID,
    clearInlineChips,
    injectInlineChip,
} from '../../../../src/server/spa/client/react/features/chat/quick-ask/sidenoteInlineChips';

function makeContainer(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

/** Build a DOM Range over the plain-text slice [from, to) of a single-text-node container. */
function rangeOf(container: HTMLElement, phrase: string): Range {
    const text = container.textContent ?? '';
    const from = text.indexOf(phrase);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    // Simple single-node mapping is enough for these fixtures.
    let node = walker.nextNode() as Text | null;
    let acc = 0;
    const range = document.createRange();
    while (node) {
        const len = node.data.length;
        if (from >= acc && from <= acc + len) {
            range.setStart(node, from - acc);
        }
        if (from + phrase.length >= acc && from + phrase.length <= acc + len) {
            range.setEnd(node, from + phrase.length - acc);
            break;
        }
        acc += len;
        node = walker.nextNode() as Text | null;
    }
    return range;
}

function chips(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(`[${SIDENOTE_INLINE_ATTR}]`));
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('injectInlineChip', () => {
    it('inserts a marker button right after the resolved phrase without changing textContent', () => {
        const el = makeContainer('<p>The Megatron GroupedGEMM kernel is fast.</p>');
        const before = el.textContent;
        const range = rangeOf(el, 'GroupedGEMM');

        const chip = injectInlineChip(el, range, { id: 'a', label: 'grouped', fullText: 'GroupedGEMM', onActivate: () => {} });

        expect(chip).not.toBeNull();
        expect(chips(el)).toHaveLength(1);
        // Zero-text marker: the glyph is a CSS pseudo-element, so it adds no
        // characters to the container's text.
        expect(el.textContent).toBe(before);
        expect(chip!.textContent).toBe('');
        expect(chip!.getAttribute('data-testid')).toBe(SIDENOTE_INLINE_TESTID);
        expect(chip!.getAttribute('data-sidenote-id')).toBe('a');
        expect(chip!.className).toBe(SIDENOTE_INLINE_CLASS);
        // The marker sits immediately after the source phrase.
        const p = el.querySelector('p')!;
        const idx = Array.from(p.childNodes).indexOf(chip!);
        const prevText = (p.childNodes[idx - 1] as Text).data;
        expect(prevText.endsWith('GroupedGEMM')).toBe(true);
    });

    it('applies the error variant class + testid prefix so the outside-click guard treats it as a chip', () => {
        const el = makeContainer('<p>alpha beta gamma</p>');
        const chip = injectInlineChip(el, rangeOf(el, 'beta'), {
            id: 'e', label: 'oops', fullText: 'beta', isError: true, onActivate: () => {},
        });
        expect(chip!.className).toContain(SIDENOTE_INLINE_ERROR_CLASS);
        // Shared prefix with footer chips (data-testid^="quick-ask-chip").
        expect(chip!.getAttribute('data-testid')!.startsWith('quick-ask-chip')).toBe(true);
    });

    it('calls onActivate with the chip element on click and stops propagation', () => {
        const el = makeContainer('<p>alpha beta gamma</p>');
        const onActivate = vi.fn();
        const parentClick = vi.fn();
        el.addEventListener('click', parentClick);
        const chip = injectInlineChip(el, rangeOf(el, 'beta'), { id: 'x', label: 'b', fullText: 'beta', onActivate });

        chip!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(onActivate).toHaveBeenCalledTimes(1);
        expect(onActivate).toHaveBeenCalledWith(chip);
        // stopPropagation: the container's own click listener must not fire.
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('leaves the caller-supplied range intact (a collapsed clone is used)', () => {
        const el = makeContainer('<p>alpha beta gamma</p>');
        const range = rangeOf(el, 'beta');
        injectInlineChip(el, range, { id: 'x', label: 'b', fullText: 'beta', onActivate: () => {} });
        // The original range still selects the source phrase.
        expect(range.toString()).toBe('beta');
    });

    it('sets data-tip to the full selected text, independent of the (possibly truncated) label', () => {
        const el = makeContainer('<p>alpha beta gamma</p>');
        const chip = injectInlineChip(el, rangeOf(el, 'beta'), {
            id: 'x', label: 'b…', fullText: 'beta gamma delta epsilon', onActivate: () => {},
        });
        expect(chip!.getAttribute('data-tip')).toBe('beta gamma delta epsilon');
        // Native title/aria-label fallback is untouched by the new attribute.
        expect(chip!.getAttribute('title')).toBe('b…');
    });

    it('collapses whitespace and caps data-tip to 140 chars for a very long selection', () => {
        const el = makeContainer('<p>alpha beta gamma</p>');
        const long = 'word '.repeat(60).trim(); // 60 * 5 - 1 = 299 chars, collapses to itself
        const chip = injectInlineChip(el, rangeOf(el, 'beta'), {
            id: 'x', label: 'b', fullText: `line one\n\n  line   two  ${long}`, onActivate: () => {},
        });
        const tip = chip!.getAttribute('data-tip')!;
        expect(tip.length).toBeLessThanOrEqual(141); // 140 chars + trailing ellipsis
        expect(tip.endsWith('…')).toBe(true);
        expect(tip).not.toContain('\n');
        expect(tip).not.toContain('  ');
    });
});

describe('clearInlineChips', () => {
    it('removes every marker and normalizes the split text nodes back together', () => {
        const el = makeContainer('<p>one two three</p>');
        injectInlineChip(el, rangeOf(el, 'two'), { id: 'a', label: 't', fullText: 'two', onActivate: () => {} });
        expect(chips(el)).toHaveLength(1);

        clearInlineChips(el);

        expect(chips(el)).toHaveLength(0);
        expect(el.textContent).toBe('one two three');
        // normalize() merged the halves the insertion split.
        expect(el.querySelector('p')!.childNodes).toHaveLength(1);
    });

    it('is a no-op with no markers and tolerates a null container', () => {
        const el = makeContainer('<p>nothing to clear</p>');
        expect(() => clearInlineChips(el)).not.toThrow();
        expect(el.querySelector('p')!.childNodes).toHaveLength(1);
        expect(() => clearInlineChips(null)).not.toThrow();
    });

    it('removes multiple markers injected at different phrases', () => {
        const el = makeContainer('<p>alpha beta gamma delta</p>');
        injectInlineChip(el, rangeOf(el, 'beta'), { id: 'a', label: 'b', fullText: 'beta', onActivate: () => {} });
        injectInlineChip(el, rangeOf(el, 'delta'), { id: 'b', label: 'd', fullText: 'delta', onActivate: () => {} });
        expect(chips(el)).toHaveLength(2);
        clearInlineChips(el);
        expect(chips(el)).toHaveLength(0);
        expect(el.textContent).toBe('alpha beta gamma delta');
    });
});
