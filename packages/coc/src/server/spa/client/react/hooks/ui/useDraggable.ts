/**
 * useDraggable — hook that tracks mouse drag on a handle element and
 * keeps the resulting position clamped inside the viewport.
 */

import {
    useState,
    useCallback,
    useRef,
    useEffect,
    useLayoutEffect,
    type RefObject,
    type MouseEvent as ReactMouseEvent,
} from 'react';
import { clampToViewport } from '../../tasks/comments/viewportUtils';

interface Position {
    top: number;
    left: number;
}

export interface UseDraggableReturn {
    /** Current (clamped) position of the draggable element. */
    position: Position;
    /**
     * Ref that is `true` while the user is actively dragging.
     * Useful for suppressing click-outside handlers during a drag sequence.
     */
    isDraggingRef: React.MutableRefObject<boolean>;
    /** Attach to the drag handle's `onMouseDown` prop. */
    handleMouseDown: (e: ReactMouseEvent) => void;
}

/**
 * Provides drag-to-move behaviour for a fixed-positioned element.
 *
 * @param initialPosition  Starting top/left (updated when the prop changes).
 * @param containerRef     Ref to the draggable container (used to read its size for clamping).
 */
export function useDraggable(
    initialPosition: Position,
    containerRef: RefObject<HTMLElement | null>,
): UseDraggableReturn {
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);
    const [position, setPosition] = useState<Position>(initialPosition);
    const posRef = useRef<Position>(initialPosition);
    const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posTop: 0, posLeft: 0 });

    // Clamp and sync position whenever initialPosition changes (e.g. a new popup is opened).
    // useLayoutEffect ensures the DOM element dimensions are available for clamping.
    useLayoutEffect(() => {
        let target = initialPosition;
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0) {
            target = clampToViewport(initialPosition, rect.width, rect.height);
        }
        posRef.current = target;
        setPosition(target);
        // Intentionally using primitive deps to avoid stale-closure issues when
        // `initialPosition` is an inline object literal.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialPosition.top, initialPosition.left]);

    // Attach / detach global mouse listeners only while a drag is in progress.
    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const { mouseX, mouseY, posTop, posLeft } = dragStartRef.current;
            const newTop = posTop + (e.clientY - mouseY);
            const newLeft = posLeft + (e.clientX - mouseX);
            const rect = containerRef.current?.getBoundingClientRect();
            const pw = rect?.width ?? 0;
            const ph = rect?.height ?? 0;
            const clamped = clampToViewport({ top: newTop, left: newLeft }, pw, ph);
            posRef.current = clamped;
            setPosition(clamped);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            setIsDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, containerRef]);

    const handleMouseDown = useCallback((e: ReactMouseEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        dragStartRef.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            posTop: posRef.current.top,
            posLeft: posRef.current.left,
        };
        setIsDragging(true);
    }, []);

    return { position, isDraggingRef, handleMouseDown };
}
