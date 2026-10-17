/**
 * useFilesViewMode — shared hook for flat/tree file-list preference.
 *
 * Reads and writes the `filesViewMode` field in per-repo preferences
 * (`PATCH /api/workspaces/:id/preferences`). All git file-list views
 * (commits, branch changes, working tree) share this single preference.
 */

import { useState, useEffect, useCallback } from 'react';
import type { FilesViewMode } from '../diff/FileTree';
import { useCocClient } from '../../../repos/cloneRouting';
import { getRepoPreferences, updateRepoPreferences } from '../../../api/repoPreferences';

const DEFAULT_MODE: FilesViewMode = 'tree';

export interface UseFilesViewModeResult {
    mode: FilesViewMode;
    setMode: (m: FilesViewMode) => void;
}

export function useFilesViewMode(workspaceId?: string): UseFilesViewModeResult {
    const client = useCocClient(workspaceId);
    const [mode, setModeState] = useState<FilesViewMode>(DEFAULT_MODE);

    useEffect(() => {
        setModeState(DEFAULT_MODE);
        if (!workspaceId) return;
        let cancelled = false;
        (async () => {
            try {
                const prefs = await getRepoPreferences(client, workspaceId);
                if (!cancelled && (prefs.filesViewMode === 'flat' || prefs.filesViewMode === 'tree')) {
                    setModeState(prefs.filesViewMode);
                }
            } catch {
                // Preferences are optional
            }
        })();
        return () => { cancelled = true; };
    }, [workspaceId, client]);

    const setMode = useCallback((m: FilesViewMode) => {
        setModeState(m);
        if (!workspaceId) return;
        updateRepoPreferences(client, workspaceId, { filesViewMode: m }).catch(() => {});
    }, [workspaceId, client]);

    return { mode, setMode };
}
