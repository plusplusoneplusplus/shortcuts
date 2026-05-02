/**
 * useArchiveUndo — manages the "undo last archive" state.
 *
 * - Fetches undo availability from GET .../tasks/undo-archive on mount.
 * - Exposes `setUndoAvailable` so archive callers can optimistically activate the button.
 * - `undoLastArchive()` calls POST .../tasks/undo-archive and clears the state on success.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';

export interface ArchiveUndoResult {
    undoAvailable: boolean;
    undoInFlight: boolean;
    setUndoAvailable: (v: boolean) => void;
    undoLastArchive: () => Promise<void>;
}

export function useArchiveUndo(wsId: string, onUndone?: () => void): ArchiveUndoResult {
    const [undoAvailable, setUndoAvailable] = useState(false);
    const [undoInFlight, setUndoInFlight] = useState(false);

    // Check undo availability on mount
    useEffect(() => {
        getSpaCocClient().tasks.getUndoArchiveStatus(wsId)
            .then((data) => { if (data?.available) setUndoAvailable(true); })
            .catch(() => {});
    }, [wsId]);

    const undoLastArchive = useCallback(async () => {
        setUndoInFlight(true);
        try {
            await getSpaCocClient().tasks.undoArchive(wsId);
            setUndoAvailable(false);
            onUndone?.();
        } catch (error) {
            throw new Error(`Undo failed: ${getSpaCocClientErrorMessage(error, 'request failed')}`);
        } finally {
            setUndoInFlight(false);
        }
    }, [wsId, onUndone]);

    return { undoAvailable, undoInFlight, setUndoAvailable, undoLastArchive };
}
