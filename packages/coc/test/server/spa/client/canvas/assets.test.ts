/**
 * @vitest-environment jsdom
 *
 * Layer B — asset extraction + inlining tests.
 *
 * `collectImageRefs` is pure (tested without any network); `resolveAssets` uses
 * a Blob + FileReader (hence jsdom) and an injected fetch function so the fetch
 * path is exercised with a plain mock. Covers: ref discovery across proxy URLs /
 * `data-local-path` / `.attachments/`, ignoring remote + inlined images,
 * de-duping, correct-mime base64, mime fallbacks, single-fetch of repeated refs,
 * and fetch-failure → warning (no throw).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    collectImageRefs,
    resolveAssets,
    type AssetFetchResponse,
    type AssetFetchFn,
} from '../../../../../src/server/spa/client/react/features/canvas/html-export/assets';

/** base64 of the given bytes, computed independently of the code under test. */
function b64(bytes: number[]): string {
    return btoa(String.fromCharCode(...bytes));
}

/** Build a minimal fetch response over `bytes`. Omit `contentType` for no header. */
function makeResp(
    bytes: number[],
    opts: { ok?: boolean; contentType?: string; blobType?: string } = {},
): AssetFetchResponse {
    const { ok = true, contentType, blobType } = opts;
    const blob = new Blob([new Uint8Array(bytes)], blobType ? { type: blobType } : {});
    return {
        ok,
        headers:
            contentType === undefined
                ? null
                : { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        blob: async () => blob,
    };
}

describe('collectImageRefs', () => {
    it('collects a same-origin proxy URL from an <img> src', () => {
        const ref = '/api/workspaces/ws1/files/image?path=%2Fhome%2Fu%2Fa.png';
        expect(collectImageRefs(`<p><img src="${ref}" alt="a"></p>`)).toEqual([ref]);
    });

    it('collects a data-local-path value when the img has no src', () => {
        const html = '<img data-local-path=".attachments/abc.png" alt="a" class="chat-inline-image">';
        expect(collectImageRefs(html)).toEqual(['.attachments/abc.png']);
    });

    it('collects a relative .attachments/ src path', () => {
        const html = '<img src=".attachments/uuid.jpg">';
        expect(collectImageRefs(html)).toEqual(['.attachments/uuid.jpg']);
    });

    it('prefers a local src over data-local-path when both are present', () => {
        const html = '<img src="/api/workspaces/ws/files/image?path=x" data-local-path="/home/u/x.png">';
        expect(collectImageRefs(html)).toEqual(['/api/workspaces/ws/files/image?path=x']);
    });

    it('ignores remote http(s) and protocol-relative images (v1 leaves them external)', () => {
        const html =
            '<img src="https://cdn.example.com/a.png">' +
            '<img src="http://example.com/b.gif">' +
            '<img src="//example.com/c.webp">';
        expect(collectImageRefs(html)).toEqual([]);
    });

    it('ignores already-inlined data: and blob: images', () => {
        const html =
            '<img src="data:image/png;base64,AAAA">' +
            '<img src="blob:http://localhost/xyz">';
        expect(collectImageRefs(html)).toEqual([]);
    });

    it('de-dupes repeated references, keeping first-seen order', () => {
        const a = '/api/workspaces/ws/files/image?path=a';
        const b = '/api/workspaces/ws/files/image?path=b';
        const html = `<img src="${a}"><img src="${b}"><img src="${a}">`;
        expect(collectImageRefs(html)).toEqual([a, b]);
    });

    it('returns an empty array for empty / image-free html', () => {
        expect(collectImageRefs('')).toEqual([]);
        expect(collectImageRefs('<p>no images here</p>')).toEqual([]);
    });
});

describe('resolveAssets — inlining', () => {
    it('inlines a fetched ref as base64 with the mime from the content-type header', async () => {
        const ref = '/api/workspaces/ws/files/image?path=a';
        const bytes = [137, 80, 78, 71, 13, 10];
        const fetchFn: AssetFetchFn = async () => makeResp(bytes, { contentType: 'image/png' });
        const { assets, warnings } = await resolveAssets([ref], fetchFn);
        expect(assets.get(ref)).toBe(`data:image/png;base64,${b64(bytes)}`);
        expect(warnings).toEqual([]);
    });

    it('strips content-type parameters (charset) down to a bare mime', async () => {
        const ref = '/api/workspaces/ws/files/image?path=a';
        const bytes = [1, 2, 3];
        const fetchFn: AssetFetchFn = async () => makeResp(bytes, { contentType: 'image/svg+xml; charset=utf-8' });
        const { assets } = await resolveAssets([ref], fetchFn);
        expect(assets.get(ref)).toBe(`data:image/svg+xml;base64,${b64(bytes)}`);
    });

    it('falls back to the ref file extension when no content-type is present', async () => {
        const ref = '.attachments/pic.gif';
        const bytes = [9, 8, 7];
        const fetchFn: AssetFetchFn = async () => makeResp(bytes);
        const { assets } = await resolveAssets([ref], fetchFn);
        expect(assets.get(ref)).toBe(`data:image/gif;base64,${b64(bytes)}`);
    });

    it('derives the extension from a proxy URL path= query when no content-type', async () => {
        const ref = '/api/workspaces/ws/files/image?path=' + encodeURIComponent('/home/u/photo.jpeg');
        const bytes = [4, 5, 6];
        const fetchFn: AssetFetchFn = async () => makeResp(bytes);
        const { assets } = await resolveAssets([ref], fetchFn);
        expect(assets.get(ref)).toBe(`data:image/jpeg;base64,${b64(bytes)}`);
    });

    it('falls back to the blob type when neither header nor extension is available', async () => {
        const ref = '/api/workspaces/ws/files/image?path=noext';
        const bytes = [2, 4, 6];
        const fetchFn: AssetFetchFn = async () => makeResp(bytes, { blobType: 'image/webp' });
        const { assets } = await resolveAssets([ref], fetchFn);
        expect(assets.get(ref)).toBe(`data:image/webp;base64,${b64(bytes)}`);
    });

    it('uses application/octet-stream when the mime is entirely unknown', async () => {
        const ref = '/api/workspaces/ws/files/image?path=mystery';
        const bytes = [0, 255];
        const fetchFn: AssetFetchFn = async () => makeResp(bytes);
        const { assets } = await resolveAssets([ref], fetchFn);
        expect(assets.get(ref)).toBe(`data:application/octet-stream;base64,${b64(bytes)}`);
    });

    it('fetches each unique ref exactly once even when passed duplicates', async () => {
        const ref = '/api/workspaces/ws/files/image?path=a';
        const fetchFn = vi.fn(async () => makeResp([1, 2], { contentType: 'image/png' }));
        const { assets } = await resolveAssets([ref, ref, ref], fetchFn);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(assets.size).toBe(1);
        expect(assets.get(ref)).toContain('data:image/png;base64,');
    });

    it('keys the map by the exact ref so Layer A can look it up', async () => {
        const refs = ['/api/workspaces/ws/files/image?path=a', '.attachments/b.png'];
        const fetchFn: AssetFetchFn = async () => makeResp([1], { contentType: 'image/png' });
        const { assets } = await resolveAssets(refs, fetchFn);
        expect([...assets.keys()]).toEqual(refs);
    });
});

describe('resolveAssets — failures never throw', () => {
    it('records a warning and omits a ref when fetch rejects', async () => {
        const ref = '/api/workspaces/ws/files/image?path=a';
        const fetchFn: AssetFetchFn = async () => {
            throw new Error('network down');
        };
        const { assets, warnings } = await resolveAssets([ref], fetchFn);
        expect(assets.has(ref)).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(ref);
        expect(warnings[0]).toMatch(/network down/);
    });

    it('records a warning and omits a ref when the response is not ok', async () => {
        const ref = '/api/workspaces/ws/files/image?path=a';
        const fetchFn: AssetFetchFn = async () => makeResp([1, 2], { ok: false, contentType: 'image/png' });
        const { assets, warnings } = await resolveAssets([ref], fetchFn);
        expect(assets.has(ref)).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/not ok/i);
    });

    it('records a warning for an empty response body', async () => {
        const ref = '/api/workspaces/ws/files/image?path=a';
        const fetchFn: AssetFetchFn = async () => makeResp([], { contentType: 'image/png' });
        const { assets, warnings } = await resolveAssets([ref], fetchFn);
        expect(assets.has(ref)).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/empty/i);
    });

    it('inlines the successes and warns only for the failures in a mixed batch', async () => {
        const good = '/api/workspaces/ws/files/image?path=good';
        const bad = '/api/workspaces/ws/files/image?path=bad';
        const fetchFn: AssetFetchFn = async (ref) =>
            ref === good ? makeResp([1, 2], { contentType: 'image/png' }) : makeResp([], { ok: false });
        const { assets, warnings } = await resolveAssets([good, bad], fetchFn);
        expect(assets.has(good)).toBe(true);
        expect(assets.has(bad)).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(bad);
    });

    it('returns empty results for an empty ref list without calling fetch', async () => {
        const fetchFn = vi.fn(async () => makeResp([1]));
        const { assets, warnings } = await resolveAssets([], fetchFn);
        expect(assets.size).toBe(0);
        expect(warnings).toEqual([]);
        expect(fetchFn).not.toHaveBeenCalled();
    });
});
