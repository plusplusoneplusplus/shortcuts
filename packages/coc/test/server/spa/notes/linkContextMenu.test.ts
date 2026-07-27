// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getLinkHrefFromEventTarget } from '../../../../src/server/spa/client/react/features/notes/editor/linkContextMenu';

describe('getLinkHrefFromEventTarget', () => {
    it('returns the raw href when the target is an anchor', () => {
        const a = document.createElement('a');
        a.setAttribute('href', 'https://example.com/page');
        a.textContent = 'link';
        expect(getLinkHrefFromEventTarget(a)).toBe('https://example.com/page');
    });

    it('returns the href when the target is a descendant of an anchor', () => {
        const a = document.createElement('a');
        a.setAttribute('href', 'mailto:me@example.com');
        const span = document.createElement('span');
        span.textContent = 'inner';
        a.appendChild(span);
        expect(getLinkHrefFromEventTarget(span)).toBe('mailto:me@example.com');
    });

    it('preserves relative hrefs (raw attribute, not resolved URL)', () => {
        const a = document.createElement('a');
        a.setAttribute('href', './docs/readme.md');
        expect(getLinkHrefFromEventTarget(a)).toBe('./docs/readme.md');
    });

    it('returns null when the target is not inside a link', () => {
        const p = document.createElement('p');
        p.textContent = 'plain text';
        expect(getLinkHrefFromEventTarget(p)).toBeNull();
    });

    it('returns null for an anchor without an href attribute', () => {
        const a = document.createElement('a');
        a.textContent = 'no href';
        expect(getLinkHrefFromEventTarget(a)).toBeNull();
    });

    it('returns null for an anchor with a blank href', () => {
        const a = document.createElement('a');
        a.setAttribute('href', '   ');
        expect(getLinkHrefFromEventTarget(a)).toBeNull();
    });

    it('returns null for a null / non-Element target', () => {
        expect(getLinkHrefFromEventTarget(null)).toBeNull();
        expect(getLinkHrefFromEventTarget(document.createTextNode('t') as unknown as EventTarget)).toBeNull();
    });
});
