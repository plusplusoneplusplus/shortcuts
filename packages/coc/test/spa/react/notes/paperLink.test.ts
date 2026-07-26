import { describe, it, expect } from 'vitest';
import {
    classifyPaperLink,
    isPaperLinkHref,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperLink';

describe('classifyPaperLink / isPaperLinkHref', () => {
    it('recognizes arXiv URLs in all forms', () => {
        const forms = [
            'https://arxiv.org/pdf/2104.04473',
            'https://arxiv.org/pdf/2104.04473.pdf',
            'https://arxiv.org/pdf/2104.04473v3',
            'https://arxiv.org/pdf/2104.04473v3.pdf',
            'http://arxiv.org/abs/2104.04473',
            'https://www.arxiv.org/pdf/math.GT/0309136',
            'arXiv:2104.04473',
        ];
        for (const href of forms) {
            const info = classifyPaperLink(href);
            expect(info, href).not.toBeNull();
            expect(info?.kind, href).toBe('arxiv');
            expect(info?.href, href).toBe(href);
            expect(info?.arxiv?.arxivIdBase, href).toBeTruthy();
        }
    });

    it('recognizes any URL whose path ends in .pdf', () => {
        const info = classifyPaperLink('https://example.com/papers/integration.pdf');
        expect(info).not.toBeNull();
        expect(info?.kind).toBe('pdf');
        expect(info?.arxiv).toBeUndefined();
        // Tolerant of query/fragment.
        expect(isPaperLinkHref('https://example.com/doc.pdf?dl=1#page=2')).toBe(true);
    });

    it('trims surrounding whitespace before classifying', () => {
        const info = classifyPaperLink('  https://arxiv.org/pdf/2104.04473  ');
        expect(info?.kind).toBe('arxiv');
        expect(info?.href).toBe('https://arxiv.org/pdf/2104.04473');
    });

    it('does NOT match YouTube URLs', () => {
        expect(isPaperLinkHref('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
        expect(isPaperLinkHref('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
    });

    it('does NOT match embeddable map URLs', () => {
        expect(isPaperLinkHref('https://www.google.com/maps/place/Eiffel+Tower')).toBe(false);
    });

    it('does NOT match plain non-paper links', () => {
        expect(isPaperLinkHref('https://example.com/article')).toBe(false);
        expect(isPaperLinkHref('https://example.com/pdf/2104.04473')).toBe(false); // not arXiv-hosted, no .pdf ext
        expect(isPaperLinkHref('2104.04473')).toBe(false); // bare id, no host
    });

    it('rejects empty / non-string input', () => {
        expect(isPaperLinkHref('')).toBe(false);
        expect(isPaperLinkHref('   ')).toBe(false);
        expect(isPaperLinkHref(undefined)).toBe(false);
        expect(isPaperLinkHref(null)).toBe(false);
        expect(isPaperLinkHref(42)).toBe(false);
        expect(classifyPaperLink({})).toBeNull();
    });
});
