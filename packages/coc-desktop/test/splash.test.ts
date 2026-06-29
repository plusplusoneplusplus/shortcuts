/**
 * Unit tests for the AC-03 splash / loading screen renderer.
 *
 * The renderer is electron-free, so we can assert the loading vs. error markup,
 * HTML-escaping of injected messages, and the `data:` URL wrapper directly.
 */

import { describe, it, expect } from 'vitest';
import { renderSplashHtml, splashDataUrl } from '../src/splash';

describe('renderSplashHtml', () => {
    it('shows a spinner and the loading message while booting', () => {
        const html = renderSplashHtml({ phase: 'loading' });
        expect(html).toContain('<div class="spinner"');
        expect(html).toContain('Starting the local server');
        expect(html).toContain('CoC');
    });

    it('honours a custom loading message', () => {
        const html = renderSplashHtml({ phase: 'loading', message: 'Waking up…' });
        expect(html).toContain('Waking up');
    });

    it('drops the spinner and shows the failure message on error', () => {
        const html = renderSplashHtml({ phase: 'error', message: 'port in use' });
        expect(html).not.toContain('class="spinner"');
        expect(html).toContain('CoC failed to start');
        expect(html).toContain('port in use');
    });

    it('escapes HTML in injected messages to prevent markup injection', () => {
        const html = renderSplashHtml({ phase: 'error', message: '<img src=x onerror=alert(1)>' });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
});

describe('splashDataUrl', () => {
    it('wraps the rendered document as a loadable data: URL', () => {
        const url = splashDataUrl({ phase: 'loading' });
        expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
        const decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
        expect(decoded).toBe(renderSplashHtml({ phase: 'loading' }));
    });
});
