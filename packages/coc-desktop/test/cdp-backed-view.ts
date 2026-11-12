import { createCdpBrowserControl, type BrowserCdpTransport } from '../src/browser-cdp-control';
import type { BrowserHostedView } from '../src/browser-host-contract';

/** Exposes `control` while the test gives the mock view a CDP transport, like the Chromium engine adapters do. */
export function cdpBacked<T extends BrowserHostedView>(view: T): T {
    return Object.defineProperty(view, 'control', {
        configurable: true, enumerable: true,
        get: () => view.cdp ? createCdpBrowserControl(view as T & BrowserCdpTransport) : undefined,
    });
}
