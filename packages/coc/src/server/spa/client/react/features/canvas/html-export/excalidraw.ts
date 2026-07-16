/**
 * Layer D — excalidraw rasterization for the canvas → self-contained HTML export.
 *
 * `excalidrawToInlineSvg(sceneJson, exportToSvg)` turns an excalidraw canvas's
 * serialized scene into an inline `<svg>` string, so the exported file shows the
 * diagram **without shipping the excalidraw runtime**. Any images embedded in the
 * scene (`files`) are inlined as `data:` URIs by excalidraw's own `exportToSvg`
 * (it renders `<image>` with the file's `dataURL`), keeping the output
 * self-contained.
 *
 * `exportToSvg` (from `@excalidraw/excalidraw`) is browser-only, DOM-bound, and —
 * critically — **cannot even load under Node ≥ 24** (see
 * `test/server/canvas/excalidraw-scene.test.ts`). It is therefore injected, and
 * this layer stays free of any `@excalidraw/excalidraw` import: it parses the
 * scene with a tiny local JSON reader (mirroring the diagrams' `parseSceneContent`
 * / `unwrapDiagramResponse`) and passes the raw elements straight through. Scenes
 * are persisted **already server-normalized** (see the diagrams `diagram-scene`
 * module), so no client-side `convertToExcalidrawElements` / `restoreElements`
 * pass is required here; a caller that wants the on-screen viewer's extra
 * normalisation can wrap the injected `exportToSvg`. This keeps Layer D Node-safe
 * and unit-testable with a plain mock.
 *
 * Failure is non-fatal: an empty/malformed scene, or an `exportToSvg` that throws
 * or yields no SVG, degrades to a self-contained placeholder and records a warning
 * — the export always completes.
 */

/** A serialized SVG element, or anything with `outerHTML` (a real SVGSVGElement satisfies this). */
type SvgElementLike = { outerHTML?: string | null } | string | null | undefined;

/**
 * Injected excalidraw SVG exporter. Mirrors `@excalidraw/excalidraw`'s
 * `exportToSvg({ elements, appState, files }) → Promise<SVGSVGElement>`; a
 * synchronous return is also accepted so mocks stay trivial.
 */
export type ExcalidrawExportToSvgFn = (input: {
    elements: readonly any[];
    appState?: Record<string, any>;
    files?: Record<string, any> | null;
    exportPadding?: number;
}) => Promise<SvgElementLike> | SvgElementLike;

/** Result of rasterizing an excalidraw scene to an inline SVG string. */
export interface ExcalidrawToInlineSvgResult {
    /**
     * The scene rendered to an inline `<svg>…</svg>` string on success, or a
     * self-contained placeholder markup string on failure. Either way it is safe
     * to drop straight into the exported document body (Layer A/E wraps it).
     */
    svg: string;
    /** Non-fatal issues (empty/invalid scene, render failure). */
    warnings: string[];
}

/** Minimal parsed scene shape — no `@excalidraw/excalidraw` types (Node-safe). */
interface ParsedScene {
    elements: any[];
    appState: Record<string, any>;
    files?: Record<string, any>;
}

/**
 * Self-contained placeholder for a scene that could not be rendered. Pure markup
 * (styled by `.canvas-export__placeholder` in the embedded CSS) — no external refs,
 * no data URI, so the output stays byte-deterministic and offline-safe.
 */
const EXCALIDRAW_PLACEHOLDER =
    '<span class="canvas-export__placeholder">Diagram unavailable — nothing to render.</span>';

/**
 * Parse a canvas-store `content` string (an Excalidraw scene serialized as JSON)
 * into a minimal renderable shape. Intentionally re-implements the diagrams'
 * `parseSceneContent` + `unwrapDiagramResponse` (accepts either a raw scene or an
 * API `{ content: … }` wrapper) so this layer avoids importing the excalidraw-bound
 * `diagram-scene` module. Malformed/empty content degrades to an empty scene.
 */
function parseScene(sceneJson: string | null | undefined): ParsedScene {
    if (!sceneJson || !sceneJson.trim()) return { elements: [], appState: {} };
    let data: unknown;
    try {
        data = JSON.parse(sceneJson);
    } catch {
        return { elements: [], appState: {} };
    }
    if (!data || typeof data !== 'object') return { elements: [], appState: {} };
    const wrapper = data as { content?: unknown };
    const scene =
        wrapper.content && typeof wrapper.content === 'object'
            ? (wrapper.content as Record<string, unknown>)
            : (data as Record<string, unknown>);
    return {
        elements: Array.isArray(scene.elements) ? scene.elements : [],
        appState:
            scene.appState && typeof scene.appState === 'object'
                ? (scene.appState as Record<string, any>)
                : {},
        files:
            scene.files && typeof scene.files === 'object'
                ? (scene.files as Record<string, any>)
                : undefined,
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Serialize the injected exporter's return value to an SVG string. */
function serializeSvg(el: SvgElementLike): string {
    if (typeof el === 'string') return el;
    if (el && typeof el.outerHTML === 'string') return el.outerHTML;
    // Real SVGSVGElement in a DOM env: fall back to XMLSerializer.
    if (el && typeof el === 'object' && typeof XMLSerializer !== 'undefined') {
        try {
            return new XMLSerializer().serializeToString(el as unknown as Node);
        } catch {
            /* fall through to empty */
        }
    }
    return '';
}

/**
 * Rasterize an excalidraw scene JSON string to an inline `<svg>` string using the
 * injected `exportToSvg`. Embedded scene `files` are passed through so the exporter
 * inlines them as `data:` URIs. An empty scene short-circuits before calling the
 * exporter. Never throws: any parse/render failure returns a self-contained
 * placeholder plus a warning so the overall export always completes.
 */
export async function excalidrawToInlineSvg(
    sceneJson: string,
    exportToSvg: ExcalidrawExportToSvgFn,
): Promise<ExcalidrawToInlineSvgResult> {
    const scene = parseScene(sceneJson);
    if (scene.elements.length === 0) {
        return {
            svg: EXCALIDRAW_PLACEHOLDER,
            warnings: ['Excalidraw scene is empty or invalid — nothing to render.'],
        };
    }

    try {
        const appState = {
            exportBackground: true,
            viewBackgroundColor:
                (typeof scene.appState.viewBackgroundColor === 'string' &&
                    scene.appState.viewBackgroundColor) ||
                '#ffffff',
            exportPadding: 16,
        };
        const rendered = await exportToSvg({
            elements: scene.elements,
            appState,
            files: scene.files ?? null,
        });
        const svg = serializeSvg(rendered);
        if (!svg || !svg.trim()) {
            return {
                svg: EXCALIDRAW_PLACEHOLDER,
                warnings: ['Excalidraw scene rendered no SVG — kept as placeholder.'],
            };
        }
        return { svg, warnings: [] };
    } catch (err) {
        return {
            svg: EXCALIDRAW_PLACEHOLDER,
            warnings: [
                `Failed to render excalidraw scene (${errorMessage(err)}) — kept as placeholder.`,
            ],
        };
    }
}
