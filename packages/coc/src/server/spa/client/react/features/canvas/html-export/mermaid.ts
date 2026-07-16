/**
 * Layer C — mermaid pre-render for the canvas → self-contained HTML export.
 *
 * `inlineMermaid(html, mermaidApi)` scans rendered markdown body HTML for mermaid
 * diagram blocks and replaces each with the diagram rendered to an inline `<svg>`,
 * so the exported file shows the diagram **without shipping the mermaid runtime**.
 *
 * Two source formats are handled, since both occur in the repo:
 *   1. `chatMarkdownToHtml` (the markdown export path) emits a `.mermaid-container`
 *      div (see forge `renderMermaidContainer`) whose HTML-escaped source lives in
 *      `<div class="mermaid-source"…><code>…</code></div>`.
 *   2. Plain `marked` output — `<pre><code class="language-mermaid">…</code></pre>`.
 *
 * The mermaid API is injected (`{ render(id, code) → { svg } }`, sync or async) so
 * this layer unit-tests with a plain mock and stays decoupled from the real,
 * DOM-bound `mermaid.render`. Rendering runs client-side because mermaid is
 * browser-only; only the resulting SVG string reaches the output.
 *
 * Failure is non-fatal: if the API throws or yields no SVG, the block is replaced
 * with a plain, self-contained `<pre><code class="language-mermaid">` code block
 * preserving the diagram source, and a warning is recorded — the export always
 * completes.
 */

/** The subset of a mermaid render result this layer consumes. */
export interface MermaidRenderResult {
    /** The rendered diagram as a standalone `<svg>…</svg>` string. */
    svg: string;
}

/**
 * Injected mermaid renderer. Mirrors mermaid v10's `render(id, code)` (which
 * returns a Promise); a synchronous `{ svg }` return is also accepted so mocks
 * stay trivial.
 */
export interface MermaidRenderApi {
    render(id: string, code: string): Promise<MermaidRenderResult> | MermaidRenderResult;
}

/** Result of inlining every mermaid block in a body HTML string. */
export interface InlineMermaidResult {
    /** The body HTML with mermaid blocks replaced by inline SVG (or a fallback). */
    html: string;
    /** Non-fatal issues (a block whose render failed and fell back to source). */
    warnings: string[];
}

/**
 * Matches either mermaid block format. Alternative 1 captures the escaped source
 * of a forge `.mermaid-container` (group 1); alternative 2 captures a plain
 * `language-mermaid` code block (group 2). The container's fixed, non-nested
 * markup (`renderMermaidContainer`) ends in `</code></div></div></div>`, so the
 * lazy body match cannot over-run into a following container.
 */
const MERMAID_BLOCK_RE = new RegExp(
    '<div class="mermaid-container"[^>]*>[\\s\\S]*?' +
        '<div class="mermaid-source"[^>]*><code>([\\s\\S]*?)</code></div></div></div>' +
        '|' +
        '<pre><code class="language-mermaid"[^>]*>([\\s\\S]*?)</code></pre>',
    'gi',
);

/** Reverse the HTML entity escaping applied to mermaid source when it was rendered. */
function unescapeHtml(escaped: string): string {
    return escaped
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#0?10;/g, '\n')
        .replace(/&amp;/g, '&');
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * A self-contained fallback for a block whose diagram could not be rendered:
 * the diagram source, preserved verbatim (still escaped), as a plain code block.
 */
function fallbackCodeBlock(escapedSource: string): string {
    return `<pre class="canvas-export__mermaid-fallback"><code class="language-mermaid">${escapedSource}</code></pre>`;
}

interface RenderedBlock {
    replacement: string;
    warning?: string;
}

async function renderBlock(
    escapedSource: string,
    index: number,
    api: MermaidRenderApi,
): Promise<RenderedBlock> {
    const source = unescapeHtml(escapedSource);
    if (!source.trim()) {
        // Nothing to render — drop an empty diagram rather than emitting a spinner.
        return { replacement: '', warning: `Empty mermaid block #${index + 1} — omitted.` };
    }
    // Deterministic id (no Math.random) keeps the export byte-stable.
    const id = `canvas-export-mermaid-${index}`;
    try {
        const result = await api.render(id, source);
        const svg = result?.svg;
        if (!svg || !svg.trim()) {
            return {
                replacement: fallbackCodeBlock(escapedSource),
                warning: `Mermaid block #${index + 1} rendered no SVG — kept as source.`,
            };
        }
        return { replacement: `<div class="canvas-export__mermaid">${svg}</div>` };
    } catch (err) {
        return {
            replacement: fallbackCodeBlock(escapedSource),
            warning: `Failed to render mermaid block #${index + 1} (${errorMessage(err)}) — kept as source.`,
        };
    }
}

/**
 * Replace every mermaid block in `html` with its diagram rendered to inline SVG.
 * Blocks are rendered in document order with deterministic ids; a render failure
 * degrades that one block to a source code block and records a warning without
 * aborting. When no mermaid blocks are present the input is returned unchanged.
 */
export async function inlineMermaid(
    html: string,
    api: MermaidRenderApi,
): Promise<InlineMermaidResult> {
    if (!html) return { html: html ?? '', warnings: [] };

    const matches = Array.from(html.matchAll(MERMAID_BLOCK_RE));
    if (matches.length === 0) return { html, warnings: [] };

    const rendered = await Promise.all(
        matches.map((m, i) => renderBlock(m[1] ?? m[2] ?? '', i, api)),
    );

    let out = '';
    let last = 0;
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const start = m.index ?? 0;
        out += html.slice(last, start);
        out += rendered[i].replacement;
        last = start + m[0].length;
    }
    out += html.slice(last);

    const warnings = rendered
        .map((r) => r.warning)
        .filter((w): w is string => Boolean(w));

    return { html: out, warnings };
}
