/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import {
    findComposerEditable,
    textOffsetFromPoint,
    textOffsetOfCaret,
} from '../../../src/server/spa/client/react/features/chat/filePathDropCaret';

afterEach(() => {
    document.body.innerHTML = '';
    delete (document as any).caretRangeFromPoint;
    delete (document as any).caretPositionFromPoint;
});

function makeEditor(html: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-rich-input', '');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

describe('textOffsetOfCaret', () => {
    it('sums the text preceding the caret node', () => {
        const el = makeEditor('<span>abc</span><span>defg</span>');
        const second = el.childNodes[1].firstChild!;
        expect(textOffsetOfCaret(el, second, 2)).toBe(5);
    });

    it('treats an element offset as a child index', () => {
        const el = makeEditor('<span>abc</span><span>defg</span>');
        expect(textOffsetOfCaret(el, el, 1)).toBe(3);
        expect(textOffsetOfCaret(el, el, 2)).toBe(7);
    });

    it('clamps past-the-end offsets to the editor length', () => {
        const el = makeEditor('abc');
        expect(textOffsetOfCaret(el, el.firstChild!, 99)).toBe(3);
    });

    it('returns null when the node is outside the editor', () => {
        const el = makeEditor('abc');
        const outside = document.createElement('div');
        outside.textContent = 'zz';
        document.body.appendChild(outside);
        expect(textOffsetOfCaret(el, outside.firstChild!, 1)).toBeNull();
    });
});

describe('textOffsetFromPoint', () => {
    it('returns null when the browser implements neither caret API (jsdom)', () => {
        const el = makeEditor('abc');
        expect(textOffsetFromPoint(el, 10, 10)).toBeNull();
        expect(textOffsetFromPoint(null, 10, 10)).toBeNull();
    });

    it('uses caretRangeFromPoint when available', () => {
        const el = makeEditor('abcdef');
        const range = document.createRange();
        range.setStart(el.firstChild!, 4);
        (document as any).caretRangeFromPoint = () => range;
        expect(textOffsetFromPoint(el, 5, 5)).toBe(4);
    });

    it('falls back to caretPositionFromPoint', () => {
        const el = makeEditor('abcdef');
        (document as any).caretPositionFromPoint = () => ({ offsetNode: el.firstChild, offset: 2 });
        expect(textOffsetFromPoint(el, 5, 5)).toBe(2);
    });

    it('returns null when the point resolves outside the editor', () => {
        const el = makeEditor('abcdef');
        const outside = document.createElement('div');
        outside.textContent = 'zz';
        document.body.appendChild(outside);
        (document as any).caretPositionFromPoint = () => ({ offsetNode: outside.firstChild, offset: 1 });
        expect(textOffsetFromPoint(el, 5, 5)).toBeNull();
    });

    it('returns null when the caret API throws', () => {
        const el = makeEditor('abcdef');
        (document as any).caretRangeFromPoint = () => { throw new Error('boom'); };
        expect(textOffsetFromPoint(el, 5, 5)).toBeNull();
    });
});

describe('findComposerEditable', () => {
    it('finds the contentEditable inside a composer container', () => {
        const container = document.createElement('div');
        const editable = document.createElement('div');
        editable.setAttribute('data-rich-input', '');
        container.appendChild(editable);
        expect(findComposerEditable(container)).toBe(editable);
        expect(findComposerEditable(null)).toBeNull();
        expect(findComposerEditable(document.createElement('div'))).toBeNull();
    });
});
