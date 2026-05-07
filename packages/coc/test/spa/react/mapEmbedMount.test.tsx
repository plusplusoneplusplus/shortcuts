import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountMapEmbeds } from '../../../src/server/spa/client/react/shared/mapEmbedMount';

const mapUrl = 'https://www.google.com/maps/embed?pb=!1m18!1m12';

describe('mountMapEmbeds', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.localStorage.clear();
        vi.stubGlobal('open', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('mounts an allowlisted Google Maps iframe with the required sandbox policy', () => {
        document.body.innerHTML = `<div class="md-map-embed" data-map-url="${mapUrl}" data-map-label="Lake Chelan"></div>`;

        mountMapEmbeds(document.body);

        const iframe = document.querySelector('iframe')!;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('src')).toBe(mapUrl);
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
        expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer-when-downgrade');
        expect(iframe.getAttribute('loading')).toBe('lazy');
        expect(document.querySelector('.md-map-embed-title')?.textContent).toBe('Lake Chelan');
        expect(document.querySelector('.md-map-embed')?.getAttribute('data-mounted')).toBe('1');
    });

    it('opens the map in a new tab from the toolbar action', () => {
        document.body.innerHTML = `<div class="md-map-embed" data-map-url="${mapUrl}" data-map-label="Lake Chelan"></div>`;

        mountMapEmbeds(document.body);
        document.querySelector<HTMLButtonElement>('.md-map-embed-actions button')?.click();

        expect(window.open).toHaveBeenCalledWith(mapUrl, '_blank', 'noopener,noreferrer');
    });

    it('is idempotent across repeated mounts', () => {
        document.body.innerHTML = `<div class="md-map-embed" data-map-url="${mapUrl}" data-map-label="Lake Chelan"></div>`;

        mountMapEmbeds(document.body);
        mountMapEmbeds(document.body);

        expect(document.querySelectorAll('iframe')).toHaveLength(1);
    });

    it('restores persisted height from localStorage', () => {
        window.localStorage.setItem(`mapEmbedHeight:${mapUrl}`, '720');
        document.body.innerHTML = `<div class="md-map-embed" data-map-url="${mapUrl}" data-map-label="Lake Chelan"></div>`;

        mountMapEmbeds(document.body);

        const frameWrap = document.querySelector<HTMLElement>('.md-map-embed-frame-wrap')!;
        expect(frameWrap.style.height).toBe('720px');
    });

    it('persists resized height to localStorage', () => {
        document.body.innerHTML = `<div class="md-map-embed" data-map-url="${mapUrl}" data-map-label="Lake Chelan"></div>`;

        mountMapEmbeds(document.body);

        const resize = document.querySelector<HTMLElement>('.md-map-embed-resize')!;
        resize.dispatchEvent(new MouseEvent('mousedown', { clientY: 10, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 130, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(window.localStorage.getItem(`mapEmbedHeight:${mapUrl}`)).toBe('520');
    });

    it('does not mount non-allowlisted URLs as iframes', () => {
        document.body.innerHTML = '<div class="md-map-embed" data-map-url="https://maps.app.goo.gl/example" data-map-label="Share"></div>';

        mountMapEmbeds(document.body);

        expect(document.querySelector('iframe')).toBeNull();
        expect(document.querySelector('.md-map-embed-error')?.textContent).toContain('Unsupported Google Maps embed URL');
    });
});
