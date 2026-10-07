import { useSyncExternalStore } from 'react';
import type { BrowserOpenResult, DesktopBrowserBridge } from '../../../shared/file-path/browser-bridge';

export interface BrowserWebviewEntry {
    viewId: string;
    config?: { src: string; partition: string; bridge: DesktopBrowserBridge };
    placement?: { element: HTMLElement; shown: boolean };
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
