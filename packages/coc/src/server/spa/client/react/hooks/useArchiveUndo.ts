/**
 * useArchiveUndo — manages the "undo last archive" state.
 *
 * - Fetches undo availability from GET .../tasks/undo-archive on mount.
 * - Exposes `setUndoAvailable` so archive callers can optimistically activate the button.
 * - `undoLastArchive()` calls POST .../tasks/undo-archive and clears the state on success.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface ArchiveUndoResult {
    undoAvailable: boolean;
    undoInFlight: boolean;
    setUndoAvailable: (v: boolean) => void;
    undoLastArchive: () => Promise<void>;
}

export function useArchiveUndo(wsId: string, onUndone?: () => void): ArchiveUndoResult {
    const base = `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/tasks/undo-archive`;

    const [undoAvailable, setUndoAvailable] = useState(false);
    const [undoInFlight, setUndoInFlight] = useState(false);

    // Check undo availability on mount
    useEffect(() => {
        fetch(base, { method: 'GET' })
            .then(r => r.ok ? r.json() : null)
            .then((data: any) => { if (data?.available) setUndoAvailable(true); })
            .catch(() => {});
    }, [base]);

    const undoLastArchive = useCallback(async () => {
        setUndoInFlight(true);
        try {
            const res = await fetch(base, { method: 'POST' });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Undo failed (${res.status}): ${text}`);
            }
            setUndoAvailable(false);
            onUndone?.();
        } finally {
            setUndoInFlight(false);
        }
    }, [base, onUndone]);

    return { undoAvailable, undoInFlight, setUndoAvailable, undoLastArchive };
}
