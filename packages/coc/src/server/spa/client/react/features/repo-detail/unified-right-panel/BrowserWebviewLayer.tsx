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
    /** Last on-screen geometry, reused to keep a background-controlled guest laid out while hidden. */
    rect?: { left: number; top: number; width: number; height: number };
    /** Laid out unseen for a background turn; it must never keep the window's focus. */
    backgroundHidden?: boolean;
}

/** Viewport for a background-controlled guest that was never on screen. */
const BACKGROUND_GUEST_SIZE = { width: 1280, height: 800 };

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
        if (visible) host.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    host.backgroundHidden = !visible && !!entry.background && !entry.error;
    if (host.backgroundHidden) {
        // Hidden guests stop rendering; a background turn needs layout, screenshots and input, so keep it
        // in place at its last size but fully transparent and click-through.
        const { left, top, width, height } = host.rect ?? { left: 0, top: 0, ...BACKGROUND_GUEST_SIZE };
        const css = `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;opacity:0;visibility:visible;pointer-events:none`;
        if (host.css !== css) {
            host.css = css;
            element.style.cssText = css;
        }
    } else if (!visible) {
        host.css = undefined;
        element.style.visibility = 'hidden';
        element.style.pointerEvents = 'none';
        element.style.opacity = '';
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
            watchFocus();
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
            watchFocus();
        };
        // Trusted input to a background guest moves frame focus into it, with no event on the guest element
        // and sometimes after the window blur. While such a guest exists, give focus back to the element
        // the user was last in.
        let lastFocused: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let watch = 0;
        const recordFocus = (event: FocusEvent) => {
            if (event.target instanceof HTMLElement && !container.contains(event.target)) lastFocused = event.target;
        };
        const restoreFocus = () => {
            const active = document.activeElement;
            if (!lastFocused?.isConnected || active === lastFocused) return;
            if ([...hosts.values()].some(host => host.backgroundHidden && host.guest === active)) lastFocused.focus({ preventScroll: true });
        };
        const watchFocus = () => {
            const background = [...hosts.values()].some(host => host.backgroundHidden);
            if (background && !watch) watch = window.setInterval(restoreFocus, 50);
            else if (!background && watch) { window.clearInterval(watch); watch = 0; }
        };
        document.addEventListener('focusin', recordFocus, true);
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
            document.removeEventListener('focusin', recordFocus, true);
            if (watch) window.clearInterval(watch);
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
