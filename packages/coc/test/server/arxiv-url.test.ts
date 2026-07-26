/**
 * arXiv URL recognition tests (Goal 3, pure).
 */

import { describe, expect, it } from 'vitest';
import { recognizeArxivUrl, arxivIdToFilename } from '../../src/server/notes/arxiv-url';

describe('recognizeArxivUrl', () => {
    it('recognizes a canonical /pdf/ URL', () => {
        const r = recognizeArxivUrl('https://arxiv.org/pdf/1802.05799');
        expect(r).not.toBeNull();
        expect(r!.arxivId).toBe('1802.05799');
        expect(r!.arxivIdBase).toBe('1802.05799');
        expect(r!.version).toBeUndefined();
        expect(r!.pdfUrl).toBe('https://arxiv.org/pdf/1802.05799');
        expect(r!.absUrl).toBe('https://arxiv.org/abs/1802.05799');
        expect(r!.filename).toBe('1802.05799');
    });

    it('recognizes a versioned /pdf/ URL with a .pdf suffix', () => {
        const r = recognizeArxivUrl('https://arxiv.org/pdf/1802.05799v3.pdf');
        expect(r!.arxivId).toBe('1802.05799v3');
        expect(r!.version).toBe('v3');
        expect(r!.pdfUrl).toBe('https://arxiv.org/pdf/1802.05799v3');
    });

    it('recognizes an /abs/ URL and normalizes to the pdf URL', () => {
        const r = recognizeArxivUrl('http://arxiv.org/abs/2301.00001v2');
        expect(r!.arxivId).toBe('2301.00001v2');
        expect(r!.pdfUrl).toBe('https://arxiv.org/pdf/2301.00001v2');
    });

    it('recognizes a www. host and a 5-digit article number', () => {
        const r = recognizeArxivUrl('https://www.arxiv.org/pdf/2401.12345');
        expect(r!.arxivId).toBe('2401.12345');
    });

    it('recognizes an old-style identifier with a subclass', () => {
        const r = recognizeArxivUrl('https://arxiv.org/abs/hep-th/9901001');
        expect(r!.arxivId).toBe('hep-th/9901001');
        expect(r!.filename).toBe('hep-th_9901001');
        expect(r!.pdfUrl).toBe('https://arxiv.org/pdf/hep-th/9901001');
    });

    it('recognizes the arXiv: identifier scheme', () => {
        const r = recognizeArxivUrl('arXiv:1802.05799');
        expect(r!.arxivId).toBe('1802.05799');
    });

    it('trims surrounding whitespace', () => {
        const r = recognizeArxivUrl('   https://arxiv.org/pdf/1802.05799   ');
        expect(r!.arxivId).toBe('1802.05799');
    });

    it('rejects a non-arxiv URL even if it contains an arxiv-looking number', () => {
        expect(recognizeArxivUrl('https://example.com/pdf/1802.05799')).toBeNull();
    });

    it('rejects unrelated input', () => {
        expect(recognizeArxivUrl('https://arxiv.org/list/cs.LG/recent')).toBeNull();
        expect(recognizeArxivUrl('not a url')).toBeNull();
        expect(recognizeArxivUrl('')).toBeNull();
        expect(recognizeArxivUrl(undefined)).toBeNull();
        expect(recognizeArxivUrl(42 as unknown)).toBeNull();
    });
});

describe('arxivIdToFilename', () => {
    it('replaces slashes and strips unsafe characters', () => {
        expect(arxivIdToFilename('hep-th/9901001')).toBe('hep-th_9901001');
        expect(arxivIdToFilename('1802.05799v3')).toBe('1802.05799v3');
        expect(arxivIdToFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    });
});
