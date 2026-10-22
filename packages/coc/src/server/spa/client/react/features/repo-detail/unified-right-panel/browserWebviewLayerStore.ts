import { useSyncExternalStore } from 'react';
import type { BrowserOpenResult, DesktopBrowserBridge } from '../../../shared/file-path/browser-bridge';

export interface BrowserWebviewEntry {
    viewId: string;
    config?: { src: string; partition: string; bridge: DesktopBrowserBridge };
    placement?: { element: HTMLElement; shown: boolean };
    /** A background browser-control turn drives this guest: keep it laid out (transparent) while hidden. */
    background?: boolean;
    error?: string;
}

const entries = new Map<string, BrowserWebviewEntry>();
const listeners = new Set<() => void>();

export function subscribeBrowserWebviews(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function notify(): void { listeners.forEach(listener => listener()); }

function entryFor(viewId: string): BrowserWebviewEntry {
    let entry = entries.get(viewId);
    if (!entry) {
        entry = { viewId };
        entries.set(viewId, entry);
    }
    return entry;
}

export function browserWebviewEntries(): Iterable<BrowserWebviewEntry> { return entries.values(); }

/** Capture identity before IPC so a late open reply cannot resurrect a closed tab. */
export function prepareBrowserWebview(viewId: string): (result: BrowserOpenResult, bridge: DesktopBrowserBridge) => void {
    const entry = entryFor(viewId);
    return (result, bridge) => {
        if (entries.get(viewId) !== entry || entry.config) return;
        if (!result.ok || result.embed !== 'webview') {
            entries.delete(viewId);
            notify();
            return;
        }
        if (!result.src || !result.partition || !bridge.adopt) {
            entry.error = 'The desktop returned an incomplete browser attachment.';
        } else {
            entry.config = { src: result.src, partition: result.partition, bridge };
        }
        notify();
    };
}

export function placeBrowserWebview(viewId: string, element: HTMLElement, shown: boolean): () => void {
    const entry = entryFor(viewId);
    const placement = { element, shown };
    entry.placement = placement;
    notify();
    return () => {
        if (entry.placement !== placement) return;
        entry.placement = undefined;
        notify();
    };
}

/** Create the guest for a tab whose panel is not mounted, so a background turn can drive it. */
export function attachBrowserWebview(viewId: string, url: string, sessionKey: string, bridge: DesktopBrowserBridge): void {
    if (entries.get(viewId)?.config) return;
    const attach = prepareBrowserWebview(viewId);
    void bridge.open(viewId, url, sessionKey).then(result => attach(result, bridge), error => {
        console.error('Could not attach background browser page:', error);
        removeBrowserWebviewIfUnplaced(viewId);
    });
}

function removeBrowserWebviewIfUnplaced(viewId: string): void {
    const entry = entries.get(viewId);
    if (entry && !entry.config && !entry.placement && entries.delete(viewId)) notify();
}

export function setBrowserWebviewBackground(viewId: string, background: boolean): void {
    const entry = entries.get(viewId);
    if (!entry || !!entry.background === background) return;
    entry.background = background;
    notify();
}

export function reportBrowserWebviewError(entry: BrowserWebviewEntry, error: string): void {
    if (entries.get(entry.viewId) !== entry) return;
    entry.error = error;
    notify();
}

export function useBrowserWebviewError(viewId: string): string | undefined {
    return useSyncExternalStore(subscribeBrowserWebviews, () => entries.get(viewId)?.error);
}

/** Only tab close/engine cleanup destroys a guest; placeholder unmount merely hides it. */
export function removeBrowserWebview(viewId: string): void {
    if (entries.delete(viewId)) notify();
}
