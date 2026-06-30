/**
 * useWhisperDiffPanelState — open/close state for the transient read-only
 * whisper diff panel (AC-03).
 *
 * Holds the single active `WhisperDiffOpenContext` (a new `open()` *replaces*
 * the previous one — single document, no tabs/history). `onOpen` fires
 * synchronously whenever the panel opens so the host can close the other
 * mutually-exclusive right-side panels (scratchpad / source canvas / agent
 * canvas), keeping exactly one right panel visible at a time — mirroring
 * `useSourceCanvasState`.
 *
 * This hook owns only the open/close lifecycle; the renderable diff itself is
 * derived from the held context by `useWhisperDiffState`.
 */
import { useCallback, useRef, useState } from 'react';
import type { WhisperDiffOpenContext } from '../conversation/tool-calls/WhisperCollapsedGroup';

export interface UseWhisperDiffPanelStateOptions {
    /**
     * Invoked synchronously each time the panel opens. Wire this to close the
     * sibling right-side panels so only one right panel shows at a time.
     */
    onOpen?: () => void;
}

export interface UseWhisperDiffPanelStateReturn {
    /** Whether the panel currently has a file diff to show. */
    isOpen: boolean;
    /** The active clicked-file context, or `null` when closed. */
    ctx: WhisperDiffOpenContext | null;
    /** Open (or replace the content of) the panel with a new clicked-file context. */
    open: (ctx: WhisperDiffOpenContext) => void;
    /** Close the panel and clear its content. */
    close: () => void;
}

export function useWhisperDiffPanelState(
    options: UseWhisperDiffPanelStateOptions = {},
): UseWhisperDiffPanelStateReturn {
    const [ctx, setCtx] = useState<WhisperDiffOpenContext | null>(null);
    // Ref so a changing `onOpen` identity never re-creates the stable `open`.
    const onOpenRef = useRef(options.onOpen);
    onOpenRef.current = options.onOpen;

    const open = useCallback((next: WhisperDiffOpenContext) => {
        setCtx(next);
        onOpenRef.current?.();
    }, []);

    const close = useCallback(() => setCtx(null), []);

    return { isOpen: ctx !== null, ctx, open, close };
}
