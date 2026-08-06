/**
 * useCanvasRecord — the canvas panel's data kernel.
 *
 * Owns the concurrency-critical rules that used to be inlined in CanvasPanel:
 *  - workspace-routed load on mount / canvas switch,
 *  - forced reload via `reloadNonce` (pop-out on focus), skipped while dirty,
 *  - live `canvas-updated` reconciliation — refresh in place when clean, flag a
 *    pending remote update when the user has unsaved edits,
 *  - debounced revision-checked autosave with 409 conflict detection, keeping
 *    the dirty mark when the user typed while a save was in flight.
 *
 * The routed client is passed in (never resolved here) so remote/clone
 * workspaces keep hitting the workspace-owning server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { Canvas, CocClient } from '@plusplusoneplusplus/coc-client';
import { AUTOSAVE_DELAY_MS, type SaveState } from '../canvas-panel-model';
import type { CanvasUpdatedEvent } from '../../chat/hooks/useChatSSE';

export interface UseCanvasRecordOptions {
    client: CocClient;
    workspaceId: string;
    canvasId: string;
    /** Latest live canvas event from the chat SSE stream (AI edits). */
    liveEvent: CanvasUpdatedEvent | null;
    /** Bumping this forces a reload from the server (used by the pop-out window on focus). */
    reloadNonce?: number;
}

export interface CanvasRecord {
    canvas: Canvas | null;
    /** Always-current canvas, safe to read from timers and async callbacks. */
    canvasRef: React.MutableRefObject<Canvas | null>;
    loading: boolean;
    loadError: string | null;
    draft: string;
    dirty: boolean;
    saveState: SaveState;
    setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
    remoteUpdatePending: boolean;
    /**
     * Bumped after every successful load. The version/comment kernels key their
     * best-effort refetches off it, so a live-update or conflict reload refreshes
     * them exactly as the original single load path did.
     */
    loadNonce: number;
    /** Re-fetch from the server, discarding any local draft. */
    reload: () => Promise<void>;
    /** Record a user edit: updates the draft, marks it dirty, and arms autosave. */
    editDraft: (next: string) => void;
    /** Adopt a canvas saved elsewhere (interactive views, version restore) as the clean state. */
    adoptSaved: (saved: Canvas) => void;
}

export function useCanvasRecord({ client, workspaceId, canvasId, liveEvent, reloadNonce }: UseCanvasRecordOptions): CanvasRecord {
    const [canvas, setCanvas] = useState<Canvas | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [dirty, setDirty] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [remoteUpdatePending, setRemoteUpdatePending] = useState(false);
    const [loadNonce, setLoadNonce] = useState(0);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const canvasRef = useRef<Canvas | null>(null);
    canvasRef.current = canvas;
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;
    const draftRef = useRef('');
    draftRef.current = draft;

    const reload = useCallback(async () => {
        try {
            const loaded = await client.canvases.get(workspaceId, canvasId);
            setCanvas(loaded);
            setDraft(loaded.content);
            setDirty(false);
            setSaveState('idle');
            setRemoteUpdatePending(false);
            setLoadError(null);
            setLoadNonce(n => n + 1);
        } catch {
            setLoadError('Failed to load canvas');
        } finally {
            setLoading(false);
        }
        // `client` is intentionally out of the dep list: it is memoized per
        // workspaceId, and adding it would re-run the load effect on unrelated
        // identity changes.
    }, [workspaceId, canvasId]);

    // Initial load / canvas switch
    useEffect(() => {
        setLoading(true);
        setCanvas(null);
        setLoadError(null);
        void reload();
    }, [reload]);

    // Forced reload (pop-out window on focus). Skips the initial mount.
    const reloadNonceRef = useRef(reloadNonce);
    useEffect(() => {
        if (reloadNonce === undefined || reloadNonce === reloadNonceRef.current) return;
        reloadNonceRef.current = reloadNonce;
        if (!dirtyRef.current) void reload();
    }, [reloadNonce, reload]);

    // Live AI updates: refresh in place, or flag a pending update when the
    // user has unsaved local edits so their draft is not clobbered.
    useEffect(() => {
        if (!liveEvent || liveEvent.canvasId !== canvasId) return;
        const current = canvasRef.current;
        if (current && liveEvent.revision <= current.revision) return;
        if (dirtyRef.current) {
            setRemoteUpdatePending(true);
        } else {
            void reload();
        }
    }, [liveEvent, canvasId, reload]);

    // Debounced revision-checked autosave of user edits
    useEffect(() => {
        if (!dirty) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const current = canvasRef.current;
            if (!current) return;
            const savedDraft = draft;
            setSaveState('saving');
            client.canvases
                .save(workspaceId, canvasId, { content: savedDraft, expectedRevision: current.revision })
                .then(saved => {
                    setCanvas({ ...saved, content: savedDraft });
                    // Keep the dirty mark if the user typed while the save was in flight
                    if (draftRef.current === savedDraft) {
                        setDirty(false);
                        setSaveState('saved');
                    }
                })
                .catch(err => {
                    if (err instanceof CocApiError && err.status === 409) {
                        setSaveState('conflict');
                    } else {
                        setSaveState('error');
                    }
                });
        }, AUTOSAVE_DELAY_MS);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [draft, dirty, workspaceId, canvasId]);

    const editDraft = useCallback((next: string) => {
        setDraft(next);
        setDirty(true);
        setSaveState('idle');
    }, []);

    const adoptSaved = useCallback((saved: Canvas) => {
        setCanvas(saved);
        setDraft(saved.content);
        setDirty(false);
        setSaveState('saved');
    }, []);

    return {
        canvas,
        canvasRef,
        loading,
        loadError,
        draft,
        dirty,
        saveState,
        setSaveState,
        remoteUpdatePending,
        loadNonce,
        reload,
        editDraft,
        adoptSaved,
    };
}
