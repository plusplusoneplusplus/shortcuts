import { useState, useCallback, useRef, useEffect } from 'react';

export type ScratchpadExpandMode = 'split' | 'top' | 'bottom';
export type ScratchpadLayout = 'horizontal' | 'vertical';

export interface ScratchpadState {
    isOpen: boolean;
    topHeightPct: number;
    expandMode: ScratchpadExpandMode;
    linkedNotePath: string | null;
    isDragging: boolean;
    /** Ordered list of all .md file paths registered for display in scratchpad tabs. */
    knownFiles: string[];
    /** Active layout direction for the scratchpad split. */
    layout: ScratchpadLayout;
}

export interface UseScratchpadStateReturn extends ScratchpadState {
    open: (notePath?: string) => void;
    close: () => void;
    setLinkedNotePath: (path: string | null) => void;
    setTopHeightPct: (pct: number) => void;
    setExpandMode: (mode: ScratchpadExpandMode) => void;
    handleDividerMouseDown: (e: React.MouseEvent) => void;
    /**
     * Adds any paths not already in knownFiles (case-insensitive dedup).
     * Preserves insertion order. Does not change the active linkedNotePath.
     */
    registerFiles: (paths: string[]) => void;
}

const STORAGE_KEY_HORIZONTAL = 'coc.scratchpad.topHeightPct';
const STORAGE_KEY_VERTICAL = 'coc.scratchpad.leftWidthPct';
const STORAGE_KEY_OPEN = (taskId: string) => `coc.scratchpad.open.${taskId}`;
const DEFAULT_PCT = 60;
const MIN_PCT_HORIZONTAL = 15;
const MIN_PCT_VERTICAL = 5;
const MAX_PCT = 85;

const PCT_EXPAND_TOP = MAX_PCT;   // 85 — conversation maximized
const PCT_SPLIT = 50;

function getMinPct(layout: ScratchpadLayout): number {
    return layout === 'vertical' ? MIN_PCT_VERTICAL : MIN_PCT_HORIZONTAL;
}

function getStorageKey(layout: ScratchpadLayout): string {
    return layout === 'vertical' ? STORAGE_KEY_VERTICAL : STORAGE_KEY_HORIZONTAL;
}

export function useScratchpadState(
    containerRef: React.RefObject<HTMLElement>,
    layout: ScratchpadLayout = 'horizontal',
    taskId: string | null = null,
): UseScratchpadStateReturn {
    const [isOpen, setIsOpen] = useState(() => {
        if (!taskId) return false;
        try { return localStorage.getItem(STORAGE_KEY_OPEN(taskId)) === 'true'; } catch { return false; }
    });
    const [linkedNotePath, setLinkedNotePath] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [expandMode, setExpandModeRaw] = useState<ScratchpadExpandMode>('split');
    const [knownFiles, setKnownFiles] = useState<string[]>([]);

    const [topHeightPct, setTopHeightPctRaw] = useState<number>(() => {
        try {
            const stored = localStorage.getItem(getStorageKey(layout));
            if (stored !== null) {
                const parsed = Number(stored);
                if (Number.isFinite(parsed)) {
                    return Math.min(Math.max(parsed, getMinPct(layout)), MAX_PCT);
                }
            }
        } catch { /* ignore */ }
        return DEFAULT_PCT;
    });

    // Re-read persisted pct when layout changes
    useEffect(() => {
        try {
            const stored = localStorage.getItem(getStorageKey(layout));
            if (stored !== null) {
                const parsed = Number(stored);
                if (Number.isFinite(parsed)) {
                    setTopHeightPctRaw(Math.min(Math.max(parsed, getMinPct(layout)), MAX_PCT));
                    return;
                }
            }
        } catch { /* ignore */ }
        setTopHeightPctRaw(DEFAULT_PCT);
    }, [layout]);

    // Reset open state from localStorage when taskId changes
    useEffect(() => {
        if (!taskId) { setIsOpen(false); return; }
        try {
            setIsOpen(localStorage.getItem(STORAGE_KEY_OPEN(taskId)) === 'true');
        } catch { setIsOpen(false); }
    }, [taskId]);

    const setTopHeightPct = useCallback((pct: number) => {
        setTopHeightPctRaw(Math.min(Math.max(pct, getMinPct(layout)), MAX_PCT));
    }, [layout]);

    const setExpandMode = useCallback((mode: ScratchpadExpandMode) => {
        setExpandModeRaw(mode);
        switch (mode) {
            case 'top':    setTopHeightPct(PCT_EXPAND_TOP);         break;
            case 'bottom': setTopHeightPct(getMinPct(layout));      break;
            case 'split':  setTopHeightPct(PCT_SPLIT);              break;
        }
    }, [layout, setTopHeightPct]);

    const open = useCallback((notePath?: string) => {
        setIsOpen(prev => {
            if (!prev) setExpandModeRaw('split');
            return true;
        });
        if (taskId) {
            try { localStorage.setItem(STORAGE_KEY_OPEN(taskId), 'true'); } catch { /* ignore */ }
        }
        if (notePath !== undefined) {
            setLinkedNotePath(notePath);
            setKnownFiles(prev => {
                const lc = notePath.toLowerCase();
                if (prev.some(p => p.toLowerCase() === lc)) return prev;
                return [...prev, notePath];
            });
        }
    }, [taskId]);

    const close = useCallback(() => {
        setIsOpen(false);
        if (taskId) {
            try { localStorage.removeItem(STORAGE_KEY_OPEN(taskId)); } catch { /* ignore */ }
        }
    }, [taskId]);

    const registerFiles = useCallback((paths: string[]) => {
        setKnownFiles(prev => {
            const existing = new Set(prev.map(p => p.toLowerCase()));
            const toAdd = paths.filter(p => !existing.has(p.toLowerCase()));
            if (toAdd.length === 0) return prev;
            return [...prev, ...toAdd];
        });
    }, []);

    // Drag mechanism — layout-aware
    const startPosRef = useRef(0);
    const startPctRef = useRef(0);
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startPosRef.current = layout === 'vertical' ? e.clientX : e.clientY;
        startPctRef.current = topHeightPct;
        setIsDragging(true);
    }, [topHeightPct, layout]);

    useEffect(() => {
        if (!isDragging) return;
        const onMouseMove = (e: MouseEvent) => {
            e.preventDefault();
            const isVertical = layoutRef.current === 'vertical';
            const containerSize = isVertical
                ? (containerRef.current?.clientWidth ?? 0)
                : (containerRef.current?.clientHeight ?? 0);
            if (containerSize <= 0) return;
            const delta = isVertical
                ? (e.clientX - startPosRef.current)
                : (e.clientY - startPosRef.current);
            const deltaPct = (delta / containerSize) * 100;
            setTopHeightPct(startPctRef.current + deltaPct);
        };
        const onMouseUp = () => {
            setExpandModeRaw('split');
            setIsDragging(false);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [isDragging, containerRef, setTopHeightPct]);

    // Persist to localStorage when drag ends
    useEffect(() => {
        if (!isDragging) {
            try { localStorage.setItem(getStorageKey(layout), String(topHeightPct)); } catch { /* ignore */ }
        }
    }, [isDragging, topHeightPct, layout]);

    return {
        isOpen,
        topHeightPct,
        expandMode,
        linkedNotePath,
        isDragging,
        knownFiles,
        layout,
        open,
        close,
        setLinkedNotePath,
        setTopHeightPct,
        setExpandMode,
        handleDividerMouseDown,
        registerFiles,
    };
}
