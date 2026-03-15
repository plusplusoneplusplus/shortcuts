/**
 * Website Generator — Themes Tests
 *
 * Verifies that light, dark, and auto themes produce correct HTML output,
 * and that Mermaid zoom/pan support is present in generated pages.
 *
 * Gap: website-generator.test.ts covers content generation but not the three
 * visual themes or the Mermaid interactive wrapper.
 */

import { describe, it, expect } from 'vitest';
import { generateHtmlTemplate } from '../../src/writing/website-generator';

describe('Website generator — themes', () => {
    // ========================================================================
    // Light theme
    // ========================================================================

    it('generates HTML with light theme class and data-theme attribute', () => {
        const html = generateHtmlTemplate({ theme: 'light', title: 'Test', enableSearch: false });

        expect(html).toContain('class="light-theme"');
        expect(html).toContain('data-theme="light"');
    });

    it('light theme does not include color-scheme meta tag', () => {
        const html = generateHtmlTemplate({ theme: 'light', title: 'Test', enableSearch: false });

        expect(html).not.toContain('<meta name="color-scheme"');
    });

    // ========================================================================
    // Dark theme
    // ========================================================================

    it('generates HTML with dark theme class and data-theme attribute', () => {
        const html = generateHtmlTemplate({ theme: 'dark', title: 'Test', enableSearch: false });

        expect(html).toContain('class="dark-theme"');
        expect(html).toContain('data-theme="dark"');
    });

    it('dark theme does not include color-scheme meta tag', () => {
        const html = generateHtmlTemplate({ theme: 'dark', title: 'Test', enableSearch: false });

        expect(html).not.toContain('<meta name="color-scheme"');
    });

    // ========================================================================
    // Auto theme
    // ========================================================================

    it('auto theme includes color-scheme meta tag for prefers-color-scheme support', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });

        expect(html).toContain('<meta name="color-scheme" content="light dark">');
    });

    it('auto theme sets data-theme="auto" and does not add a theme class', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });

        expect(html).toContain('data-theme="auto"');
        // Auto theme must NOT add a class attribute with light-theme or dark-theme
        expect(html).not.toContain('class="auto-theme"');
        expect(html).not.toContain('class="light-theme"');
        expect(html).not.toContain('class="dark-theme"');
    });

    // ========================================================================
    // Mermaid support
    // ========================================================================

    it('generated HTML includes Mermaid CDN script tag', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });

        expect(html).toContain('mermaid');
        expect(html).toContain('cdn.jsdelivr.net');
    });

    it('generated HTML includes mermaid.initialize call', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });

        expect(html).toContain('mermaid.initialize');
    });

    it('generated script contains mermaid zoom/pan support', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });

        // The client script wraps mermaid diagrams in a zoomable container
        expect(html).toContain('mermaid-container');
    });

    // ========================================================================
    // Search box
    // ========================================================================

    it('includes search box when enableSearch is true', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });

        expect(html).toContain('id="search"');
        expect(html).toContain('search-box');
    });

    it('omits search box when enableSearch is false', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });

        expect(html).not.toContain('id="search"');
    });

    // ========================================================================
    // All three themes produce valid HTML
    // ========================================================================

    it.each(['light', 'dark', 'auto'] as const)(
        '%s theme produces complete HTML document',
        (theme) => {
            const html = generateHtmlTemplate({ theme, title: 'My Wiki', enableSearch: false });

            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('<html');
            expect(html).toContain('</html>');
            expect(html).toContain('My Wiki');
        }
    );
});
