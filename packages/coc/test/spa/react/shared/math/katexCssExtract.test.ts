/** @vitest-environment jsdom */
/**
 * Tests for the KaTeX CSS extractor used by derived/portable outputs (canvas
 * HTML export, conversation PDF). The pure `extractKatexCss` is exercised with
 * plain fake stylesheet objects (no DOM); `getExportKatexCss` is exercised over
 * a real jsdom document plus explicit hosts, including cross-origin safety and
 * memoization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    extractKatexCss,
    getExportKatexCss,
    resetExportKatexCssCache,
} from '../../../../../src/server/spa/client/shared/math/katexCssExtract';

/** A fake style rule (has `selectorText`, no `@font-face` semantics). */
function styleRule(selectorText: string, body = '{color:red}') {
    return { cssText: `${selectorText}${body}`, selectorText };
}

/** A fake `@font-face` rule (no `selectorText`; family drives KaTeX detection). */
function fontFaceRule(fontFamily: string, src = 'url(data:font/woff2;base64,AA)') {
    return {
        cssText: `@font-face{font-family:${fontFamily};src:${src}}`,
        style: { fontFamily },
    };
}

/** Wrap rules into a single fake stylesheet. */
function sheet(...rules: unknown[]) {
    return { cssRules: rules };
}

describe('extractKatexCss (pure)', () => {
    it('keeps KaTeX class rules and drops unrelated selectors', () => {
        const css = extractKatexCss([
            sheet(
                styleRule('.katex'),
                styleRule('.katex-display', '{overflow-x:auto}'),
                styleRule('.katex .base'),
                styleRule('.app-toolbar'),
                styleRule('.mermaid-container'),
            ),
        ]);
        expect(css).toContain('.katex{');
        expect(css).toContain('.katex-display{overflow-x:auto}');
        expect(css).toContain('.katex .base{');
        expect(css).not.toContain('.app-toolbar');
        expect(css).not.toContain('.mermaid-container');
    });

    it('keeps the .math-error invalid-TeX fallback rule', () => {
        const css = extractKatexCss([sheet(styleRule('.math-error', '{color:#b00}'))]);
        expect(css).toContain('.math-error{color:#b00}');
    });

    it('keeps KaTeX @font-face rules (via style.fontFamily) and drops other fonts', () => {
        const css = extractKatexCss([
            sheet(
                fontFaceRule('KaTeX_Main'),
                fontFaceRule('KaTeX_Math'),
                fontFaceRule('Inter'),
            ),
        ]);
        expect(css).toContain('font-family:KaTeX_Main');
        expect(css).toContain('font-family:KaTeX_Math');
        expect(css).not.toContain('font-family:Inter');
    });

    it('detects a KaTeX @font-face from serialized text when style.fontFamily is absent', () => {
        const css = extractKatexCss([
            sheet({ cssText: '@font-face{font-family:"KaTeX_Size1";src:url(data:font/woff2;base64,BB)}' }),
        ]);
        expect(css).toContain('KaTeX_Size1');
    });

    it('preserves inlined data-URI fonts and introduces no external reference', () => {
        const css = extractKatexCss([sheet(fontFaceRule('KaTeX_AMS'))]);
        expect(css).toContain('data:font/woff2;base64,');
        expect(css).not.toContain('https://');
        expect(css).not.toContain('http://');
    });

    it('de-duplicates identical rules across stylesheets', () => {
        const css = extractKatexCss([
            sheet(styleRule('.katex')),
            sheet(styleRule('.katex')),
        ]);
        expect(css.match(/\.katex\{/g)?.length).toBe(1);
    });

    it('skips a cross-origin sheet whose cssRules access throws, without throwing', () => {
        const crossOrigin = {
            get cssRules() {
                throw new Error('SecurityError: cannot access cross-origin stylesheet');
            },
        };
        let css = '';
        expect(() => {
            css = extractKatexCss([crossOrigin, sheet(styleRule('.katex'))]);
        }).not.toThrow();
        expect(css).toContain('.katex{');
    });

    it('tolerates null / empty input', () => {
        expect(extractKatexCss(null)).toBe('');
        expect(extractKatexCss([])).toBe('');
        expect(extractKatexCss([{ cssRules: null }])).toBe('');
    });
});

describe('getExportKatexCss (adapter)', () => {
    beforeEach(() => resetExportKatexCssCache());

    it('extracts from an explicit host and does not touch the global cache', () => {
        const host = { styleSheets: [sheet(styleRule('.katex'))] };
        expect(getExportKatexCss(host)).toContain('.katex{');
    });

    it('returns "" when the host has no stylesheets', () => {
        expect(getExportKatexCss({})).toBe('');
        expect(getExportKatexCss({ styleSheets: undefined })).toBe('');
    });

    it('reads the global document and memoizes a non-empty result', () => {
        const style = document.createElement('style');
        style.textContent = '.katex { color: red; }';
        document.head.appendChild(style);
        try {
            const first = getExportKatexCss();
            expect(first).toContain('.katex');
            // Remove the source rule; a memoized result must still be returned.
            style.remove();
            expect(getExportKatexCss()).toBe(first);
        } finally {
            style.remove();
            resetExportKatexCssCache();
        }
    });
});
