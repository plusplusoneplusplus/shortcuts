/**
 * @vitest-environment jsdom
 *
 * Runtime recharts loader (AC-01): one script tag for concurrent callers, the
 * SPA's own React published on window, and the "loaded but global absent" trap
 * (a missing /canvas-vendor/*.js serves the SPA index.html with a 200).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import {
    loadRecharts,
    resetRechartsLoaderForTests,
    RECHARTS_VENDOR_URL,
} from '../../../../../src/server/spa/client/react/features/canvas/rechartsLoader';

function injectedScripts(): HTMLScriptElement[] {
    return Array.from(
        document.head.querySelectorAll<HTMLScriptElement>(`script[src="${RECHARTS_VENDOR_URL}"]`),
    );
}

describe('loadRecharts', () => {
    beforeEach(() => {
        resetRechartsLoaderForTests();
        document.head.innerHTML = '';
        delete (window as any).Recharts;
    });

    afterEach(() => {
        resetRechartsLoaderForTests();
        delete (window as any).Recharts;
    });

    it('uses the vendored bundle path from the canvas library registry', () => {
        expect(RECHARTS_VENDOR_URL).toBe('/canvas-vendor/recharts.js');
    });

    it('injects exactly one script for two concurrent calls and shares the result', async () => {
        const first = loadRecharts();
        const second = loadRecharts();

        const scripts = injectedScripts();
        expect(scripts).toHaveLength(1);

        (window as any).Recharts = { LineChart: () => null };
        scripts[0].onload?.(new Event('load'));

        await expect(first).resolves.toBe((window as any).Recharts);
        await expect(second).resolves.toBe((window as any).Recharts);
        expect(injectedScripts()).toHaveLength(1);
    });

    it("exposes the SPA's own React instance before the bundle parses", () => {
        loadRecharts();
        expect((window as any).React).toBe(React);
        expect((window as any).ReactDOM).toBeDefined();
    });

    it('rejects when the script loads but window.Recharts is still undefined', async () => {
        const promise = loadRecharts();
        injectedScripts()[0].onload?.(new Event('load'));
        await expect(promise).rejects.toThrow(/did not define window\.Recharts/);
    });

    it('rejects on a network error and allows a retry', async () => {
        const promise = loadRecharts();
        injectedScripts()[0].onerror?.(new Event('error'));
        await expect(promise).rejects.toThrow(/Could not load/);

        // Failure is not cached — the next render gets a fresh attempt.
        document.head.innerHTML = '';
        loadRecharts();
        expect(injectedScripts()).toHaveLength(1);
    });

    it('resolves immediately when the global is already present', async () => {
        (window as any).Recharts = { BarChart: () => null };
        await expect(loadRecharts()).resolves.toBe((window as any).Recharts);
        expect(injectedScripts()).toHaveLength(0);
    });
});
