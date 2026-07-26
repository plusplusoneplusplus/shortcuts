import { describe, expect, it } from 'vitest';
import {
    paperTextPathFromPdfUrl,
    formatPaperChatGrounding,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/paperChatGrounding';

describe('paperTextPathFromPdfUrl', () => {
    it('maps a cached-paper embed URL (relative inline node attr) to its .txt sidecar', () => {
        const url = '/api/workspaces/ws1/notes/image?path=.papers%2F1802.05799.pdf';
        expect(paperTextPathFromPdfUrl(url)).toBe('.papers/1802.05799.txt');
    });

    it('maps an absolute full-window href to its .txt sidecar', () => {
        const url = 'http://localhost:3000/api/workspaces/ws1/notes/image?path=.papers%2F1802.05799.pdf&root=proj';
        expect(paperTextPathFromPdfUrl(url)).toBe('.papers/1802.05799.txt');
    });

    it('preserves the paper id when swapping the extension (uppercase .PDF too)', () => {
        const url = '/api/workspaces/ws1/notes/image?path=.papers%2Fmath.CO_0611.PDF';
        expect(paperTextPathFromPdfUrl(url)).toBe('.papers/math.CO_0611.txt');
    });

    it('returns undefined for a non-cached PDF (uploaded attachment)', () => {
        const url = '/api/workspaces/ws1/notes/image?path=.attachments%2Fsample.pdf';
        expect(paperTextPathFromPdfUrl(url)).toBeUndefined();
    });

    it('returns undefined for an external hotlink and for empty input', () => {
        expect(paperTextPathFromPdfUrl('https://files.example/sample.pdf')).toBeUndefined();
        expect(paperTextPathFromPdfUrl('')).toBeUndefined();
        expect(paperTextPathFromPdfUrl(undefined)).toBeUndefined();
    });

    it('returns undefined when the cached path attempts traversal or nesting', () => {
        expect(paperTextPathFromPdfUrl('/api/x?path=.papers%2F..%2Fsecret.pdf')).toBeUndefined();
        expect(paperTextPathFromPdfUrl('/api/x?path=.papers%2Fsub%2Fpaper.pdf')).toBeUndefined();
    });
});

describe('formatPaperChatGrounding', () => {
    it('wraps the sidecar path in a readable paper_reference directive', () => {
        const out = formatPaperChatGrounding('.papers/1802.05799.txt');
        expect(out).toContain('<paper_reference path=".papers/1802.05799.txt">');
        expect(out).toContain('`.papers/1802.05799.txt`');
        expect(out).toContain('Read that file with your file tools');
        expect(out).toContain('</paper_reference>');
        // Trailing blank line separates it from the user's typed question.
        expect(out.endsWith('\n\n')).toBe(true);
    });

    it('returns an empty string for a blank path so callers can safely concat', () => {
        expect(formatPaperChatGrounding('')).toBe('');
        expect(formatPaperChatGrounding('   ')).toBe('');
    });
});
