import { useEffect, useRef, type RefObject } from 'react';
import type { UnifiedDiffViewerHandle } from './UnifiedDiffViewer';

/** Monaco owns its initial reveal; Classic waits for the mounted hunk viewer. */
export function useInitialDiffHunk(
    viewerRef: RefObject<UnifiedDiffViewerHandle | null>, identity: string,
    target: 'first' | 'last' | undefined, ready: boolean,
) {
    const revealed = useRef(false);
    useEffect(() => { revealed.current = false; }, [identity]);
    useEffect(() => {
        if (!ready || !target || revealed.current) return;
        const timer = setTimeout(() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            const count = viewer.getHunkCount();
            if (!count) return;
            viewer.scrollToHunk(target === 'first' ? 0 : count - 1);
            revealed.current = true;
        }, 50);
        return () => clearTimeout(timer);
    }, [viewerRef, identity, target, ready]);
}
