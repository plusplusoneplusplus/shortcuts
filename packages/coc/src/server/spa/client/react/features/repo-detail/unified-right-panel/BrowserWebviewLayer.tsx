import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { desktopBrowserBridge } from '../../../shared/file-path/browser-bridge';
import {
    browserWebviewEntries, reportBrowserWebviewError, subscribeBrowserWebviews,
    type BrowserWebviewEntry,
} from './browserWebviewLayerStore';

interface BrowserWebviewElement extends HTMLElement {
    getWebContentsId(): number;
}

interface GuestHost {
    entry: BrowserWebviewEntry;
    host: HTMLDivElement;
    guest: BrowserWebviewElement;
    placeholder?: HTMLElement;
    observer: ResizeObserver | null;
    bounds?: string;
    css?: string;
}

function place(host: GuestHost): void {
    const { entry, host: element } = host;
    const placeholder = entry.placement?.element;
    let visible = Boolean(entry.placement?.shown && placeholder?.isConnected && !entry.error);
    const rect = placeholder?.getBoundingClientRect();
    visible = visible && Boolean(rect && rect.width > 0 && rect.height > 0);
    if (visible && rect && placeholder) {
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
        let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
        for (let node = placeholder.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            const clip = node.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) {
                left = Math.max(left, clip.left);
                right = Math.min(right, clip.right);
            }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
                top = Math.max(top, clip.top);
                bottom = Math.min(bottom, clip.bottom);
            }
            if (style.visibility === 'hidden' || style.display === 'none') visible = false;
        }
        visible = visible && right > left && bottom > top;
        const css = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;clip-path:inset(${top - rect.top}px ${rect.right - right}px ${rect.bottom - bottom}px ${left - rect.left}px);visibility:${visible ? 'visible' : 'hidden'};pointer-events:${visible ? 'auto' : 'none'}`;
        if (host.css !== css) {
            host.css = css;
            element.style.cssText = css;
        }
    }
    if (!visible) {
        host.css = undefined;
        element.style.visibility = 'hidden';
        element.style.pointerEvents = 'none';
    }
    const bounds = visible && rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    const key = JSON.stringify(bounds);
    if (host.bounds !== key) {
        host.bounds = key;
        entry.config?.bridge.setBounds(entry.viewId, bounds);
    }
}

/** Guests are created once here, outside every keyed workspace/panel subtree. */
export function BrowserWebviewLayer() {
    const root = useRef<HTMLDivElement>(null);
    const bridge = desktopBrowserBridge();
    useEffect(() => {
        const container = root.current;
        if (!container || !bridge?.adopt) return;
        const hosts = new Map<string, GuestHost>();
        let frame = 0;
        const update = () => {
            frame = 0;
            hosts.forEach(place);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        const reconcile = () => {
            const live = new Set<BrowserWebviewEntry>();
            for (const entry of browserWebviewEntries()) {
                if (!entry.config) continue;
                live.add(entry);
                let host = hosts.get(entry.viewId);
                if (host && host.entry !== entry) {
                    host.observer?.disconnect();
                    host.host.remove();
                    hosts.delete(entry.viewId);
                    host = undefined;
                }
                if (!host) {
                    const element = document.createElement('div');
                    element.dataset.browserViewId = entry.viewId;
                    element.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
                    const guest = document.createElement('webview') as BrowserWebviewElement;
                    guest.style.cssText = 'width:100%;height:100%;display:flex';
                    guest.setAttribute('partition', entry.config.partition);
                    guest.setAttribute('src', entry.config.src);
                    let attached = false;
                    // Stock Electron exposes getWebContentsId only after dom-ready.
                    guest.addEventListener('dom-ready', async () => {
                        if (attached || !element.isConnected) return;
                        attached = true;
                        try {
                            const result = await entry.config!.bridge.adopt!(entry.viewId, guest.getWebContentsId());
                            if (!result.ok) reportBrowserWebviewError(entry, result.message ?? `Could not attach page: ${result.reason}`);
                        } catch (error) {
                            console.error('Could not attach browser page:', error);
                            reportBrowserWebviewError(entry, 'Could not attach this page. Close the tab and try again.');
                        }
                    });
                    element.append(guest);
                    container.append(element);
                    host = { entry, host: element, guest, observer: typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule) };
                    hosts.set(entry.viewId, host);
                }
                if (host.placeholder !== entry.placement?.element) {
                    host.observer?.disconnect();
                    host.placeholder = entry.placement?.element;
                    for (let node = host.placeholder; node; node = node.parentElement ?? undefined) host.observer?.observe(node);
                }
                place(host);
            }
            for (const [id, host] of hosts) {
                if (live.has(host.entry)) continue;
                host.observer?.disconnect();
                host.host.remove();
                hosts.delete(id);
            }
        };
        const unsubscribe = subscribeBrowserWebviews(reconcile);
        reconcile();
        // Track ancestor class/layout changes, but ignore our own placement writes.
        const mutations = new MutationObserver(records => {
            if (records.some(record => !container.contains(record.target))) schedule();
        });
        mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        return () => {
            unsubscribe();
            mutations.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            if (frame) cancelAnimationFrame(frame);
            hosts.forEach(host => { host.observer?.disconnect(); host.host.remove(); });
        };
    }, [bridge]);
    if (!bridge?.adopt) return null;
    return createPortal(<div ref={root} data-testid="browser-webview-layer" style={{ position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'none' }} />, document.body);
}
