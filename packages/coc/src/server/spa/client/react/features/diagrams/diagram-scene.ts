/**
 * Helpers for normalising Excalidraw scene data returned by the diagrams REST API.
 *
 * The `GET /api/workspaces/:id/diagrams/:filename` endpoint wraps the scene
 * inside a `content` field along with metadata (sizeBytes, createdAt, ...).
 * Viewer components need just the scene, so we unwrap it and guarantee the
 * shape expected by `@excalidraw/excalidraw`'s `initialData` prop.
 *
 * LLM-generated diagrams typically use a "skeleton" shape — they carry the
 * visible attributes (id/type/x/y/width/height/text/...) but omit Excalidraw's
 * internal bookkeeping fields (`version`, `versionNonce`, `groupIds`,
 * `isDeleted`, `updated`, `index`, `frameId`, ...). Without those fields the
 * canvas silently renders blank, which is the most common "my diagram is
 * empty" symptom. We pipe the elements through `restoreElements` to fill in
 * those defaults before handing them to the viewer.
 */

import { restoreElements, convertToExcalidrawElements } from '@excalidraw/excalidraw';

export interface ExcalidrawScene {
    elements: any[];
    appState: Record<string, any>;
    files?: Record<string, any>;
}

/**
 * Extract the Excalidraw scene from an API response or accept a raw scene.
 *
 * Accepts:
 *   { content: { elements, appState, files? }, ...metadata }   ← API wrapper
 *   { elements, appState, files? }                              ← raw scene
 *   anything else                                               ← empty scene
 */
export function unwrapDiagramResponse(data: any): ExcalidrawScene {
    if (!data || typeof data !== 'object') {
        return { elements: [], appState: {} };
    }
    const scene = data.content && typeof data.content === 'object' ? data.content : data;
    return {
        elements: Array.isArray(scene.elements) ? scene.elements : [],
        appState: scene.appState && typeof scene.appState === 'object' ? scene.appState : {},
        files: scene.files && typeof scene.files === 'object' ? scene.files : undefined,
    };
}

/**
 * Normalise raw scene elements so Excalidraw can render them.
 *
 * LLM-generated diagrams come in a "skeleton" shape — they carry the visible
 * attributes (id/type/x/y/width/height/text/points/...) but omit Excalidraw's
 * internal bookkeeping fields (`version`, `versionNonce`, `groupIds`,
 * `isDeleted`, `updated`, fractional `index`, default style fields like
 * `roughness`/`opacity`/`strokeStyle`, plus type-specific fields such as
 * `containerId`/`baseline`/`lineHeight` for text and `startBinding`/
 * `endBinding`/`points` defaults for arrows).
 *
 * Strategy:
 *   1. First pipe through `convertToExcalidrawElements`, which understands the
 *      skeleton shape and produces fully-formed Excalidraw elements (filling
 *      in style defaults, text baselines/originalText, arrow point defaults,
 *      and assigning proper fractional `index` values).
 *   2. Then pipe through `restoreElements` for an extra safety net — it
 *      patches anything `convertToExcalidrawElements` left out (e.g. bindings
 *      it could not infer) and guarantees a renderable shape.
 *
 * We pass `regenerateIds: false` so existing element ids survive — that way
 * any references between elements (binding ids, containerId, ...) keep
 * pointing at the right targets. Each step is independently `try`/`catch`-ed
 * so a malformed scene degrades to "best effort" rather than crashing the
 * viewer.
 */
export function normaliseSceneElements(elements: any[]): any[] {
    if (!Array.isArray(elements) || elements.length === 0) return [];

    let next: any[] = elements;
    try {
        const converted = convertToExcalidrawElements(elements as any, { regenerateIds: false });
        if (Array.isArray(converted) && converted.length > 0) {
            next = converted as any[];
        }
    } catch {
        // Fall back to the raw elements; restoreElements below will still try.
    }

    try {
        const restored = restoreElements(next as any, null, { repairBindings: true });
        if (Array.isArray(restored) && restored.length > 0) {
            return restored as any[];
        }
    } catch {
        // Fall through and return whatever `next` is.
    }

    return next;
}

/**
 * Build the `initialData` object for `<Excalidraw />` in view-only mode.
 *
 * Guarantees a safe `appState` (with `collaborators` Map and view-mode flags)
 * even if the stored scene's `appState` is missing fields, which would
 * otherwise trip Excalidraw's first-render assertions. Elements are
 * normalised through `restoreElements` so skeleton inputs from the LLM
 * actually render.
 */
export function buildViewerInitialData(scene: ExcalidrawScene) {
    return {
        elements: normaliseSceneElements(scene.elements),
        appState: {
            viewBackgroundColor: '#ffffff',
            ...scene.appState,
            collaborators: new Map(),
            viewModeEnabled: true,
            zenModeEnabled: true,
            gridModeEnabled: false,
        },
        files: scene.files,
    };
}
