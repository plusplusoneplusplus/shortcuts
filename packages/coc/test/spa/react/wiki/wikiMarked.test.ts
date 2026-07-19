/**
 * Representative-consumer coverage for the Wiki renderer family. Unlike chat /
 * AskUser / PR (bundled npm `Marked`), the Wiki renders through the CDN-loaded
 * global `marked`. This verifies the shared KaTeX math extension is registered
 * on that global so Wiki articles and answers render math consistently (AC-01).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Marked } from 'marked';
import {
    tryParseWikiMarkdown,
    __resetWikiMathRegistration,
} from '../../../../src/server/spa/client/react/wiki/wikiMarked';

describe('wikiMarked — global marked math wiring', () => {
    beforeEach(() => {
        __resetWikiMathRegistration();
    });

    afterEach(() => {
        delete (globalThis as { marked?: unknown }).marked;
        __resetWikiMathRegistration();
    });

    function installGlobalMarked(): void {
        // A fresh npm Marked instance stands in for the CDN global `marked`.
        (globalThis as { marked?: unknown }).marked = new Marked();
    }

    it('returns null when the global marked script has not loaded', () => {
        expect(tryParseWikiMarkdown('$x = y$')).toBeNull();
    });

    it('renders inline math through the registered extension', () => {
        installGlobalMarked();
        const html = tryParseWikiMarkdown('when $x = y$ holds');
        expect(html).toContain('class="katex"');
        expect(html).toContain('holds');
    });

    it('renders display math from $$...$$', () => {
        installGlobalMarked();
        const html = tryParseWikiMarkdown('$$\\int_0^1 x\\,dx$$');
        expect(html).toContain('katex-display');
    });

    it('renders display math from \\[...\\]', () => {
        installGlobalMarked();
        const html = tryParseWikiMarkdown('\\[a^2 + b^2 = c^2\\]');
        expect(html).toContain('katex-display');
    });

    it('leaves currency and code untouched', () => {
        installGlobalMarked();
        const html = tryParseWikiMarkdown('it costs $5 and `$x` stays literal');
        expect(html).not.toContain('class="katex"');
        expect(html).toContain('$5');
    });

    it('does not throw when the global marked lacks a use() method', () => {
        (globalThis as { marked?: unknown }).marked = {
            parse: (md: string) => `<p>${md}</p>`,
        };
        // No use() → math simply not registered, but article still renders.
        expect(() => tryParseWikiMarkdown('$x$')).not.toThrow();
        expect(tryParseWikiMarkdown('plain')).toBe('<p>plain</p>');
    });

    it('registers the extension only once across calls', () => {
        let useCount = 0;
        const base = new Marked();
        (globalThis as { marked?: unknown }).marked = {
            parse: (md: string) => base.parse(md) as string,
            use: (ext: unknown) => {
                useCount += 1;
                base.use(ext as never);
            },
        };
        tryParseWikiMarkdown('$x$');
        tryParseWikiMarkdown('$y$');
        tryParseWikiMarkdown('$z$');
        expect(useCount).toBe(1);
    });
});
