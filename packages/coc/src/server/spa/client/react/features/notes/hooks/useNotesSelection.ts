import { useState, useCallback } from 'react';

export interface SelectionModifiers {
    shift: boolean;
    ctrl: boolean;
}

export interface UseNotesSelectionResult {
    selectedPaths: Set<string>;
    anchorPath: string | null;
    handleSelect: (path: string, modifiers: SelectionModifiers, flatPageList: string[]) => void;
    clearSelection: () => void;
}

/**
 * Internal selection state.
 *
 * `baseSelection` is the committed selection that a live shift-range extends
 * from — it holds everything selected by plain/Ctrl clicks but NOT the current
 * shift range. Keeping it separate is what lets a second Shift+Click *re-scope*
 * (replace) the range instead of only growing the previous union.
 */
interface NotesSelectionState {
    selectedPaths: Set<string>;
    anchorPath: string | null;
    baseSelection: Set<string>;
}

function emptySelectionState(): NotesSelectionState {
    return { selectedPaths: new Set(), anchorPath: null, baseSelection: new Set() };
}

/**
 * Pure selection reducer. Exported so the grow/re-scope/toggle/reset paths can
 * be exercised directly and reused by keyboard/clipboard callers later.
 *
 * Behaviour:
 *   - Plain click → single selection; anchor + base reset to that row.
 *   - Ctrl/Cmd click → toggle the row in/out; the toggled set is committed as
 *     the new base and the anchor moves to the clicked row.
 *   - Shift click → contiguous range from the anchor to the clicked row, unioned
 *     with the committed base. Because the range is always rebuilt from `base`
 *     (never from the previous selection), a second Shift+Click from the same
 *     anchor replaces the earlier range rather than only extending it.
 */
export function reduceNotesSelection(
    prev: NotesSelectionState,
    path: string,
    modifiers: SelectionModifiers,
    flatPageList: string[],
): NotesSelectionState {
    if (modifiers.shift) {
        const anchor = prev.anchorPath;
        if (!anchor || !flatPageList.includes(anchor)) {
            // No valid anchor — treat as a fresh single selection.
            const single = new Set([path]);
            return { selectedPaths: single, anchorPath: path, baseSelection: new Set(single) };
        }
        const anchorIdx = flatPageList.indexOf(anchor);
        const targetIdx = flatPageList.indexOf(path);
        if (targetIdx === -1) {
            // Clicked row is not in the flat list — ignore.
            return prev;
        }
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const range = flatPageList.slice(start, end + 1);
        // Re-scope: rebuild from the committed base + the fresh range so the
        // previous range is discarded, not accumulated.
        const next = new Set(prev.baseSelection);
        for (const p of range) next.add(p);
        // Anchor and base stay put across shift-clicks.
        return { selectedPaths: next, anchorPath: anchor, baseSelection: prev.baseSelection };
    }

    if (modifiers.ctrl) {
        const next = new Set(prev.selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        // Ctrl commits the toggled set and moves the anchor to the clicked row.
        return { selectedPaths: next, anchorPath: path, baseSelection: new Set(next) };
    }

    // Plain click — single selection.
    const single = new Set([path]);
    return { selectedPaths: single, anchorPath: path, baseSelection: new Set(single) };
}

/**
 * Hook for managing multi-selection of notes rows (pages and folders).
 * Supports Shift+Click (range), Ctrl/Cmd+Click (toggle), and plain click (single).
 */
export function useNotesSelection(): UseNotesSelectionResult {
    const [state, setState] = useState<NotesSelectionState>(emptySelectionState);

    const handleSelect = useCallback((path: string, modifiers: SelectionModifiers, flatPageList: string[]) => {
        setState(prev => reduceNotesSelection(prev, path, modifiers, flatPageList));
    }, []);

    const clearSelection = useCallback(() => {
        setState(emptySelectionState());
    }, []);

    return { selectedPaths: state.selectedPaths, anchorPath: state.anchorPath, handleSelect, clearSelection };
}
