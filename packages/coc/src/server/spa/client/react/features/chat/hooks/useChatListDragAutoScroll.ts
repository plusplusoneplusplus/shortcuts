/**
 * useChatListDragAutoScroll — scroll the chat list while the pointer sits near
 * its top or bottom edge during a drag (AC-07).
 *
 * Listeners are attached in the CAPTURE phase so they run before any row
 * handler: the queue's reorder rows and the folder drop targets both call
 * `stopPropagation` on `dragover`, and a bubble-phase listener on the scroll
 * container would therefore never fire over exactly the rows the user is
 * dragging across.
 *
 * The timer is the whole risk here. A scroll interval that outlives the
 * component shows up as a Vitest "Unhandled Errors" section even when every
 * test passes, so it is cleared on `dragend` (including an Esc-cancelled drag,
 * which fires `dragend` on the drag *source* — possibly outside this container,
 * hence the document-level listener), on `drop`, and on unmount.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
    CHAT_LIST_AUTO_SCROLL_INTERVAL_MS,
    computeDragAutoScrollDelta,
} from '../chat-folder-drag';

export interface UseChatListDragAutoScrollResult {
    /** Cancel any running scroll immediately. Safe to call when idle. */
    stop: () => void;
}

export function useChatListDragAutoScroll(
    containerRef: React.RefObject<HTMLElement | null>,
    enabled: boolean,
): UseChatListDragAutoScrollResult {
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const deltaRef = useRef(0);

    const stop = useCallback(() => {
        if (timerRef.current !== null) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        deltaRef.current = 0;
    }, []);

    useEffect(() => {
        if (!enabled) {return undefined;}
        const element = containerRef.current;
        if (!element) {return undefined;}

        const handleDragOver = (event: Event) => {
            const clientY = (event as DragEvent).clientY;
            if (typeof clientY !== 'number') {return;}
            const rect = element.getBoundingClientRect();
            const delta = computeDragAutoScrollDelta(clientY, rect);
            deltaRef.current = delta;
            if (delta === 0) {
                stop();
                return;
            }
            if (timerRef.current === null) {
                timerRef.current = setInterval(() => {
                    element.scrollTop += deltaRef.current;
                }, CHAT_LIST_AUTO_SCROLL_INTERVAL_MS);
            }
        };

        element.addEventListener('dragover', handleDragOver, true);
        element.addEventListener('drop', stop, true);
        // No `dragleave` listener: in the capture phase that fires every time
        // the pointer crosses a child boundary, which would cancel the scroll
        // constantly. `dragend` always fires on the source when the gesture
        // ends — including one released outside the window — so it is enough.
        document.addEventListener('dragend', stop, true);
        return () => {
            element.removeEventListener('dragover', handleDragOver, true);
            element.removeEventListener('drop', stop, true);
            document.removeEventListener('dragend', stop, true);
            stop();
        };
    }, [containerRef, enabled, stop]);

    return { stop };
}
