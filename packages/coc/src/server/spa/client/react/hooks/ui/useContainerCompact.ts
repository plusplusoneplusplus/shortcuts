import { useRef } from 'react';
import { useContainerWidth } from '../../features/chat/hooks/useContainerWidth';
/** A dock follows its own width, independently of the viewport breakpoint. */
export function useContainerCompact(mobile: boolean, minSplitWidth = 760) {
    const ref = useRef<HTMLDivElement>(null);
    const { width } = useContainerWidth(ref, { throttleMs: 0 });
    return { ref, compact: mobile || (width > 0 && width < minSplitWidth) };
}
