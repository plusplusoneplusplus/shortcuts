/**
 * Layer D (extension) — build the offline, VIEW-ONLY body for an extension canvas
 * export.
 *
 * `buildExtensionExportBody({ uiHtml, stateContent, title })` turns an extension
 * canvas (its self-contained `uiHtml` + the current JSON `content` state) into a
 * self-contained body: a sandboxed `<iframe srcdoc>` that hosts the extension UI
 * with a frozen snapshot of the state, preceded by a "view-only" banner. The
 * exported file renders the extension exactly as it looked at export time, with
 * NO CoC server, NO capability execution, and NO state mutation.
 *
 * How the offline host differs from the live `ExtensionCanvasView`:
 *   - The frozen state is inlined into the iframe as a JS literal and delivered
 *     synchronously to `CanvasHost.onState`, instead of arriving via a postMessage
 *     round-trip from the parent. This is more robust for a static file: there is
 *     no parent host to answer messages, so the extension always sees its state.
 *   - `CanvasHost.invoke`, `setState`, `listFiles` and `readFile` return a
 *     REJECTED promise (`code: 'offline'`). There is no server to run a
 *     capability, no store to persist to and no file endpoint to read, so any
 *     action that would normally reach the host fails loudly to the extension
 *     (the banner says so too). Rejecting — rather than no-oping — is what keeps
 *     a protocol-v2 extension that `await`s these calls from hanging in an
 *     exported file. The canvas's files are deliberately NOT inlined: it would
 *     multiply the export size with no bound.
 *   - `capabilitiesJs` is NEVER shipped — capability code stays server-only.
 *
 * Portability & safety, enforced here by construction:
 *   - The iframe keeps the live view's sandbox — `allow-scripts` ONLY, never
 *     `allow-same-origin` — so arbitrary extension UI stays isolated and cannot
 *     reach any origin, cookie, or API.
 *   - The frozen-state JSON is embedded with `<` escaped to `<`, so a state
 *     value literally containing `</script>` cannot break out of the inner
 *     `<script>`; the whole srcdoc is then HTML-attribute-escaped (`&`, `"`).
 *   - External references in `uiHtml` (`<script src>`, `<link>`) are neutralized —
 *     they would break offline portability — and any residual absolute network URL
 *     is reported as a warning rather than silently shipped.
 *
 * A JSX-authored extension (`uiJs` + declared libraries) takes a parallel path:
 * the vendored bundles are fetched by the caller and INLINED here, then the same
 * runtime the live panel uses mounts the artifact with no asset base — so a
 * chart that renders in the panel renders in the exported file by the same code.
 * Bundles push these exports to roughly 0.5–1 MB, which is surfaced as a
 * warning; a bundle that could not be fetched produces an explicit "libraries
 * unavailable" banner inside the frame, never a silently blank one.
 *
 * Pure, Node-safe, and deterministic (no DOM, no `fetch`, no `Date.now()` /
 * `Math.random()`), so the same input yields byte-identical output and the layer
 * unit-tests with plain strings. Layer A/E wrap the returned body into the final
 * document and embed the frozen state as the recoverable source.
 */

import { CANVAS_HOST_VERSION } from '../canvas-host-protocol';
import { buildExtensionRootHtml, buildExtensionRuntimeScript } from '../extension-runtime';
import { CANVAS_LIBRARIES } from '../../../../../../canvas/canvas-libraries';
import type { CanvasLibraryId } from '../../../../../../canvas/canvas-libraries';

/** Input for building the offline extension export body. */
export interface ExtensionExportInput {
    /** The extension's self-contained UI HTML (from `CanvasExtension.uiHtml`). */
    uiHtml: string;
    /**
     * The compiled UI of a JSX-authored extension (`CanvasExtension.uiJs`).
     * When present it replaces `uiHtml`: the snapshot inlines the declared
     * library bundles and mounts through the same runtime the live panel uses.
     */
    uiJs?: string;
    /** Declared libraries, dependency-resolved and in load order. */
    libraries?: readonly CanvasLibraryId[];
    /** Library id → fetched bundle source, from `resolveLibraryBundles`. */
    libraryBundles?: ReadonlyMap<CanvasLibraryId, string>;
    /** Libraries that could not be fetched — surfaced as an explicit banner. */
    missingLibraries?: readonly CanvasLibraryId[];
    /** The canvas's current JSON state, as the raw `content` string. */
    stateContent: string;
    /** Canvas title — used for the iframe `title` attribute. */
    title: string;
    /** Current canvas revision, surfaced to the extension via `onState` meta. Defaults to 0. */
    revision?: number;
}

/**
 * Inlined-library payload above which the export warns. A React + Recharts +
 * Tailwind artifact lands near 1 MB, which a user pressing "export" deserves to
 * be told about rather than discover in their downloads folder.
 */
const LIBRARY_SIZE_WARN_BYTES = 400 * 1024;

/** Result of building the offline extension body. */
export interface ExtensionExportResult {
    /** Body HTML: a view-only banner + the sandboxed iframe hosting the frozen UI. */
    bodyHtml: string;
    /** The frozen state serialized as pretty JSON (Layer A embeds it as recoverable source). */
    stateJson: string;
    /** Non-fatal issues (invalid state, neutralized external references, residual network URLs). */
    warnings: string[];
}

/** Escape text for an HTML text/attribute context (attributes are double-quoted). */
function escapeHtml(value: string): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Escape a string for use as a double-quoted `srcdoc` attribute value. Only `&`
 * and `"` may terminate the attribute; `<`/`>` MUST stay literal so the browser
 * parses the srcdoc as HTML. `&` is escaped first so the `"`→`&quot;` output is
 * not double-escaped.
 */
function escapeSrcdocAttr(value: string): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

/**
 * Serialize a value to a JSON literal that is safe to embed inside an inline
 * `<script>`: `<` → `<` prevents a `</script>` (or `<!--`) inside a string
 * from terminating the element, and the U+2028/U+2029 line separators — legal in
 * JSON but historically illegal in JS string literals — are escaped too.
 */
function toEmbeddableJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * Parse the canvas `content` string into the frozen state the extension will see.
 * Mirrors `ExtensionCanvasView.parseState`, but degrades a malformed document to
 * an empty object (a safe fallback the UI can render) plus a warning, rather than
 * to `null` — the export must never crash or ship a broken state.
 */
function parseFrozenState(stateContent: string, warnings: string[]): unknown {
    const trimmed = String(stateContent ?? '').trim();
    if (!trimmed) return {};
    try {
        return JSON.parse(trimmed);
    } catch {
        warnings.push('Canvas state is not valid JSON — exported with an empty state.');
        return {};
    }
}

/**
 * Neutralize the external references an extension's `uiHtml` is not supposed to
 * contain (its contract says it is self-contained). Removing them keeps the
 * exported file portable and offline; each removal records a warning. A residual
 * absolute network URL (which cannot be safely rewritten out of arbitrary inline
 * JS) is reported but left in place, so the caller can surface it.
 */
function neutralizeExternalReferences(html: string): { html: string; warnings: string[] } {
    const warnings: string[] = [];
    let out = String(html ?? '');

    // External <script src="…"> — would fetch code over the network. Drop the
    // open tag plus an immediately-following (whitespace-only body) close tag, so
    // an unrelated inline <script> later in the document is never gobbled.
    out = out.replace(
        /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*(?:<\/script\s*>)?/gi,
        () => {
            warnings.push('Removed an external <script src> — an offline export cannot load remote code.');
            return '<!-- external script removed for offline export -->';
        },
    );

    // <link …> — stylesheet / icon / preload references to external resources.
    out = out.replace(/<link\b[^>]*>/gi, () => {
        warnings.push('Removed a <link> reference — an offline export inlines nothing external.');
        return '<!-- external link removed for offline export -->';
    });

    // Residual absolute network URLs, excluding XML namespaces (never fetched).
    const networkUrls = out.match(/\bhttps?:\/\/(?!www\.w3\.org\/)[^\s"'<>]+/gi);
    if (networkUrls && networkUrls.length > 0) {
        const n = networkUrls.length;
        warnings.push(
            `Extension UI references ${n} external URL${n === 1 ? '' : 's'} — ` +
                'these will not load in the offline snapshot.',
        );
    }

    return { html: out, warnings };
}

/**
 * Build the offline `CanvasHost` bootstrap script injected ahead of the extension
 * `uiHtml` inside the iframe. It delivers the frozen state to `onState`; there is
 * no server and no persistence, so `invoke`/`setState` reject rather than doing
 * anything — nothing in the exported file can call a CoC route, run a capability,
 * or save state.
 *
 * The rejection is what makes the degradation honest under protocol v2: a v2
 * extension `await`s these calls, so an inert no-op returning `undefined` (or a
 * promise that never settles) would hang the exported page instead of letting the
 * extension show its own "unavailable" state. Each rejected promise gets a
 * no-op `catch` attached before it is handed out, so an extension that fires and
 * forgets does not raise an unhandled rejection in the exported page — while an
 * extension that awaits still observes `code: 'offline'`.
 */
function buildOfflineBootstrap(frozenState: unknown, title: string, revision: number): string {
    const stateLiteral = toEmbeddableJson(frozenState);
    const metaLiteral = toEmbeddableJson({ revision, title });
    return (
        '<script>\n' +
        '(function () {\n' +
        `    var STATE = ${stateLiteral};\n` +
        `    var META = ${metaLiteral};\n` +
        '    function offline(method) {\n' +
        '        return function () {\n' +
        "            var err = new Error('CanvasHost.' + method + ' is unavailable in this view-only snapshot — there is no server and nothing is saved.');\n" +
        "            err.code = 'offline';\n" +
        '            var rejected = Promise.reject(err);\n' +
        '            rejected.catch(function () { /* observed on await; silent when ignored */ });\n' +
        '            return rejected;\n' +
        '        };\n' +
        '    }\n' +
        '    window.CanvasHost = {\n' +
        `        version: ${CANVAS_HOST_VERSION},\n` +
        '        onState: function (cb) {\n' +
        "            if (typeof cb !== 'function') return;\n" +
        '            try { cb(STATE, META); } catch (e) { /* extension render error — leave as-is */ }\n' +
        '        },\n' +
        "        invoke: offline('invoke'),\n" +
        "        setState: offline('setState'),\n" +
        // Files are NOT inlined into the export: it would multiply the file size
        // with no bound and no story for what happens at 100 MB. The artifact is
        // told so, loudly, rather than hanging on a promise that never settles.
        "        listFiles: offline('listFiles'),\n" +
        "        readFile: offline('readFile'),\n" +
        '    };\n' +
        '})();\n' +
        '</script>'
    );
}

/**
 * Inline a vendored bundle into the snapshot. `</script`/`</style` inside the
 * payload would terminate the element early; neither appears in the bundles we
 * ship, and the escape is a no-op when it does not, so it costs nothing to be
 * certain. The JS form (`<\/script`) is valid inside a string literal, which is
 * the only place such a sequence can legally occur in JS.
 */
function inlineLibrary(id: CanvasLibraryId, source: string): string {
    if (CANVAS_LIBRARIES[id].kind === 'stylesheet') {
        return `<style>\n${source.replace(/<\/style/gi, '<\\/style')}\n</style>`;
    }
    return `<script>\n${source.replace(/<\/script/gi, '<\\/script')}\n</script>`;
}

/**
 * Build the offline snapshot for a JSX-authored extension: the library bundles
 * inlined verbatim, then the SAME runtime script the live panel uses — with no
 * asset base, because nothing needs loading. An artifact that mounts in the
 * panel therefore mounts here by the same code path.
 *
 * A library that could not be fetched is called out in a banner inside the
 * frame. The runtime still runs, so its own failure reporting fires too: what
 * must never happen is a frame that is simply blank.
 */
function buildJsxSnapshot(input: ExtensionExportInput, frozenState: unknown, warnings: string[]): string {
    const libraries = input.libraries ?? [];
    const bundles = input.libraryBundles ?? new Map<CanvasLibraryId, string>();
    const missing = input.missingLibraries ?? libraries.filter(id => !bundles.has(id));

    let inlinedBytes = 0;
    const inlined = libraries
        .map(id => {
            const source = bundles.get(id);
            if (source === undefined) return '';
            inlinedBytes += source.length;
            return inlineLibrary(id, source);
        })
        .filter(Boolean)
        .join('\n');

    if (missing.length > 0) {
        warnings.push(
            `Could not inline ${missing.length} canvas librar${missing.length === 1 ? 'y' : 'ies'} `
            + `(${missing.join(', ')}) — the exported artifact shows an "unavailable" notice instead of rendering.`,
        );
    }
    if (inlinedBytes > LIBRARY_SIZE_WARN_BYTES) {
        warnings.push(
            `This export bundles ${Math.round(inlinedBytes / 1024)} KB of libraries `
            + `(${libraries.join(', ')}) so it renders offline.`,
        );
    }

    const missingBanner = missing.length > 0
        ? `<div data-canvas-extension-error style="margin:12px;padding:10px 12px;border:1px solid #fca5a5;`
          + `background:#fef2f2;color:#991b1b;border-radius:6px;font:13px/1.5 ui-sans-serif,system-ui,sans-serif">`
          + `Libraries unavailable: ${escapeHtml(missing.join(', '))}. `
          + `This snapshot was exported without them, so the artifact cannot render.</div>\n`
        : '';

    return [
        buildOfflineBootstrap(frozenState, input.title ?? '', input.revision ?? 0),
        missingBanner + buildExtensionRootHtml(),
        inlined,
        // No assetBase: the bundles are already present, so the runtime mounts
        // immediately instead of loading anything.
        buildExtensionRuntimeScript({ uiJs: input.uiJs ?? '', libraries }),
    ].filter(Boolean).join('\n');
}

/** The view-only banner shown above the exported extension iframe. */
const VIEW_ONLY_BANNER =
    '<div class="canvas-export__viewonly-banner" role="note">' +
    'View-only snapshot — interactive actions are disabled and no data is saved.' +
    '</div>';

/**
 * Build the offline, view-only body for an extension canvas export. Returns the
 * body HTML (banner + sandboxed iframe), the frozen state as pretty JSON (for the
 * recoverable source script), and any non-fatal warnings. Never throws.
 */
export function buildExtensionExportBody(input: ExtensionExportInput): ExtensionExportResult {
    const warnings: string[] = [];
    const frozenState = parseFrozenState(input.stateContent, warnings);
    const stateJson = JSON.stringify(frozenState, null, 2);

    // Two authoring paths. A JSX extension has no user HTML to neutralize — its
    // externals are the vendored bundles, which are inlined rather than stripped.
    let frameContent: string;
    if (input.uiJs) {
        frameContent = buildJsxSnapshot(input, frozenState, warnings);
    } else {
        const { html: safeUiHtml, warnings: refWarnings } = neutralizeExternalReferences(input.uiHtml ?? '');
        warnings.push(...refWarnings);
        const bootstrap = buildOfflineBootstrap(frozenState, input.title ?? '', input.revision ?? 0);
        frameContent = `${bootstrap}\n${safeUiHtml}`;
    }
    const srcdoc = escapeSrcdocAttr(frameContent);

    const bodyHtml =
        '<div class="canvas-export__extension">\n' +
        VIEW_ONLY_BANNER +
        '\n' +
        '<iframe class="canvas-export__extension-frame" sandbox="allow-scripts"' +
        ` title="${escapeHtml(input.title ?? '')}" srcdoc="${srcdoc}"></iframe>\n` +
        '</div>';

    return { bodyHtml, stateJson, warnings };
}
