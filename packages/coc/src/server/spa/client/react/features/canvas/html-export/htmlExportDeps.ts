/**
 * Layer F helper — builds the production `ExportCanvasAsHtmlDeps` for the
 * "Export as HTML" action in `CanvasPanel`.
 *
 * Every heavy, browser-only renderer is supplied here and kept OUT of the
 * orchestrator (Layer E) so Node-based unit tests never load them:
 *   - markdown → HTML via `chatMarkdownToHtml` (the same renderer the on-screen
 *     preview uses, called with a workspace id so local images become proxy URLs
 *     that Layer B can inline);
 *   - assets via the browser `fetch`;
 *   - mermaid via the CDN-loaded `mermaid.render` (lazy — `ensureMermaid` injects
 *     the runtime the first time it is needed; only the rendered SVG ships);
 *   - excalidraw via `@excalidraw/excalidraw`'s `exportToSvg`, **dynamically
 *     imported on first use** so the ~MB runtime is code-split out of the main
 *     bundle and — critically — never pulled into a Node test module graph (it
 *     cannot even load under Node ≥ 24);
 *   - the DOM download via `browserDownload`.
 *
 * This module is imported only by CanvasPanel (a browser context) — never by a
 * node-project test — and it defers the mermaid/excalidraw loads to first use, so
 * importing it stays cheap and Node-safe. The CanvasPanel component test mocks
 * `exportCanvasAsHtml`, so these dependencies are constructed but never invoked
 * there.
 */

import { chatMarkdownToHtml } from '../../chat/conversation/ConversationTurnBubble';
import { ensureMermaid } from '../../../hooks/ui/useMermaid';
import { getExportKatexCss } from '../../../../shared/math/katexCssExtract';
import { browserDownload } from './exportCanvasAsHtml';
import type { ExportCanvasAsHtmlDeps } from './exportCanvasAsHtml';
import type { MermaidRenderResult } from './mermaid';
import type { ExcalidrawExportToSvgFn } from './excalidraw';

// mermaid is CDN-loaded onto the global by `ensureMermaid`; declare the one
// method this module calls so it can be used without a bundled type dependency.
declare const mermaid: {
    render(id: string, code: string): Promise<MermaidRenderResult>;
};

/**
 * Rasterize an excalidraw scene to SVG using the real `exportToSvg`, dynamically
 * imported so the runtime is code-split out of the main bundle and only fetched
 * when a diagram is actually exported. Fonts are left to excalidraw's default
 * inlining so the resulting SVG stays self-contained.
 */
const lazyExportToSvg: ExcalidrawExportToSvgFn = async (input) => {
    const mod = await import('@excalidraw/excalidraw');
    return mod.exportToSvg(input as Parameters<typeof mod.exportToSvg>[0]);
};

/**
 * Build the browser dependency set for `exportCanvasAsHtml`. Cheap to call — it
 * only wires closures; mermaid and excalidraw load lazily on first render, so a
 * canvas that uses neither pays nothing.
 */
export function createHtmlExportDeps(): ExportCanvasAsHtmlDeps {
    return {
        renderMarkdown: (content, workspaceId) => chatMarkdownToHtml(content, workspaceId),
        fetch: (url) => fetch(url),
        mermaidApi: {
            render: async (id, code) => {
                await ensureMermaid();
                return mermaid.render(id, code);
            },
        },
        exportToSvg: lazyExportToSvg,
        triggerDownload: browserDownload,
        // Extract KaTeX styling (with its already-inlined fonts) from the loaded
        // app stylesheets so exported math renders offline; memoized after the
        // first non-empty read.
        getMathCss: () => getExportKatexCss(),
    };
}
