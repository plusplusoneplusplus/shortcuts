import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { mountHtmlEmbeds } from '../../../src/server/spa/client/react/shared/htmlEmbedMount';

describe('mountHtmlEmbeds', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.localStorage.clear();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('<html></html>'),
        }));
        vi.stubGlobal('open', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('mounts a sandboxed iframe with the workspace proxy URL', async () => {
        document.body.innerHTML = `
            <div data-ws-id="ws 1">
                <div class="md-html-embed" data-html-path="outputs/chart.html" data-embed-height="600"></div>
            </div>
        `;

        mountHtmlEmbeds(document.body);

        const iframe = document.querySelector('iframe')!;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
        expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
        expect(iframe.getAttribute('loading')).toBe('lazy');
        await waitFor(() => {
            expect(iframe.getAttribute('src')).toBe('/api/workspaces/ws%201/files/html?path=outputs%2Fchart.html');
        });
        expect(document.querySelector('.md-html-embed')?.getAttribute('data-mounted')).toBe('1');
    });

    it('skips placeholders without a workspace id', () => {
        document.body.innerHTML = '<div class="md-html-embed" data-html-path="outputs/chart.html" data-embed-height="600"></div>';

        mountHtmlEmbeds(document.body);

        expect(document.querySelector('iframe')).toBeNull();
        expect(document.querySelector('.md-html-embed')?.hasAttribute('data-mounted')).toBe(false);
    });

    it('is idempotent across repeated mounts', async () => {
        document.body.innerHTML = `
            <div data-ws-id="ws1">
                <div class="md-html-embed" data-html-path="outputs/chart.html" data-embed-height="600"></div>
            </div>
        `;

        mountHtmlEmbeds(document.body);
        mountHtmlEmbeds(document.body);
        await Promise.resolve();

        expect(document.querySelectorAll('iframe')).toHaveLength(1);
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it('restores persisted height from localStorage', async () => {
        window.localStorage.setItem('htmlEmbedHeight:ws1:outputs/chart.html', '720');
        document.body.innerHTML = `
            <div data-ws-id="ws1">
                <div class="md-html-embed" data-html-path="outputs/chart.html" data-embed-height="600"></div>
            </div>
        `;

        mountHtmlEmbeds(document.body);
        await Promise.resolve();

        const frameWrap = document.querySelector<HTMLElement>('.md-html-embed-frame-wrap')!;
        expect(frameWrap.style.height).toBe('720px');
    });

    it('shows an error affordance for failed proxy responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        document.body.innerHTML = `
            <div data-ws-id="ws1">
                <div class="md-html-embed" data-html-path="outputs/missing.html" data-embed-height="600"></div>
            </div>
        `;

        mountHtmlEmbeds(document.body);

        await waitFor(() => {
            expect(document.querySelector('.md-html-embed-error')?.textContent).toContain('Could not load preview');
        });
        expect(document.querySelector('.md-html-embed-error a')?.getAttribute('href')).toContain('/api/workspaces/ws1/files/html');
    });
});
