import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Loader = typeof import('../src/mermaid/index.js');

async function freshLoader(): Promise<Loader> {
    vi.resetModules();
    return import('../src/mermaid/index.js');
}

function mermaidScripts(): HTMLScriptElement[] {
    return Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[src*="mermaid"]'));
}

describe('mermaid loader', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.documentElement.removeAttribute('data-theme');
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (globalThis as { mermaid?: unknown }).mermaid;
    });

    it('resolves at once when the runtime is already loaded', async () => {
        vi.stubGlobal('mermaid', { initialize: vi.fn(), run: vi.fn() });
        const { ensureMermaid } = await freshLoader();
        await expect(ensureMermaid()).resolves.toBeUndefined();
        expect(mermaidScripts()).toHaveLength(0);
    });

    it('adds one script for concurrent callers and initializes with the page theme', async () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        const { ensureMermaid } = await freshLoader();
        const first = ensureMermaid();
        const second = ensureMermaid();
        expect(second).toBe(first);
        expect(mermaidScripts()).toHaveLength(1);

        const initialize = vi.fn();
        vi.stubGlobal('mermaid', { initialize, run: vi.fn() });
        mermaidScripts()[0].onload?.(new Event('load'));
        await first;
        expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, theme: 'dark' }));
    });

    it('lets a later call retry after the script fails to load', async () => {
        const { ensureMermaid } = await freshLoader();
        const failed = ensureMermaid();
        mermaidScripts()[0].onerror?.(new Event('error'));
        await expect(failed).rejects.toThrow('Failed to load mermaid.js');

        const retry = ensureMermaid();
        expect(retry).not.toBe(failed);
        expect(mermaidScripts()).toHaveLength(2);
        mermaidScripts()[1].onerror?.(new Event('error'));
        await expect(retry).rejects.toThrow();
    });

    it('applyMermaidTheme re-initializes a loaded runtime and is a no-op before load', async () => {
        const { applyMermaidTheme } = await freshLoader();
        expect(() => applyMermaidTheme()).not.toThrow();

        const initialize = vi.fn();
        vi.stubGlobal('mermaid', { initialize, run: vi.fn() });
        document.documentElement.setAttribute('data-theme', 'light');
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        applyMermaidTheme();
        expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }));

        document.documentElement.removeAttribute('data-theme');
        applyMermaidTheme();
        expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));
    });
});
