import { useEffect, useRef, useState } from 'react';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { ReviewContentSearchController, type ReviewSearchFile } from './reviewContentSearchController';

/** Revoke cached and in-flight results when the review or its file inventory changes. */
export function useReviewContentSearchController(
    identity: string,
    files: readonly ReviewSearchFile[],
    load: ((file: ReviewSearchFile) => Promise<GitFileDiffContentResponse>) | undefined,
    refresh?: string | number,
): ReviewContentSearchController | null {
    const latest = useRef({ files, load });
    latest.current = { files, load };
    const fileIdentity = JSON.stringify(files);
    const supported = !!load;
    const [controller, setController] = useState<ReviewContentSearchController | null>(null);
    useEffect(() => {
        if (!supported) { setController(null); return; }
        const next = new ReviewContentSearchController(latest.current.files, file => {
            const loader = latest.current.load;
            if (!loader) throw new Error('Review content loader is unavailable');
            return loader(file);
        });
        setController(next);
        return () => next.dispose();
    }, [identity, fileIdentity, supported, refresh]);
    return controller;
}
