/**
 * useSourceCanvasState — open/close state for the docked source-file canvas.
 *
 * Holds the single active file reference (a new `open()` *replaces* the
 * previous one — single document, no tabs/history). `onOpen` fires
 * synchronously whenever the canvas opens so the host can close the other
 * mutually-exclusive right-side panels (scratchpad / agent canvas), keeping
 * exactly one right panel visible at a time.
 */
import { useCallback, useRef, useState } from 'react';
import type { SourceCanvasFileRef } from './types';

export interface UseSourceCanvasStateOptions {
    /**
     * Invoked synchronously each time the canvas opens. Wire this to close the
     * sibling right-side panels so only one right panel shows at a time.
     */
    onOpen?: () => void;
}

export interface UseSourceCanvasStateReturn {
    /** Whether the canvas currently has a file to show. */
    isOpen: boolean;
    /** The active file reference, or `null` when closed. */
    fileRef: SourceCanvasFileRef | null;
    /** Open (or replace the content of) the canvas with a new file reference. */
    open: (ref: SourceCanvasFileRef) => void;
    /** Close the canvas and clear its content. */
    close: () => void;
}

export function useSourceCanvasState(
    options: UseSourceCanvasStateOptions = {},
): UseSourceCanvasStateReturn {
    const [fileRef, setFileRef] = useState<SourceCanvasFileRef | null>(null);
    // Ref so a changing `onOpen` identity never re-creates the stable `open`.
    const onOpenRef = useRef(options.onOpen);
    onOpenRef.current = options.onOpen;

    const open = useCallback((ref: SourceCanvasFileRef) => {
        setFileRef(ref);
        onOpenRef.current?.();
    }, []);

    const close = useCallback(() => setFileRef(null), []);

    return { isOpen: fileRef !== null, fileRef, open, close };
}
