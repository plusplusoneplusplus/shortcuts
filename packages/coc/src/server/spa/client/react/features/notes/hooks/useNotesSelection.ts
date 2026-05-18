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
 * Hook for managing multi-selection of notes pages.
 * Supports Shift+Click (range), Ctrl/Cmd+Click (toggle), and plain click (single).
 */
export function useNotesSelection(): UseNotesSelectionResult {
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [anchorPath, setAnchorPath] = useState<string | null>(null);

    const handleSelect = useCallback((path: string, modifiers: SelectionModifiers, flatPageList: string[]) => {
        if (modifiers.shift) {
            // Range selection: from anchor to clicked path
            const anchor = anchorPath;
            if (!anchor || !flatPageList.includes(anchor)) {
                // No valid anchor — treat as single selection
                setSelectedPaths(new Set([path]));
                setAnchorPath(path);
                return;
            }
            const anchorIdx = flatPageList.indexOf(anchor);
            const targetIdx = flatPageList.indexOf(path);
            if (targetIdx === -1) {
                // path not in flat list — ignore
                return;
            }
            const start = Math.min(anchorIdx, targetIdx);
            const end = Math.max(anchorIdx, targetIdx);
            const range = flatPageList.slice(start, end + 1);
            // Union with existing Ctrl-selections (keep prior selections not in the range area)
            setSelectedPaths(prev => {
                const next = new Set(prev);
                for (const p of range) next.add(p);
                return next;
            });
            // Anchor stays the same on shift-click
        } else if (modifiers.ctrl) {
            // Toggle selection
            setSelectedPaths(prev => {
                const next = new Set(prev);
                if (next.has(path)) {
                    next.delete(path);
                } else {
                    next.add(path);
                }
                return next;
            });
            setAnchorPath(path);
        } else {
            // Plain click — single selection
            setSelectedPaths(new Set([path]));
            setAnchorPath(path);
        }
    }, [anchorPath]);

    const clearSelection = useCallback(() => {
        setSelectedPaths(new Set());
        setAnchorPath(null);
    }, []);

    return { selectedPaths, anchorPath, handleSelect, clearSelection };
}
