import { describe, expect, it } from 'vitest';
import {
    clampPdfHeight,
    createPdfHeightAttribute,
    DEFAULT_PDF_HEIGHT,
    MAX_PDF_HEIGHT,
    MIN_PDF_HEIGHT,
    parsePdfHeightAttr,
    renderPdfHeightAttr,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfHeightShared';

describe('pdfHeightShared bounds', () => {
    it('matches the CSS-derived defaults', () => {
        expect(MIN_PDF_HEIGHT).toBe(160);
        expect(MAX_PDF_HEIGHT).toBe(1200);
        expect(DEFAULT_PDF_HEIGHT).toBe(480);
    });
});

describe('clampPdfHeight', () => {
    it('clamps below the minimum up to MIN', () => {
        expect(clampPdfHeight(10)).toBe(160);
        expect(clampPdfHeight(-500)).toBe(160);
    });

    it('clamps above the maximum down to MAX', () => {
        expect(clampPdfHeight(5000)).toBe(1200);
    });

    it('rounds and passes through in-range values', () => {
        expect(clampPdfHeight(480.4)).toBe(480);
        expect(clampPdfHeight(721.6)).toBe(722);
    });
});

describe('parsePdfHeightAttr', () => {
    function elWith(value: string | null): HTMLElement {
        const el = document.createElement('div');
        if (value !== null) el.setAttribute('data-pdf-height', value);
        return el;
    }

    it('reads and clamps a valid height', () => {
        expect(parsePdfHeightAttr(elWith('720'))).toBe(720);
        expect(parsePdfHeightAttr(elWith('9999'))).toBe(1200);
        expect(parsePdfHeightAttr(elWith('5'))).toBe(160);
    });

    it('returns null when the attribute is absent or empty', () => {
        expect(parsePdfHeightAttr(elWith(null))).toBeNull();
        expect(parsePdfHeightAttr(elWith(''))).toBeNull();
    });

    it('returns null for a non-numeric value', () => {
        expect(parsePdfHeightAttr(elWith('tall'))).toBeNull();
    });
});

describe('renderPdfHeightAttr', () => {
    it('emits data-pdf-height only when set (clamped)', () => {
        expect(renderPdfHeightAttr(720)).toEqual({ 'data-pdf-height': '720' });
        expect(renderPdfHeightAttr(9999)).toEqual({ 'data-pdf-height': '1200' });
    });

    it('omits the attribute when null or undefined', () => {
        expect(renderPdfHeightAttr(null)).toEqual({});
        expect(renderPdfHeightAttr(undefined)).toEqual({});
    });
});

describe('createPdfHeightAttribute', () => {
    it('exposes a Tiptap attribute spec that round-trips through parse/render', () => {
        const spec = createPdfHeightAttribute();
        expect(spec.default).toBeNull();

        const el = document.createElement('div');
        el.setAttribute('data-pdf-height', '640');
        expect(spec.parseHTML(el)).toBe(640);
        expect(spec.renderHTML({ height: 640 })).toEqual({ 'data-pdf-height': '640' });
        expect(spec.renderHTML({ height: null })).toEqual({});
    });
});
