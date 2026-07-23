import { describe, expect, it } from 'vitest';
import {
    classifyPdfBlockUrl,
    type PdfBlockUrlClassification,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlockUrl';

const APP_ORIGIN = 'https://coc.example';

function normalized(rawUrl: string): string {
    return new URL(rawUrl, APP_ORIGIN).href;
}

describe('classifyPdfBlockUrl', () => {
    it.each([
        '/api/workspaces/ws%2Fspecial/notes/image?path=.attachments%2Fsample.pdf',
        '/api/workspaces/ws-2/notes/image?path=.images%2Fsample.PDF&root=repo-root',
        `/api/workspaces/ws-3/notes/local-image?path=${encodeURIComponent('C:\\notes\\sample.pdf')}`,
    ])('allows a same-origin Notes PDF route inline: %s', (rawUrl) => {
        expect(classifyPdfBlockUrl(rawUrl, APP_ORIGIN)).toEqual({
            kind: 'inline',
            href: normalized(rawUrl),
        });
    });

    it.each([
        '/api/workspaces/ws-1/notes/image?path=.attachments%2Fsample.png',
        '/api/workspaces/ws-1/notes/image',
        '/api/workspaces/ws-1/notes/image?path=first.pdf&path=second.pdf',
        '/api/workspaces/ws-1/notes/image/?path=.attachments%2Fsample.pdf',
        '/api/workspaces/ws-1/notes/image?path=.attachments%2Fsample.pdf%23payload',
        '/api/workspaces/ws-1/notes/image?path=.attachments%2Fsample.pdf%3Fpayload',
        '/api/workspaces/ws-1/notes/image?path=.attachments%2Fsample.pdf%20',
    ])('rejects a Notes route that is not one exact PDF request: %s', (rawUrl) => {
        expect(classifyPdfBlockUrl(rawUrl, APP_ORIGIN)).toEqual({ kind: 'invalid' });
    });

    it.each([
        'report.pdf',
        '/documents/report.PDF?download=1#page=2',
        '//files.example/report.pdf',
        'https://files.example/report.pdf?download=1',
    ])('keeps other HTTP(S) PDF URLs link-only: %s', (rawUrl) => {
        expect(classifyPdfBlockUrl(rawUrl, APP_ORIGIN)).toEqual({
            kind: 'link',
            href: normalized(rawUrl),
        });
    });

    it('returns a normalized parsed URL for valid links', () => {
        const result = classifyPdfBlockUrl('HTTPS://FILES.EXAMPLE:443/report.pdf', APP_ORIGIN);
        expect(result).toEqual({
            kind: 'link',
            href: 'https://files.example/report.pdf',
        } satisfies PdfBlockUrlClassification);
    });

    it.each([
        'javascript:alert(1)',
        'data:application/pdf;base64,JVBERi0xLjQ=',
        'blob:https://coc.example/8bbcefb8-c7d3-4de1-b7f2-a5097330f13c',
        'https://user:password@files.example/report.pdf',
        'http://[::1',
        'https://files.example/report.txt',
        'https://files.example/api/workspaces/ws-1/notes/image?path=sample.pdf',
    ])('rejects an unsafe, malformed, or non-PDF URL: %s', (rawUrl) => {
        expect(classifyPdfBlockUrl(rawUrl, APP_ORIGIN)).toEqual({ kind: 'invalid' });
    });
});
