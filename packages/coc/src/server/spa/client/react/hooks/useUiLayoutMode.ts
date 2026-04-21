/**
 * useUiLayoutMode — persisted UI layout mode hook.
 *
 * 'classic'      → unified Activity tab (all processes in one view)
 * 'dev-workflow'  → split Chats + Work Items + Tasks tabs
 *
 * Backed by server-side GlobalPreferences (GET/PATCH /api/preferences).
 */

import { useState, useEffect, useCallback } from 'react';
import type { UiLayoutMode } from '../types/dashboard';
import { getApiBase } from '../utils/config';

const DEFAULT_MODE: UiLayoutMode = 'classic';

function persistToServer(mode: UiLayoutMode): void {
    fetch(getApiBase() + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiLayoutMode: mode }),
    }).catch(() => {});
}

export function useUiLayoutMode(): [UiLayoutMode, (mode: UiLayoutMode) => void] {
    const [mode, setModeState] = useState<UiLayoutMode>(DEFAULT_MODE);

    // Fetch server state on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getApiBase() + '/preferences');
                if (!res.ok || cancelled) return;
                const prefs = await res.json();
                if (cancelled) return;
                const serverMode = prefs.uiLayoutMode;
                if (serverMode === 'classic' || serverMode === 'dev-workflow') {
                    setModeState(serverMode);
                }
            } catch {
                // Server unavailable — keep default
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const setMode = useCallback((next: UiLayoutMode) => {
        setModeState(next);
        persistToServer(next);
    }, []);

    return [mode, setMode];
}
