/**
 * Runtime loader for the vendored Recharts bundle (AC-01).
 *
 * Recharts is deliberately NOT part of the SPA bundle. The dashboard client is
 * built by esbuild as a single `format: 'iife'` + `outfile` bundle, which cannot
 * code-split — a `React.lazy` / dynamic `import()` would inline recharts rather
 * than defer it. So instead we reuse the bundle that is already built for
 * extension canvases and served at `/canvas-vendor/recharts.js`, injecting it
 * with a classic `<script src>` the first time a chart actually needs it.
 *
 * That bundle is built with `react` mapped to `window.React`, so the loader has
 * to publish the SPA's OWN React instance on `window` before the script runs.
 * A second copy of React would break hooks and context.
 *
 * The load is also probed for `window.Recharts` after `onload`: a missing
 * `/canvas-vendor/*.js` does not 404 — the dashboard serves the SPA's
 * `index.html` at the site root, so the request succeeds with a 200 and the
 * browser happily "loads" HTML that defines nothing. See the same trap
 * documented in `extension-runtime.ts`.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { CANVAS_VENDOR_PATH } from '../../../../../canvas/canvas-libraries';

/** Whatever `window.Recharts` exposes — the vendored namespace object. */
export type RechartsNamespace = Record<string, any>;

/** URL the vendored recharts bundle is served from, at the site root. */
export const RECHARTS_VENDOR_URL = `${CANVAS_VENDOR_PATH}/recharts.js`;

declare global {
    interface Window {
        React?: unknown;
        ReactDOM?: unknown;
        Recharts?: RechartsNamespace;
    }
}

/** Shared in-flight / resolved promise: the script is injected at most once. */
let pending: Promise<RechartsNamespace> | null = null;

/**
 * Load Recharts on demand. Concurrent callers share one in-flight promise and a
 * successful load is cached forever; a failure clears the cache so a later
 * render can retry.
 */
export function loadRecharts(): Promise<RechartsNamespace> {
    if (pending) return pending;

    pending = new Promise<RechartsNamespace>((resolve, reject) => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            reject(new Error('Recharts can only be loaded in a browser'));
            return;
        }
        if (window.Recharts) {
            resolve(window.Recharts);
            return;
        }

        // The vendor bundle resolves `react` to `window.React` at parse time,
        // so the SPA's instance has to be there first.
        window.React = React;
        window.ReactDOM = ReactDOM;

        const script = document.createElement('script');
        script.async = false;
        script.src = RECHARTS_VENDOR_URL;
        script.onload = () => {
            const ns = window.Recharts;
            if (!ns) {
                reject(new Error(
                    `Loaded ${RECHARTS_VENDOR_URL} but it did not define window.Recharts`,
                ));
                return;
            }
            resolve(ns);
        };
        script.onerror = () => reject(new Error(`Could not load ${RECHARTS_VENDOR_URL}`));
        document.head.appendChild(script);
    });

    pending.catch(() => { pending = null; });
    return pending;
}

/** Test hook: forget any cached load so the next call injects a fresh script. */
export function resetRechartsLoaderForTests(): void {
    pending = null;
}
