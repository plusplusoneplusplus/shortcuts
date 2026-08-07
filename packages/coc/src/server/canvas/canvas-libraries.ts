/**
 * Canvas library allowlist — the fixed set of third-party libraries an
 * extension canvas may declare, and the vendored bundle each one maps to.
 *
 * The bundles themselves are built by `scripts/build-client.mjs` into
 * `src/server/spa/client/dist/canvas-vendor/` and served at the SITE ROOT
 * (`/canvas-vendor/react.js`, …) alongside the Monaco and pdf.js workers.
 *
 * Why classic-script globals and not ESM + an import map: the extension iframe
 * is `sandbox="allow-scripts"` with no `allow-same-origin`, so it is an opaque
 * origin and sends `Origin: null`. CoC's CORS policy reflects only loopback
 * origins and never emits `*`, so no `Access-Control-Allow-Origin` comes back
 * and every CORS-mode subresource — module scripts, import maps, `fetch`,
 * `WebAssembly.instantiateStreaming` — is blocked inside the frame. Classic
 * `<script src>` and `<link rel=stylesheet>` are no-CORS subresource requests
 * and are unaffected.
 *
 * This module is shared by the server (tool validation, storage) and the
 * browser (the iframe bootstrap, the HTML exporter), so it stays pure: no
 * `fs`, no `esbuild`, no DOM.
 */

/** Every library an extension canvas may declare. */
export type CanvasLibraryId = 'react' | 'recharts' | 'papaparse' | 'tailwind';

export interface CanvasLibrary {
    id: CanvasLibraryId;
    /** File under `/canvas-vendor/`. */
    file: string;
    /** How the bootstrap injects it. */
    kind: 'script' | 'stylesheet';
    /** Global the bundle assigns (scripts only) — also how a load is probed. */
    global?: string;
    /** Libraries that must load first. Resolved transitively. */
    requires: readonly CanvasLibraryId[];
    /** Shown to the AI in the `extension_canvas` tool description. */
    description: string;
}

/** URL path prefix the vendored bundles are served under, at the site root. */
export const CANVAS_VENDOR_PATH = '/canvas-vendor';

export const CANVAS_LIBRARIES: Readonly<Record<CanvasLibraryId, CanvasLibrary>> = {
    react: {
        id: 'react',
        file: 'react.js',
        kind: 'script',
        global: 'React',
        requires: [],
        description: 'React 18 + ReactDOM (window.React, window.ReactDOM incl. createRoot). Implied by uiJsx.',
    },
    recharts: {
        id: 'recharts',
        file: 'recharts.js',
        kind: 'script',
        global: 'Recharts',
        requires: ['react'],
        description: 'Recharts 3 chart components (window.Recharts) — LineChart, BarChart, AreaChart, PieChart, …',
    },
    papaparse: {
        id: 'papaparse',
        file: 'papaparse.js',
        kind: 'script',
        global: 'Papa',
        requires: [],
        description: 'PapaParse CSV parser (window.Papa).',
    },
    tailwind: {
        id: 'tailwind',
        file: 'tailwind.css',
        kind: 'stylesheet',
        requires: [],
        description: 'Prebuilt Tailwind utility stylesheet (a fixed subset — see the tool description).',
    },
};

export const CANVAS_LIBRARY_IDS: readonly CanvasLibraryId[] = Object.keys(CANVAS_LIBRARIES) as CanvasLibraryId[];

export function isCanvasLibraryId(value: unknown): value is CanvasLibraryId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CANVAS_LIBRARIES, value);
}

export type ResolveCanvasLibrariesResult =
    | { ok: true; libraries: CanvasLibraryId[] }
    | { ok: false; error: string };

/**
 * Validate declared library ids and expand them into the exact load order the
 * bootstrap (and the offline export) must use: stylesheets first, then scripts
 * with every dependency ahead of its dependent, de-duplicated, otherwise
 * preserving the declared order.
 *
 * An unknown id is an error rather than a silent drop — an artifact that
 * declared `d3` and then renders blank is far worse to debug than a tool call
 * that says `d3` is not on the allowlist.
 */
export function resolveCanvasLibraries(declared: readonly unknown[] | undefined): ResolveCanvasLibrariesResult {
    if (declared === undefined) return { ok: true, libraries: [] };
    if (!Array.isArray(declared)) {
        return { ok: false, error: 'libraries must be an array of library names' };
    }

    for (const id of declared) {
        if (!isCanvasLibraryId(id)) {
            return {
                ok: false,
                error: `Unknown canvas library "${String(id)}". Allowed: ${CANVAS_LIBRARY_IDS.join(', ')}.`,
            };
        }
    }

    const ordered: CanvasLibraryId[] = [];
    const seen = new Set<CanvasLibraryId>();
    const visit = (id: CanvasLibraryId): void => {
        if (seen.has(id)) return;
        seen.add(id);
        for (const dep of CANVAS_LIBRARIES[id].requires) visit(dep);
        ordered.push(id);
    };
    for (const id of declared as CanvasLibraryId[]) visit(id);

    // Stylesheets ahead of scripts so an artifact never paints unstyled between
    // `mount()` and the sheet arriving.
    const stylesheets = ordered.filter(id => CANVAS_LIBRARIES[id].kind === 'stylesheet');
    const scripts = ordered.filter(id => CANVAS_LIBRARIES[id].kind === 'script');
    return { ok: true, libraries: [...stylesheets, ...scripts] };
}

/**
 * Absolute URL for a vendored bundle. Absolute on purpose: the extension frame
 * is an `about:srcdoc` document, so a root-relative `/canvas-vendor/…` would
 * depend on base-URL inheritance in a sandboxed frame. Computing the URL on the
 * host side removes that dependency entirely.
 */
export function canvasLibraryUrl(id: CanvasLibraryId, assetBase: string): string {
    const base = String(assetBase ?? '').replace(/\/+$/, '');
    return `${base}${CANVAS_VENDOR_PATH}/${CANVAS_LIBRARIES[id].file}`;
}
