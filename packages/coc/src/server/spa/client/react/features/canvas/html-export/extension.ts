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
 *   - `CanvasHost.invoke` and `CanvasHost.setState` are INERT no-ops. There is no
 *     server to run a capability and no store to persist to, so any human action
 *     that would normally mutate state simply does nothing (the banner says so).
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
 * Pure, Node-safe, and deterministic (no DOM, no `fetch`, no `Date.now()` /
 * `Math.random()`), so the same input yields byte-identical output and the layer
 * unit-tests with plain strings. Layer A/E wrap the returned body into the final
 * document and embed the frozen state as the recoverable source.
 */

/** Input for building the offline extension export body. */
export interface ExtensionExportInput {
    /** The extension's self-contained UI HTML (from `CanvasExtension.uiHtml`). */
    uiHtml: string;
    /** The canvas's current JSON state, as the raw `content` string. */
    stateContent: string;
    /** Canvas title — used for the iframe `title` attribute. */
    title: string;
    /** Current canvas revision, surfaced to the extension via `onState` meta. Defaults to 0. */
    revision?: number;
}

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
 * `uiHtml` inside the iframe. It delivers the frozen state to `onState` and makes
 * `invoke`/`setState` inert — no server, no persistence — so nothing in the
 * exported file can call a CoC route, run a capability, or save state.
 */
function buildOfflineBootstrap(frozenState: unknown, title: string, revision: number): string {
    const stateLiteral = toEmbeddableJson(frozenState);
    const metaLiteral = toEmbeddableJson({ revision, title });
    return (
        '<script>\n' +
        '(function () {\n' +
        `    var STATE = ${stateLiteral};\n` +
        `    var META = ${metaLiteral};\n` +
        '    function inert() { /* view-only snapshot — no server, no persistence */ }\n' +
        '    window.CanvasHost = {\n' +
        '        onState: function (cb) {\n' +
        "            if (typeof cb !== 'function') return;\n" +
        '            try { cb(STATE, META); } catch (e) { /* extension render error — leave as-is */ }\n' +
        '        },\n' +
        '        invoke: inert,\n' +
        '        setState: inert,\n' +
        '    };\n' +
        '})();\n' +
        '</script>'
    );
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

    const { html: safeUiHtml, warnings: refWarnings } = neutralizeExternalReferences(input.uiHtml ?? '');
    warnings.push(...refWarnings);

    const bootstrap = buildOfflineBootstrap(frozenState, input.title ?? '', input.revision ?? 0);
    const srcdoc = escapeSrcdocAttr(`${bootstrap}\n${safeUiHtml}`);

    const bodyHtml =
        '<div class="canvas-export__extension">\n' +
        VIEW_ONLY_BANNER +
        '\n' +
        '<iframe class="canvas-export__extension-frame" sandbox="allow-scripts"' +
        ` title="${escapeHtml(input.title ?? '')}" srcdoc="${srcdoc}"></iframe>\n` +
        '</div>';

    return { bodyHtml, stateJson, warnings };
}
