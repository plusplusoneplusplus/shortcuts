import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SIDENOTE_FLASH_CLASS,
    SIDENOTE_HIGHLIGHT_ATTR,
    SIDENOTE_HIGHLIGHT_CLASS,
    clearSidenoteHighlights,
    flashTurn,
    highlightSidenoteRange,
    scrollElementIntoView,
} from '../../../../src/server/spa/client/react/features/chat/quick-ask/sidenoteHighlight';

function makeContainer(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

function spans(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(`[${SIDENOTE_HIGHLIGHT_ATTR}]`));
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('highlightSidenoteRange', () => {
    it('wraps a single-node phrase in one highlight span with the source text', () => {
        const el = makeContainer('<p>The Megatron GroupedGEMM kernel is fast.</p>');
        const text = el.textContent!;
        const from = text.indexOf('GroupedGEMM');
        const created = highlightSidenoteRange(el, from, from + 'GroupedGEMM'.length);
        expect(created).toHaveLength(1);
        expect(created[0].getAttribute(SIDENOTE_HIGHLIGHT_ATTR)).toBe('');
        expect(created[0].className).toBe(SIDENOTE_HIGHLIGHT_CLASS);
        expect(created[0].textContent).toBe('GroupedGEMM');
        // Wrapping is text-neutral: textContent is unchanged.
        expect(el.textContent).toBe(text);
    });

    it('wraps a phrase spanning inline markup in multiple spans covering the text', () => {
        const el = makeContainer('<p>The quick <strong>brown</strong> fox jumps.</p>');
        const text = el.textContent!; // "The quick brown fox jumps."
        const from = text.indexOf('brown fox');
        const created = highlightSidenoteRange(el, from, from + 'brown fox'.length);
        expect(created.length).toBeGreaterThan(1);
        expect(created.map(s => s.textContent).join('')).toBe('brown fox');
        expect(el.textContent).toBe(text);
    });

    it('returns no spans for an empty or inverted interval', () => {
        const el = makeContainer('<p>hello world</p>');
        expect(highlightSidenoteRange(el, 3, 3)).toEqual([]);
        expect(highlightSidenoteRange(el, 5, 2)).toEqual([]);
    });
});

describe('clearSidenoteHighlights', () => {
    it('unwraps every highlight span and restores clean text nodes', () => {
        const el = makeContainer('<p>The quick <strong>brown</strong> fox jumps.</p>');
        const text = el.textContent!;
        const from = text.indexOf('brown fox');
        highlightSidenoteRange(el, from, from + 'brown fox'.length);
        expect(spans(el).length).toBeGreaterThan(0);

        clearSidenoteHighlights(el);
        expect(spans(el)).toHaveLength(0);
        expect(el.textContent).toBe(text);
        // normalize() merged the split text nodes back inside <strong>.
        expect(el.querySelector('strong')!.childNodes).toHaveLength(1);
    });

    it('is a no-op when there is nothing to clear', () => {
        const el = makeContainer('<p>nothing highlighted</p>');
        expect(() => clearSidenoteHighlights(el)).not.toThrow();
        expect(() => clearSidenoteHighlights(null)).not.toThrow();
    });

    it('re-highlighting after clearing resolves against clean text', () => {
        const el = makeContainer('<p>attention here and attention there</p>');
        const text = el.textContent!;
        const first = text.indexOf('attention');
        highlightSidenoteRange(el, first, first + 'attention'.length);
        clearSidenoteHighlights(el);
        const second = text.indexOf('attention', first + 1);
        const created = highlightSidenoteRange(el, second, second + 'attention'.length);
        expect(created).toHaveLength(1);
        expect(created[0].textContent).toBe('attention');
    });
});

describe('scrollElementIntoView', () => {
    it('calls scrollIntoView when available', () => {
        const el = document.createElement('div');
        const spy = vi.fn();
        (el as HTMLElement).scrollIntoView = spy;
        scrollElementIntoView(el, { block: 'center' });
        expect(spy).toHaveBeenCalledWith({ block: 'center' });
    });

    it('is a guarded no-op when scrollIntoView is absent or element null', () => {
        const el = document.createElement('div');
        // jsdom does not define scrollIntoView on the prototype.
        expect(() => scrollElementIntoView(el)).not.toThrow();
        expect(() => scrollElementIntoView(null)).not.toThrow();
    });
});

describe('flashTurn', () => {
    it('adds the flash class and schedules its removal', () => {
        vi.useFakeTimers();
        const el = makeContainer('<p>a turn</p>');
        flashTurn(el);
        expect(el.classList.contains(SIDENOTE_FLASH_CLASS)).toBe(true);
        vi.advanceTimersByTime(1300);
        expect(el.classList.contains(SIDENOTE_FLASH_CLASS)).toBe(false);
        vi.useRealTimers();
    });

    it('is a no-op for a null container', () => {
        expect(() => flashTurn(null)).not.toThrow();
    });
});
