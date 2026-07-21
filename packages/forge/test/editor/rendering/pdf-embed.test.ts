import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PDF_EMBED_HEIGHT,
    MAX_PDF_EMBED_HEIGHT,
    MIN_PDF_EMBED_HEIGHT,
    isPdfUrl,
} from '../../../src/editor/rendering/pdf-embed';

describe('isPdfUrl', () => {
    it('accepts relative attachment paths ending in .pdf', () => {
        expect(isPdfUrl('.attachments/sample.pdf')).toBe(true);
        expect(isPdfUrl('.images/doc.pdf')).toBe(true);
    });

    it('accepts absolute URLs ending in .pdf', () => {
        expect(isPdfUrl('https://example.com/files/report.pdf')).toBe(true);
    });

    it('is case-insensitive on the extension', () => {
        expect(isPdfUrl('doc.PDF')).toBe(true);
        expect(isPdfUrl('doc.Pdf')).toBe(true);
    });

    it('tolerates query strings and fragments', () => {
        expect(isPdfUrl('.attachments/x.pdf?v=2')).toBe(true);
        expect(isPdfUrl('/api/notes/image?path=.attachments%2Fx.pdf')).toBe(false);
        expect(isPdfUrl('doc.pdf#page=3')).toBe(true);
        expect(isPdfUrl('doc.pdf?download=1#page=3')).toBe(true);
    });

    it('trims surrounding whitespace', () => {
        expect(isPdfUrl('  .attachments/x.pdf  ')).toBe(true);
    });

    it('rejects non-pdf URLs', () => {
        expect(isPdfUrl('.attachments/x.png')).toBe(false);
        expect(isPdfUrl('https://example.com/report.html')).toBe(false);
        expect(isPdfUrl('report.pdf.png')).toBe(false);
    });

    it('rejects empty / nullish input', () => {
        expect(isPdfUrl('')).toBe(false);
        expect(isPdfUrl('   ')).toBe(false);
        expect(isPdfUrl(null)).toBe(false);
        expect(isPdfUrl(undefined)).toBe(false);
    });

    it('exports pdf height limits', () => {
        expect(DEFAULT_PDF_EMBED_HEIGHT).toBe(480);
        expect(MIN_PDF_EMBED_HEIGHT).toBeLessThan(DEFAULT_PDF_EMBED_HEIGHT);
        expect(MAX_PDF_EMBED_HEIGHT).toBeGreaterThan(DEFAULT_PDF_EMBED_HEIGHT);
    });
});
