import { describe, it, expect } from 'vitest';
import { isLikelyArxivUrl } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/arxivPaste';

describe('isLikelyArxivUrl', () => {
    it('recognizes canonical arXiv PDF / abstract URLs', () => {
        expect(isLikelyArxivUrl('https://arxiv.org/pdf/1802.05799')).toBe(true);
        expect(isLikelyArxivUrl('https://arxiv.org/pdf/1802.05799v3.pdf')).toBe(true);
        expect(isLikelyArxivUrl('http://arxiv.org/abs/1802.05799v2')).toBe(true);
        expect(isLikelyArxivUrl('https://www.arxiv.org/pdf/math.GT/0309136')).toBe(true);
    });

    it('recognizes the arXiv: identifier scheme (case-insensitive)', () => {
        expect(isLikelyArxivUrl('arXiv:1802.05799')).toBe(true);
        expect(isLikelyArxivUrl('arxiv:1802.05799')).toBe(true);
    });

    it('trims surrounding whitespace on an otherwise lone token', () => {
        expect(isLikelyArxivUrl('  https://arxiv.org/pdf/1802.05799  ')).toBe(true);
    });

    it('rejects a paragraph that merely mentions an arXiv link', () => {
        expect(isLikelyArxivUrl('see https://arxiv.org/pdf/1802.05799 for details')).toBe(false);
        expect(isLikelyArxivUrl('https://arxiv.org/pdf/1802.05799\nsecond line')).toBe(false);
    });

    it('rejects non-arXiv URLs and a bare id without an arXiv host', () => {
        expect(isLikelyArxivUrl('https://example.com/pdf/1802.05799')).toBe(false);
        expect(isLikelyArxivUrl('1802.05799')).toBe(false);
        expect(isLikelyArxivUrl('https://notarxiv.org.evil.com/1802.05799')).toBe(false);
    });

    it('rejects empty / non-string input', () => {
        expect(isLikelyArxivUrl('')).toBe(false);
        expect(isLikelyArxivUrl('   ')).toBe(false);
        expect(isLikelyArxivUrl(undefined)).toBe(false);
        expect(isLikelyArxivUrl(null)).toBe(false);
        expect(isLikelyArxivUrl(42)).toBe(false);
    });
});
