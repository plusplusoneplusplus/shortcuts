/**
 * Site icons for browser tab headers.
 *
 * Icon URLs and bytes come from the page and are untrusted. Main only hands the
 * SPA a bounded `data:image/...` URL whose bytes match a known image signature,
 * so the SPA never requests a page-chosen URL and needs no CSP change. SVG is
 * allowed because an `<img>` renders it without scripts or subresources.
 */

export const MAX_BROWSER_FAVICON_BYTES = 64 * 1024;
const FAVICON_FETCH_TIMEOUT_MS = 10_000;
const MAX_FAVICON_CANDIDATES = 3;

type FaviconType = 'png' | 'jpeg' | 'gif' | 'webp' | 'x-icon' | 'bmp' | 'svg+xml';

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
    return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Identify an image by its bytes, never by a server-declared type. */
export function sniffFavicon(bytes: Uint8Array): FaviconType | undefined {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
    if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) || startsWith(bytes, [0x00, 0x00, 0x02, 0x00])) return 'x-icon';
    if (startsWith(bytes, [0x42, 0x4d])) return 'bmp';
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^﻿/, '');
    // XML declaration, comments and doctype may precede the root element.
    const root = text.replace(/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '');
    if (/^<svg[\s>]/i.test(root)) return 'svg+xml';
    return undefined;
}

/** A bounded, signature-checked data URL, or undefined for anything else. */
export function faviconDataUrl(bytes: Uint8Array): string | undefined {
    if (bytes.length === 0 || bytes.length > MAX_BROWSER_FAVICON_BYTES) return undefined;
    const type = sniffFavicon(bytes);
    return type ? `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}` : undefined;
}

const DATA_URL = /^data:image\/(png|jpeg|gif|webp|x-icon|bmp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Re-validate a favicon at the IPC boundary: only our own data URL form passes. */
export function validBrowserFavicon(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > MAX_BROWSER_FAVICON_BYTES * 2) return false;
    const match = DATA_URL.exec(value);
    if (!match) return false;
    const bytes = Buffer.from(match[2], 'base64');
    return bytes.length > 0 && bytes.length <= MAX_BROWSER_FAVICON_BYTES && sniffFavicon(bytes) === match[1];
}

/** Page-declared icon locations worth requesting: HTTP(S) without credentials, or inline data. */
export function faviconCandidates(urls: readonly unknown[]): string[] {
    const candidates: string[] = [];
    for (const value of urls) {
        if (typeof value !== 'string' || value.length > MAX_BROWSER_FAVICON_BYTES * 2) continue;
        let url: URL;
        try { url = new URL(value); } catch { continue; }
        const network = (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
        if ((network ? value.length <= 8192 : url.protocol === 'data:') && !candidates.includes(value)) candidates.push(value);
        if (candidates.length === MAX_FAVICON_CANDIDATES) break;
    }
    return candidates;
}

async function readBounded(response: Response): Promise<Uint8Array | undefined> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BROWSER_FAVICON_BYTES) return undefined;
    if (!response.body) return undefined;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_BROWSER_FAVICON_BYTES) return undefined;
            chunks.push(value);
        }
    } finally {
        void reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
}

/**
 * Load the first usable icon through `fetch` (the engine profile's network stack).
 * Failures, oversize bodies and non-images all yield undefined so the tab keeps its globe.
 */
export async function loadBrowserFavicon(
    fetch: (url: string, init: RequestInit) => Promise<Response>,
    urls: readonly unknown[],
    signal: AbortSignal,
): Promise<string | undefined> {
    for (const url of faviconCandidates(urls)) {
        if (signal.aborted) return undefined;
        try {
            if (url.startsWith('data:')) {
                const comma = url.indexOf(',');
                const header = url.slice(5, comma);
                if (comma < 0 || !header.endsWith(';base64')) continue;
                const icon = faviconDataUrl(Buffer.from(url.slice(comma + 1), 'base64'));
                if (icon) return icon;
                continue;
            }
            const response = await fetch(url, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(FAVICON_FETCH_TIMEOUT_MS)]),
                redirect: 'follow',
            });
            if (!response.ok) { void response.body?.cancel().catch(() => {}); continue; }
            const bytes = await readBounded(response);
            const icon = bytes && faviconDataUrl(bytes);
            if (icon) return icon;
        } catch {
            // Network, abort and timeout failures fall through to the next candidate.
        }
    }
    return undefined;
}
