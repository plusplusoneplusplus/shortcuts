/**
 * AC-04 — keyboard shortcuts for the per-note zoom.
 *
 * Maps a `Cmd/Ctrl` + key combo to a zoom action so the individual note page
 * can be zoomed from the keyboard:
 *   - `Cmd/Ctrl` `=` / `+` → zoom in one step
 *   - `Cmd/Ctrl` `-` / `_` → zoom out one step
 *   - `Cmd/Ctrl` `0`       → reset to 100%
 *
 * The handler is wired onto the note-editor container (not `window`), so it only
 * fires while focus is within the note editor — that focus scoping is the guard
 * that keeps these shortcuts from hijacking the browser's global page-zoom
 * elsewhere. When it does handle a key it calls `preventDefault()` to override
 * the browser's default page-zoom while the note editor is focused.
 */

export interface NoteZoomKeyActions {
    /** Step up by one zoom increment (clamped to the max). */
    zoomIn: () => void;
    /** Step down by one zoom increment (clamped to the min). */
    zoomOut: () => void;
    /** Reset to the default (100%). */
    reset: () => void;
}

/** Minimal keyboard-event shape consumed by {@link handleNoteZoomKey}. */
export interface NoteZoomKeyEvent {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey?: boolean;
    preventDefault: () => void;
}

/**
 * Apply the note-zoom keyboard shortcut for `e`, if it is one. Only combos held
 * with `Cmd`/`Ctrl` (and without `Alt`) are handled; when a combo is handled the
 * event's default (the browser page-zoom) is prevented and the matching action
 * runs. Returns `true` when the key was handled, `false` otherwise.
 */
export function handleNoteZoomKey(e: NoteZoomKeyEvent, actions: NoteZoomKeyActions): boolean {
    // Require exactly the Cmd/Ctrl modifier; Alt-combinations are left to the browser.
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
    switch (e.key) {
        case '=':
        case '+':
            e.preventDefault();
            actions.zoomIn();
            return true;
        case '-':
        case '_':
            e.preventDefault();
            actions.zoomOut();
            return true;
        case '0':
            e.preventDefault();
            actions.reset();
            return true;
        default:
            return false;
    }
}
