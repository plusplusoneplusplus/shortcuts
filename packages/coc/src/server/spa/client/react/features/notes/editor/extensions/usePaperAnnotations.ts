/**
 * usePaperAnnotations — load the per-note paper-annotations sidecar and expose
 * its annotations for re-rendering (Goal 2 read half).
 *
 * Mirrors the notes-comments / side-note load pattern: a GET against the
 * flag-gated `/api/workspaces/:id/notes/paper-annotations` endpoint on mount and
 * whenever the note path changes, plus a `reload()` used after a fresh Q&A is
 * persisted (the write half dispatches {@link PAPER_ANNOTATION_PERSISTED_EVENT}).
 *
 * The hook is intentionally read-only over the wire here; deletion is handled by
 * the render layer, which prunes local state after a successful DELETE.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../../../../hooks/useApi';
import type {
    PaperAnnotation,
    PaperAnnotationsSidecar,
} from '../../../../../../../notes/paper-annotations-types';

/**
 * Fired on `window` after the write half persists an answered annotation, so any
 * mounted read layer for the same note can reload without prop coupling.
 */
export const PAPER_ANNOTATION_PERSISTED_EVENT = 'paper-annotation-persisted';

export interface UsePaperAnnotationsResult {
    annotations: PaperAnnotation[];
    reload: () => void;
    /** Drop one annotation from local state after a successful delete. */
    removeLocal: (id: string) => void;
}

export function usePaperAnnotations(
    workspaceId: string | undefined,
    getNotePath: (() => string | null | undefined) | undefined,
    getNoteRoot: (() => string | undefined) | undefined,
    enabled: boolean,
): UsePaperAnnotationsResult {
    const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);

    const load = useCallback(() => {
        if (!enabled || !workspaceId) {
            setAnnotations([]);
            return;
        }
        const notePath = getNotePath?.();
        if (!notePath) {
            setAnnotations([]);
            return;
        }
        const params = new URLSearchParams({ path: notePath });
        const root = getNoteRoot?.();
        if (root) {params.set('root', root);}
        const path = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/paper-annotations?${params.toString()}`;
        let cancelled = false;
        fetchApi(path)
            .then((data: PaperAnnotationsSidecar) => {
                if (cancelled) {return;}
                const map = data?.annotations && typeof data.annotations === 'object' ? data.annotations : {};
                setAnnotations(Object.values(map));
            })
            .catch(() => {
                if (!cancelled) {setAnnotations([]);}
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, workspaceId, getNotePath, getNoteRoot]);

    // Initial load + reload when identity changes.
    useEffect(() => {
        const cleanup = load();
        return typeof cleanup === 'function' ? cleanup : undefined;
    }, [load]);

    // Reload when the write half persists a new annotation for this note.
    useEffect(() => {
        if (!enabled) {return;}
        const onPersisted = () => load();
        window.addEventListener(PAPER_ANNOTATION_PERSISTED_EVENT, onPersisted);
        return () => window.removeEventListener(PAPER_ANNOTATION_PERSISTED_EVENT, onPersisted);
    }, [enabled, load]);

    const reload = useCallback(() => { load(); }, [load]);
    const removeLocal = useCallback((id: string) => {
        setAnnotations(prev => prev.filter(a => a.id !== id));
    }, []);

    return { annotations, reload, removeLocal };
}
