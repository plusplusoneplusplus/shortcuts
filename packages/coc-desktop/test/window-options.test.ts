/**
 * Unit tests for buildWindowOptions — the platform-specific BrowserWindow
 * constructor options that reclaim the native title bar on macOS.
 *
 * The function is pure (no Electron APIs), so it can be tested without an
 * Electron runtime.
 */

import { describe, it, expect } from 'vitest';
import { buildWindowOptions, buildMacInsetCss } from '../src/window-config';

describe('buildWindowOptions', () => {
    it('returns hiddenInset titleBarStyle on darwin', () => {
        const opts = buildWindowOptions('darwin');
        expect(opts.titleBarStyle).toBe('hiddenInset');
    });

    it('includes trafficLightPosition on darwin', () => {
        const opts = buildWindowOptions('darwin');
        expect(opts.trafficLightPosition).toEqual({ x: 12, y: 13 });
    });

    it('returns an empty object on win32', () => {
        const opts = buildWindowOptions('win32');
        expect(opts).toEqual({});
    });

    it('returns an empty object on linux', () => {
        const opts = buildWindowOptions('linux');
        expect(opts).toEqual({});
    });

    it('does not set titleBarStyle on non-darwin platforms', () => {
        expect(buildWindowOptions('win32').titleBarStyle).toBeUndefined();
        expect(buildWindowOptions('linux').titleBarStyle).toBeUndefined();
    });
});

describe('buildMacInsetCss', () => {
    it('pads the SPA top bar clear of the traffic lights with !important', () => {
        const css = buildMacInsetCss();
        expect(css).toContain('header[data-react]');
        expect(css).toContain('padding-left: 88px !important');
    });

    it('makes the top bar a drag region', () => {
        expect(buildMacInsetCss()).toContain('-webkit-app-region: drag');
    });

    it('keeps interactive children clickable via no-drag', () => {
        const css = buildMacInsetCss();
        expect(css).toContain('-webkit-app-region: no-drag');
        for (const sel of ['button', ' a,', 'input', 'select', '[role="button"]', '[role="tab"]']) {
            expect(css).toContain(sel);
        }
    });

    it('also clears the maximized canvas panel header from the traffic lights', () => {
        const css = buildMacInsetCss();
        const canvasHeader = '[data-testid="canvas-panel"][data-fullscreen="true"] > div:first-child';
        // The fullscreen canvas header gets the same left clearance + drag handle.
        expect(css).toContain(`${canvasHeader} { padding-left: 88px !important; -webkit-app-region: drag; }`);
        // Its buttons (title switcher, mode toggle, export, close) stay clickable.
        expect(css).toContain(`${canvasHeader} button`);
    });

    it('does not pad the canvas panel header when it is not fullscreen', () => {
        // Docked (non-fullscreen) panels sit away from the traffic lights, so the
        // selector must be scoped to data-fullscreen="true" only.
        expect(buildMacInsetCss()).not.toContain('[data-fullscreen="false"]');
    });
});
