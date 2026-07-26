import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Per-note zoom store for the individual note page (`NoteEditor`).
 *
 * The chosen zoom level scales the note content body via the CSS `zoom`
 * property (see AC-02) and is remembered per note in `localStorage` so a note
 * reopens at the level it was last read at. It is browser-local only — never
 * synced to the server and never a note edit (no dirty state / save).
 *
 * Storage shape mirrors `useNoteSeenState.ts`: one per-workspace JSON blob under
 * key `coc-notes-zoom-<workspaceId>` mapping the normalized note path → zoom
 * level (a percentage number). Note identity is the normalized path within the
 * workspace (the stable within-workspace id). A note that has never been zoomed
 * defaults to 100%.
 *
 * The persist behaviour mirrors `NotesSidebarCollapse.ts`: lazy `useState` init
 * from storage, a persist `useEffect`, and a `skipPersistRef` so mounting or
 * switching notes/workspaces (which re-reads the stored level) does not write
 * back — only an explicit user zoom persists.
 */

/** Minimum zoom percentage. */
export const NOTE_ZOOM_MIN = 50;
/** Maximum zoom percentage. */
export const NOTE_ZOOM_MAX = 200;
/** Step (percentage points) for the `+` / `−` buttons and keyboard shortcuts. */
export const NOTE_ZOOM_STEP = 10;
/** Default zoom for a note that has never been zoomed. */
export const NOTE_ZOOM_DEFAULT = 100;
/** Preset levels offered by the percentage-readout dropdown. */
export const NOTE_ZOOM_PRESETS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200] as const;

/** Clamp an arbitrary number into the [min, max] zoom range (rounded to an integer %). */
export function clampNoteZoom(level: number): number {
    if (!Number.isFinite(level)) return NOTE_ZOOM_DEFAULT;
    return Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, Math.round(level)));
}

/** localStorage key for the per-workspace note-zoom blob. */
export function noteZoomStorageKey(workspaceId: string): string {
    return `coc-notes-zoom-${workspaceId}`;
}

type ZoomMap = Record<string, number>;

/** Read the per-workspace path→level blob; tolerant of missing / corrupt data. */
function readZoomMap(storageKey: string): ZoomMap {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const map: ZoomMap = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                map[key] = value;
            }
        }
        return map;
    } catch {
        return {};
    }
}

/** Read a single note's persisted zoom level; `NOTE_ZOOM_DEFAULT` when absent. */
export function readNoteZoom(storageKey: string, notePath: string): number {
    if (!notePath) return NOTE_ZOOM_DEFAULT;
    const level = readZoomMap(storageKey)[notePath];
    return typeof level === 'number' ? clampNoteZoom(level) : NOTE_ZOOM_DEFAULT;
}

/** Persist a single note's zoom level. No-op when unchanged, so switching notes
 *  (which re-reads the same stored value) never dirties storage. Never throws. */
function writeNoteZoom(storageKey: string, notePath: string, level: number): void {
    if (typeof window === 'undefined' || !notePath) return;
    try {
        const map = readZoomMap(storageKey);
        if (map[notePath] === level) return;
        map[notePath] = level;
        window.localStorage.setItem(storageKey, JSON.stringify(map));
    } catch {
        /* ignore */
    }
}

export interface UseNoteZoomResult {
    /** Current zoom percentage (e.g. `100`). */
    zoom: number;
    /** Set an explicit level (clamped to [min, max]). */
    setZoom: (level: number) => void;
    /** Step up by `NOTE_ZOOM_STEP`, clamped to the max. */
    zoomIn: () => void;
    /** Step down by `NOTE_ZOOM_STEP`, clamped to the min. */
    zoomOut: () => void;
    /** Reset to `NOTE_ZOOM_DEFAULT` (100%). */
    reset: () => void;
    /** False once the max is reached (disables the `+` button). */
    canZoomIn: boolean;
    /** False once the min is reached (disables the `−` button). */
    canZoomOut: boolean;
}

/**
 * Persisted, per-note zoom level for the individual note page. Restores the
 * remembered level when the note (or workspace) changes, and only writes to
 * storage on an explicit user zoom — never on mount or on a note/workspace
 * switch (`skipPersistRef`).
 */
export function useNoteZoom(workspaceId: string, notePath: string): UseNoteZoomResult {
    const storageKey = useMemo(() => noteZoomStorageKey(workspaceId), [workspaceId]);
    const [zoom, setZoomState] = useState(() => readNoteZoom(storageKey, notePath));
    // Suppress the persist effect for the initial value and for values loaded on
    // a note/workspace switch — those are reads, not user intent.
    const skipPersistRef = useRef(true);

    useEffect(() => {
        skipPersistRef.current = true;
        setZoomState(readNoteZoom(storageKey, notePath));
    }, [storageKey, notePath]);

    useEffect(() => {
        if (skipPersistRef.current) {
            skipPersistRef.current = false;
            return;
        }
        writeNoteZoom(storageKey, notePath, zoom);
    }, [zoom, storageKey, notePath]);

    const setZoom = useCallback((level: number) => {
        setZoomState(clampNoteZoom(level));
    }, []);
    const zoomIn = useCallback(() => {
        setZoomState(prev => clampNoteZoom(prev + NOTE_ZOOM_STEP));
    }, []);
    const zoomOut = useCallback(() => {
        setZoomState(prev => clampNoteZoom(prev - NOTE_ZOOM_STEP));
    }, []);
    const reset = useCallback(() => {
        setZoomState(NOTE_ZOOM_DEFAULT);
    }, []);

    return {
        zoom,
        setZoom,
        zoomIn,
        zoomOut,
        reset,
        canZoomIn: zoom < NOTE_ZOOM_MAX,
        canZoomOut: zoom > NOTE_ZOOM_MIN,
    };
}
