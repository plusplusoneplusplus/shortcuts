/**
 * useConversationSelection — manages selected turn indices for partial
 * conversation copy. Supports Ctrl+Click toggle and Shift+Click range select.
 */
import { useState, useRef, useCallback } from 'react';

export interface ConversationSelectionState {
    /** Set of selected turn indices. */
    selectedTurns: Set<number>;
    /** Whether selection mode is active. */
    isSelecting: boolean;
    /** Toggle selection mode on/off. Clears selection when toggling off. */
    toggleSelecting: () => void;
    /** Enter selection mode. */
    startSelecting: () => void;
    /** Exit selection mode and clear selection. */
    stopSelecting: () => void;
    /** Handle a click on a turn. Ctrl+Click toggles, Shift+Click range selects. */
    handleTurnClick: (index: number, event: React.MouseEvent) => void;
    /** Clear all selections without exiting selection mode. */
    clearSelection: () => void;
    /** Select all turn indices in the given range. */
    selectAll: (maxIndex: number) => void;
}

export function useConversationSelection(): ConversationSelectionState {
    const [selectedTurns, setSelectedTurns] = useState<Set<number>>(new Set());
    const [isSelecting, setIsSelecting] = useState(false);
    const lastClickAnchorRef = useRef<number | null>(null);

    const toggleSelecting = useCallback(() => {
        setIsSelecting(prev => {
            if (prev) {
                setSelectedTurns(new Set());
                lastClickAnchorRef.current = null;
            }
            return !prev;
        });
    }, []);

    const startSelecting = useCallback(() => {
        setIsSelecting(true);
    }, []);

    const stopSelecting = useCallback(() => {
        setIsSelecting(false);
        setSelectedTurns(new Set());
        lastClickAnchorRef.current = null;
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedTurns(new Set());
        lastClickAnchorRef.current = null;
    }, []);

    const selectAll = useCallback((maxIndex: number) => {
        const all = new Set<number>();
        for (let i = 0; i <= maxIndex; i++) all.add(i);
        setSelectedTurns(all);
    }, []);

    const handleTurnClick = useCallback((index: number, event: React.MouseEvent) => {
        if (!isSelecting) return;

        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        if (isShift && lastClickAnchorRef.current != null) {
            // Range select from anchor to current
            const anchor = lastClickAnchorRef.current;
            const lo = Math.min(anchor, index);
            const hi = Math.max(anchor, index);
            setSelectedTurns(prev => {
                const next = new Set(prev);
                for (let i = lo; i <= hi; i++) next.add(i);
                return next;
            });
        } else if (isCtrl) {
            // Toggle single
            setSelectedTurns(prev => {
                const next = new Set(prev);
                if (next.has(index)) {
                    next.delete(index);
                } else {
                    next.add(index);
                }
                return next;
            });
            lastClickAnchorRef.current = index;
        } else {
            // Plain click in selection mode: toggle single, set anchor
            setSelectedTurns(prev => {
                const next = new Set(prev);
                if (next.has(index)) {
                    next.delete(index);
                } else {
                    next.add(index);
                }
                return next;
            });
            lastClickAnchorRef.current = index;
        }
    }, [isSelecting]);

    return {
        selectedTurns,
        isSelecting,
        toggleSelecting,
        startSelecting,
        stopSelecting,
        handleTurnClick,
        clearSelection,
        selectAll,
    };
}
