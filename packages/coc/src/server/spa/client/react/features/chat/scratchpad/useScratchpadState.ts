import { useState, useCallback, useRef, useEffect } from 'react';

export type ScratchpadExpandMode = 'split' | 'top' | 'bottom';

export interface ScratchpadState {
    isOpen: boolean;
    topHeightPct: number;
    expandMode: ScratchpadExpandMode;
    linkedNotePath: string | null;
    isDragging: boolean;
    /** Ordered list of all .md file paths registered for display in scratchpad tabs. */
    knownFiles: string[];
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

const STORAGE_KEY = 'coc.scratchpad.topHeightPct';
const DEFAULT_PCT = 60;
const MIN_PCT = 15;
const MAX_PCT = 85;

const PCT_EXPAND_TOP = MAX_PCT;     // 85 — conversation maximized
const PCT_EXPAND_BOTTOM = MIN_PCT;  // 15 — scratchpad maximized
const PCT_SPLIT = 50;

export function useScratchpadState(
    containerRef: React.RefObject<HTMLElement>
): UseScratchpadStateReturn {
    const [isOpen, setIsOpen] = useState(false);
    const [linkedNotePath, setLinkedNotePath] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [expandMode, setExpandModeRaw] = useState<ScratchpadExpandMode>('split');
    const [knownFiles, setKnownFiles] = useState<string[]>([]);

    const [topHeightPct, setTopHeightPctRaw] = useState<number>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) {
                const parsed = Number(stored);
                if (Number.isFinite(parsed)) {
                    return Math.min(Math.max(parsed, MIN_PCT), MAX_PCT);
                }
            }
        } catch { /* ignore */ }
        return DEFAULT_PCT;
    });

    const setTopHeightPct = useCallback((pct: number) => {
        setTopHeightPctRaw(Math.min(Math.max(pct, MIN_PCT), MAX_PCT));
    }, []);

    const setExpandMode = useCallback((mode: ScratchpadExpandMode) => {
        setExpandModeRaw(mode);
        switch (mode) {
            case 'top':    setTopHeightPct(PCT_EXPAND_TOP);    break;
            case 'bottom': setTopHeightPct(PCT_EXPAND_BOTTOM); break;
            case 'split':  setTopHeightPct(PCT_SPLIT);         break;
        }
    }, [setTopHeightPct]);

    const open = useCallback((notePath?: string) => {
        setIsOpen(prev => {
            if (!prev) setExpandModeRaw('split');
            return true;
        });
        if (notePath !== undefined) {
            setLinkedNotePath(notePath);
            setKnownFiles(prev => {
                const lc = notePath.toLowerCase();
                if (prev.some(p => p.toLowerCase() === lc)) return prev;
                return [...prev, notePath];
            });
        }
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
    }, []);

    const registerFiles = useCallback((paths: string[]) => {
        setKnownFiles(prev => {
            const existing = new Set(prev.map(p => p.toLowerCase()));
            const toAdd = paths.filter(p => !existing.has(p.toLowerCase()));
            if (toAdd.length === 0) return prev;
            return [...prev, ...toAdd];
        });
    }, []);

    // Drag mechanism
    const startYRef = useRef(0);
    const startPctRef = useRef(0);

    const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startYRef.current = e.clientY;
        startPctRef.current = topHeightPct;
        setIsDragging(true);
    }, [topHeightPct]);

    useEffect(() => {
        if (!isDragging) return;
        const onMouseMove = (e: MouseEvent) => {
            e.preventDefault();
            const containerH = containerRef.current?.clientHeight ?? 0;
            if (containerH <= 0) return;
            const deltaY = e.clientY - startYRef.current;
            const deltaPct = (deltaY / containerH) * 100;
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
            try { localStorage.setItem(STORAGE_KEY, String(topHeightPct)); } catch { /* ignore */ }
        }
    }, [isDragging, topHeightPct]);

    return {
        isOpen,
        topHeightPct,
        expandMode,
        linkedNotePath,
        isDragging,
        knownFiles,
        open,
        close,
        setLinkedNotePath,
        setTopHeightPct,
        setExpandMode,
        handleDividerMouseDown,
        registerFiles,
    };
}
