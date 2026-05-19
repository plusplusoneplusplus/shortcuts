/**
 * Helpers for normalising Excalidraw scene data returned by the diagrams REST API.
 *
 * The `GET /api/workspaces/:id/diagrams/:filename` endpoint wraps the scene
 * inside a `content` field along with metadata (sizeBytes, createdAt, ...).
 * Viewer components need just the scene, so we unwrap it and guarantee the
 * shape expected by `@excalidraw/excalidraw`'s `initialData` prop.
 */

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
 * Build the `initialData` object for `<Excalidraw />` in view-only mode.
 *
 * Guarantees a safe `appState` (with `collaborators` Map and view-mode flags)
 * even if the stored scene's `appState` is missing fields, which would
 * otherwise trip Excalidraw's first-render assertions.
 */
export function buildViewerInitialData(scene: ExcalidrawScene) {
    return {
        elements: scene.elements,
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
