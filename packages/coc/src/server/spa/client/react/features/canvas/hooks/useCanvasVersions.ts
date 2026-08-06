/**
 * useCanvasVersions — per-revision browsing and restore-as-latest.
 *
 * Version history is best-effort: a failed list/fetch leaves the current view
 * untouched rather than surfacing an error. Restore never rewrites history — it
 * writes the old content back as a NEW revision through the normal
 * revision-checked save, so a 409 surfaces the same conflict state as an edit.
 */

import { useCallback, useEffect, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { Canvas, CanvasVersion, CanvasVersionMeta, CocClient } from '@plusplusoneplusplus/coc-client';
import type { SaveState } from '../canvas-panel-model';

export interface UseCanvasVersionsOptions {
    client: CocClient;
    workspaceId: string;
    canvasId: string;
    canvas: Canvas | null;
    canvasRef: React.MutableRefObject<Canvas | null>;
    /** Bumped by useCanvasRecord after each successful load. */
    loadNonce: number;
    /** Adopts the restored canvas as the clean current state. */
    adoptSaved: (saved: Canvas) => void;
    setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
}

export interface CanvasVersions {
    versions: CanvasVersionMeta[];
    /** Non-null while browsing an older revision read-only. */
    viewingVersion: CanvasVersion | null;
    /** Revision currently displayed — the browsed one, else the live canvas. */
    viewingRevision: number;
    olderMeta: CanvasVersionMeta | undefined;
    newerMeta: CanvasVersionMeta | undefined;
    restoring: boolean;
    openVersion: (meta: CanvasVersionMeta) => void;
    backToLatest: () => void;
    restore: () => Promise<void>;
}

export function useCanvasVersions({
    client, workspaceId, canvasId, canvas, canvasRef, loadNonce, adoptSaved, setSaveState,
}: UseCanvasVersionsOptions): CanvasVersions {
    const [versions, setVersions] = useState<CanvasVersionMeta[]>([]);
    const [viewingVersion, setViewingVersion] = useState<CanvasVersion | null>(null);
    const [restoring, setRestoring] = useState(false);

    // Reset on canvas switch, before any fetch for the new canvas lands.
    useEffect(() => {
        setViewingVersion(null);
        setVersions([]);
    }, [workspaceId, canvasId]);

    useEffect(() => {
        if (loadNonce === 0) return;
        client.canvases.listVersions(workspaceId, canvasId)
            .then(setVersions)
            .catch(() => { /* version history is best-effort */ });
    }, [workspaceId, canvasId, loadNonce]);

    const viewingRevision = viewingVersion?.revision ?? canvas?.revision ?? 0;
    const olderMeta = versions.find(v => v.revision < viewingRevision);
    const newerMeta = [...versions].reverse().find(v => v.revision > viewingRevision);

    const openVersion = useCallback((meta: CanvasVersionMeta) => {
        if (canvas && meta.revision >= canvas.revision) {
            setViewingVersion(null);
            return;
        }
        client.canvases.getVersion(workspaceId, canvasId, meta.revision)
            .then(setViewingVersion)
            .catch(() => { /* keep current view on fetch failure */ });
    }, [workspaceId, canvasId, canvas]);

    const backToLatest = useCallback(() => setViewingVersion(null), []);

    const restore = useCallback(async () => {
        const current = canvasRef.current;
        if (!current || !viewingVersion || restoring) return;
        setRestoring(true);
        try {
            const saved = await client.canvases.save(workspaceId, canvasId, {
                content: viewingVersion.content,
                expectedRevision: current.revision,
            });
            adoptSaved(saved);
            setViewingVersion(null);
            client.canvases.listVersions(workspaceId, canvasId)
                .then(setVersions)
                .catch(() => { /* best-effort */ });
        } catch (err) {
            setSaveState(err instanceof CocApiError && err.status === 409 ? 'conflict' : 'error');
        } finally {
            setRestoring(false);
        }
    }, [workspaceId, canvasId, viewingVersion, restoring, adoptSaved, setSaveState]);

    return { versions, viewingVersion, viewingRevision, olderMeta, newerMeta, restoring, openVersion, backToLatest, restore };
}
