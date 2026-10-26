import { describe, expect, it, vi } from 'vitest';
import { faviconCandidates, faviconDataUrl, loadBrowserFavicon, MAX_BROWSER_FAVICON_BYTES, sniffFavicon, validBrowserFavicon } from '../src/browser-favicon';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const SVG = Buffer.from('<?xml version="1.0"?><!-- icon --><svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('favicon policy', () => {
    it('identifies icons by their bytes, never by declared type', () => {
        expect(sniffFavicon(PNG)).toBe('png');
        expect(sniffFavicon(ICO)).toBe('x-icon');
        expect(sniffFavicon(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
        expect(sniffFavicon(Buffer.from('GIF89a'))).toBe('gif');
        expect(sniffFavicon(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
        expect(sniffFavicon(SVG)).toBe('svg+xml');
        expect(sniffFavicon(Buffer.from('<html><svg></svg></html>'))).toBeUndefined();
        expect(sniffFavicon(Buffer.from('<script>alert(1)</script>'))).toBeUndefined();
        expect(sniffFavicon(Buffer.alloc(0))).toBeUndefined();
    });

    it('builds bounded data URLs and re-validates them at the IPC boundary', () => {
        const icon = faviconDataUrl(PNG)!;
        expect(icon).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
        expect(validBrowserFavicon(icon)).toBe(true);
        expect(validBrowserFavicon(faviconDataUrl(SVG))).toBe(true);
        expect(faviconDataUrl(Buffer.concat([PNG, Buffer.alloc(MAX_BROWSER_FAVICON_BYTES)]))).toBeUndefined();
        expect(faviconDataUrl(Buffer.from('not an image'))).toBeUndefined();
        expect(validBrowserFavicon(icon.replace('image/png', 'image/gif'))).toBe(false);
        expect(validBrowserFavicon(`data:image/svg+xml;base64,${Buffer.from('<p>x</p>').toString('base64')}`)).toBe(false);
        expect(validBrowserFavicon('https://example.test/favicon.ico')).toBe(false);
        expect(validBrowserFavicon(`${icon}"><img src=x>`)).toBe(false);
        expect(validBrowserFavicon(undefined)).toBe(false);
    });

    it('requests only HTTP(S) icons without credentials, plus inline data, at most three', () => {
        expect(faviconCandidates([
            'javascript:alert(1)', 'file:///etc/passwd', 'chrome://favicon/', 'https://u:p@example.test/a.ico', 42,
            'https://example.test/a.ico', 'https://example.test/a.ico', 'http://example.test/b.png', 'data:image/png;base64,AA==', 'https://example.test/c.ico',
        ])).toEqual(['https://example.test/a.ico', 'http://example.test/b.png', 'data:image/png;base64,AA==']);
    });

    it('falls through failed, oversized and non-image candidates to the first usable icon', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response('missing', { status: 404 }))
            .mockResolvedValueOnce(new Response(Buffer.alloc(10), { status: 200, headers: { 'content-length': String(MAX_BROWSER_FAVICON_BYTES + 1) } }))
            .mockResolvedValueOnce(new Response(ICO, { status: 200, headers: { 'content-type': 'text/html' } }));
        const icon = await loadBrowserFavicon(fetch, ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'], new AbortController().signal);
        expect(icon).toBe(`data:image/x-icon;base64,${ICO.toString('base64')}`);
        expect(fetch).toHaveBeenCalledTimes(3);
        const streamed = vi.fn().mockResolvedValue(new Response(Buffer.alloc(MAX_BROWSER_FAVICON_BYTES + 1, 0x89), { status: 200 }));
        expect(await loadBrowserFavicon(streamed, ['https://a.test/big'], new AbortController().signal)).toBeUndefined();
        const failing = vi.fn().mockRejectedValue(new Error('offline'));
        expect(await loadBrowserFavicon(failing, ['https://a.test/x'], new AbortController().signal)).toBeUndefined();
    });

    it('decodes inline data icons locally and makes no request once aborted', async () => {
        const fetch = vi.fn();
        expect(await loadBrowserFavicon(fetch, [`data:image/png;base64,${PNG.toString('base64')}`], new AbortController().signal))
            .toBe(`data:image/png;base64,${PNG.toString('base64')}`);
        const controller = new AbortController();
        controller.abort();
        expect(await loadBrowserFavicon(fetch, ['https://a.test/favicon.ico'], controller.signal)).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });
});
