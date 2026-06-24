/**
 * Excalidraw scene validation + normalization for the canvas write path.
 *
 * `excalidraw` canvases store an Excalidraw scene (`{ elements, appState }`) as
 * their artifact content — a JSON string. The AI emits a "skeleton" scene:
 * elements that carry only the visible attributes (id/type/x/y/width/height/
 * text/points/...) but omit Excalidraw's internal bookkeeping fields
 * (`version`, `versionNonce`, `groupIds`, `isDeleted`, `seed`, default style
 * fields, ...). We complete those fields here, server-side, before persisting
 * so the stored scene is a renderable `{ elements, appState }`.
 *
 * Why this normalizer is pure and dependency-free:
 *   The richer client-side completion in
 *   `spa/client/react/features/diagrams/diagram-scene.ts` pipes elements
 *   through `convertToExcalidrawElements` / `restoreElements` from
 *   `@excalidraw/excalidraw`. That package cannot be imported in Node — it
 *   imports `open-color.json` without a JSON import attribute, which throws on
 *   Node ≥ 24 (`needs an import attribute of "type: json"`). So the server
 *   write path uses this self-contained normalizer instead. The browser viewer
 *   still runs the full Excalidraw normalization at render time, so no render
 *   fidelity is lost — server normalization is the persisted floor, client
 *   normalization is the render ceiling.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Types
// ============================================================================

export interface ExcalidrawScene {
    elements: any[];
    appState: Record<string, any>;
    files?: Record<string, any>;
    [key: string]: any;
}

export type NormaliseSceneResult =
    | { ok: true; scene: ExcalidrawScene; content: string }
    | { ok: false; error: string };

// ============================================================================
// Element completion
// ============================================================================

/**
 * Deterministic positive integer per element index. Excalidraw uses random
 * `seed` / `versionNonce` integers; we derive stable ones (no `Math.random`)
 * so normalization stays pure and test output is reproducible.
 */
function pseudoNonce(index: number, salt = 0): number {
    return ((index + 1) * 1_000_003 + salt * 97) % 2_147_483_647;
}

/** Set keys on `target` only when the existing value is `undefined`. */
function fillDefaults(target: Record<string, any>, defaults: Record<string, any>): void {
    for (const key of Object.keys(defaults)) {
        if (target[key] === undefined) target[key] = defaults[key];
    }
}

/**
 * Complete a single skeleton element with the bookkeeping + default-style
 * fields Excalidraw expects, without overwriting any field the author set.
 */
function completeElement(raw: any, index: number): any {
    const el: Record<string, any> = { ...raw };

    fillDefaults(el, {
        id: `el-${index}`,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: pseudoNonce(index, 1),
        version: 1,
        versionNonce: pseudoNonce(index, 2),
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
    });

    if (el.type === 'text') {
        fillDefaults(el, {
            text: '',
            fontSize: 20,
            fontFamily: 1,
            textAlign: 'left',
            verticalAlign: 'top',
            containerId: null,
            lineHeight: 1.25,
            autoResize: true,
        });
        if (el.originalText === undefined) el.originalText = el.text;
    }

    if (el.type === 'arrow' || el.type === 'line') {
        fillDefaults(el, {
            points: [[0, 0], [el.width ?? 0, el.height ?? 0]],
            lastCommittedPoint: null,
            startBinding: null,
            endBinding: null,
            startArrowhead: null,
            endArrowhead: el.type === 'arrow' ? 'arrow' : null,
        });
    }

    return el;
}

/**
 * Normalise skeleton scene elements into renderable Excalidraw elements.
 *
 * Pure server-side counterpart of the client viewer's `normaliseSceneElements`
 * (which uses `@excalidraw/excalidraw`, unavailable in Node). Fills the common
 * bookkeeping + style defaults LLM-emitted elements omit, preserving every
 * field the author already supplied. Non-object entries are dropped.
 */
export function normaliseSceneElements(elements: any[]): any[] {
    if (!Array.isArray(elements) || elements.length === 0) return [];
    const out: any[] = [];
    elements.forEach((el, index) => {
        if (el && typeof el === 'object' && !Array.isArray(el)) {
            out.push(completeElement(el, index));
        }
    });
    return out;
}

// ============================================================================
// Scene validation + normalization
// ============================================================================

function parseSceneInput(raw: unknown): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            return { ok: false, error: 'Excalidraw canvas content must be valid scene JSON ({ elements, appState }).' };
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: 'Excalidraw scene must be a JSON object with "elements" and "appState".' };
    }
    return { ok: true, value: value as Record<string, any> };
}

/**
 * Validate + normalise an Excalidraw scene for persistence.
 *
 * Accepts the raw scene as a JSON string (how `write_canvas` receives it) or a
 * pre-parsed object. Validates the `{ elements, appState }` shape, completes
 * skeleton elements via `normaliseSceneElements`, and returns the pretty-printed
 * JSON string to store as the canvas artifact.
 */
export function normaliseExcalidrawScene(raw: unknown): NormaliseSceneResult {
    const parsed = parseSceneInput(raw);
    if (!parsed.ok) return parsed;
    const value = parsed.value;

    if (value.elements !== undefined && !Array.isArray(value.elements)) {
        return { ok: false, error: 'Excalidraw scene "elements" must be an array.' };
    }
    if (value.appState !== undefined && (typeof value.appState !== 'object' || value.appState === null || Array.isArray(value.appState))) {
        return { ok: false, error: 'Excalidraw scene "appState" must be an object.' };
    }

    const elements = normaliseSceneElements(Array.isArray(value.elements) ? value.elements : []);
    const appState: Record<string, any> = (value.appState && typeof value.appState === 'object' && !Array.isArray(value.appState))
        ? value.appState
        : {};

    const scene: ExcalidrawScene = {
        ...value,
        type: typeof value.type === 'string' ? value.type : 'excalidraw',
        elements,
        appState,
    };

    return { ok: true, scene, content: JSON.stringify(scene, null, 2) };
}
