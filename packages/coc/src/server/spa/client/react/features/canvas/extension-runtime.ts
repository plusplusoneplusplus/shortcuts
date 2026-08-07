/**
 * The in-iframe runtime for a JSX-authored extension canvas.
 *
 * A JSX extension does not ship HTML. It ships a compiled `ui.js` that assigns
 *
 *   window.CanvasExtension = { mount(rootEl, host) { … } }
 *
 * plus a declared list of vendored libraries. This module generates the scripts
 * that turn those two things into a rendered UI, and it does so for BOTH hosts:
 *
 *   - live (`ExtensionCanvasView`) — libraries are fetched from the page origin
 *     with classic `<script src>` / `<link rel=stylesheet>` tags, in declared
 *     order, and `mount()` runs once they have all loaded;
 *   - offline (the HTML export) — the very same runner, except the caller has
 *     already inlined the library bundles ahead of it, so no URL is involved.
 *
 * Keeping one runner is what makes the export trustworthy: an artifact that
 * mounts in the panel mounts in the exported file by the same code path.
 *
 * Why classic scripts: the frame is `sandbox="allow-scripts"` with no
 * `allow-same-origin`, so it is an opaque origin sending `Origin: null`, and
 * CoC's CORS policy reflects only loopback origins and never emits `*`. Module
 * scripts, import maps and `fetch` get no `Access-Control-Allow-Origin` and are
 * blocked; classic subresource loads are not.
 *
 * Every failure path ends in a visible in-frame banner and a
 * `extension-error` message to the parent. A blank frame is never an acceptable
 * outcome — it is indistinguishable from an artifact that renders nothing.
 *
 * Pure string building: no DOM, no fetch, deterministic. Node-safe so the
 * export layer can unit-test it.
 */

import { CANVAS_LIBRARIES, canvasLibraryUrl } from '../../../../../canvas/canvas-libraries';
import type { CanvasLibraryId } from '../../../../../canvas/canvas-libraries';

/** Element id the extension's `mount()` receives as its root. */
export const EXTENSION_ROOT_ID = 'canvas-extension-root';

/** The message a failing frame posts to its host so the panel can show a banner too. */
export const EXTENSION_ERROR_MESSAGE_TYPE = 'extension-error';

/**
 * Serialize JS source as a JS string literal that is safe inside an inline
 * `<script>`: `<` becomes `<`, so no `</script>` (or `<!--`) inside the
 * code can terminate the element. Mirrors `toEmbeddableJson` in the export
 * layer — same hazard, same fix.
 */
export function embedJsString(code: string): string {
    return JSON.stringify(String(code ?? ''))
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** The root element `mount()` renders into. */
export function buildExtensionRootHtml(): string {
    return `<div id="${EXTENSION_ROOT_ID}"></div>`;
}

/**
 * `fail(message)` — the single failure sink. Paints a readable banner in the
 * frame and tells the parent, so neither surface is left guessing.
 */
const FAIL_HELPER = `
    function fail(message) {
        try {
            var box = document.createElement('div');
            box.setAttribute('data-canvas-extension-error', '');
            box.style.cssText = 'margin:12px;padding:10px 12px;border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;border-radius:6px;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap';
            box.textContent = message;
            document.body.appendChild(box);
        } catch (e) { /* nothing left to render into */ }
        try {
            parent.postMessage({ __canvasHost: true, type: '${EXTENSION_ERROR_MESSAGE_TYPE}', message: message }, '*');
        } catch (e) { /* offline export: no parent host */ }
    }`;

/**
 * Execute the compiled UI and call `mount()`.
 *
 * The code runs from an inline `<script>` element rather than `eval` so a
 * syntax error surfaces as a normal script error (trapped by the `error`
 * listener) instead of a swallowed exception. `window.CanvasExtension` is then
 * checked explicitly: a bundle that "loaded" but defined nothing would
 * otherwise mount nothing and look identical to an empty artifact.
 */
function buildRunner(uiJs: string): string {
    return `
    var failed = false;
    function reportError(message) { if (!failed) { failed = true; fail(message); } }
    window.addEventListener('error', function (event) {
        reportError('Extension script error: ' + ((event && event.message) || 'unknown error'));
    });

    function runExtension() {
        var script = document.createElement('script');
        script.textContent = ${embedJsString(uiJs)};
        document.body.appendChild(script);
        if (failed) return;
        var ext = window.CanvasExtension;
        if (!ext || typeof ext.mount !== 'function') {
            reportError('This canvas did not assign window.CanvasExtension = { mount(rootEl, host) { … } }.');
            return;
        }
        var root = document.getElementById(${JSON.stringify(EXTENSION_ROOT_ID)});
        try {
            ext.mount(root, window.CanvasHost);
        } catch (err) {
            reportError('Extension mount() failed: ' + ((err && err.message) || String(err)));
        }
    }`;
}

/**
 * Sequential loader for the declared libraries. Order matters — Recharts reads
 * `window.React` at parse time — so each load waits for the previous one.
 *
 * After every script settles, the global it is supposed to define is checked.
 * That check is not paranoia: a missing `/canvas-vendor/*.js` does not 404, it
 * falls through to the SPA's index HTML with a 200, which a `<script src>`
 * "loads" happily while defining nothing.
 */
function buildLoader(libraries: readonly CanvasLibraryId[], assetBase: string): string {
    const entries = libraries.map(id => ({
        id,
        url: canvasLibraryUrl(id, assetBase),
        kind: CANVAS_LIBRARIES[id].kind,
        global: CANVAS_LIBRARIES[id].global ?? null,
    }));
    return `
    var LIBS = ${JSON.stringify(entries)};

    function loadOne(lib) {
        return new Promise(function (resolve, reject) {
            var el;
            if (lib.kind === 'stylesheet') {
                el = document.createElement('link');
                el.rel = 'stylesheet';
                el.href = lib.url;
            } else {
                el = document.createElement('script');
                el.async = false;
                el.src = lib.url;
            }
            el.onload = function () {
                if (lib.global && typeof window[lib.global] === 'undefined') {
                    reject(new Error('Loaded ' + lib.url + ' but it did not define window.' + lib.global));
                    return;
                }
                resolve();
            };
            el.onerror = function () { reject(new Error('Could not load ' + lib.url)); };
            document.head.appendChild(el);
        });
    }

    LIBS.reduce(function (chain, lib) {
        return chain.then(function () { return loadOne(lib); });
    }, Promise.resolve())
        .then(runExtension)
        .catch(function (err) {
            reportError('Canvas libraries failed to load — ' + ((err && err.message) || String(err)));
        });`;
}

export interface ExtensionRuntimeScriptOptions {
    /** The compiled UI (`ui.js`). */
    uiJs: string;
    /** Declared libraries, already dependency-resolved and in load order. */
    libraries: readonly CanvasLibraryId[];
    /**
     * Absolute origin the vendored bundles are served from (e.g.
     * `http://127.0.0.1:4000`). Absolute on purpose: the frame is an
     * `about:srcdoc` document, so a root-relative URL would depend on base-URL
     * inheritance in a sandboxed frame.
     *
     * Omit for the offline export, where the caller inlines the bundles ahead
     * of this script and the runner fires immediately.
     */
    assetBase?: string;
}

/**
 * Build the `<script>` that loads the declared libraries (when `assetBase` is
 * given) and mounts the extension.
 */
export function buildExtensionRuntimeScript(options: ExtensionRuntimeScriptOptions): string {
    const { uiJs, libraries, assetBase } = options;
    // `undefined` means "libraries are already present" (offline export). An
    // empty string still takes the loader path, falling back to root-relative
    // URLs rather than silently mounting against absent globals.
    const body = assetBase === undefined
        ? '\n    runExtension();'
        : buildLoader(libraries, assetBase);
    return `<script>\n(function () {${FAIL_HELPER}\n${buildRunner(uiJs)}\n${body}\n})();\n</script>`;
}
