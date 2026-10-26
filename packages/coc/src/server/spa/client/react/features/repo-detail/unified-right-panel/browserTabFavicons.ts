import { useSyncExternalStore } from 'react';

/**
 * Live site icons for browser tab headers, by tab id. Memory only: icons are never
 * persisted with the tab, so a reload starts from the default globe until the page
 * reports again. Only desktop-validated `data:image/` URLs are kept, so the strip
 * never requests a page-chosen URL.
 */
const icons = new Map<string, string>();
const listeners = new Set<() => void>();

export function setBrowserTabFavicon(tabId: string, favicon: string | undefined): void {
    const next = typeof favicon === 'string' && favicon.startsWith('data:image/') ? favicon : undefined;
    if (icons.get(tabId) === next) return;
    if (next) icons.set(tabId, next);
    else icons.delete(tabId);
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function useBrowserTabFavicon(tabId: string): string | undefined {
    return useSyncExternalStore(subscribe, () => icons.get(tabId));
}
