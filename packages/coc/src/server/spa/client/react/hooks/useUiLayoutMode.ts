/**
 * useUiLayoutMode — persisted UI layout mode hook.
 *
 * 'classic'      → unified Activity tab (all processes in one view)
 * 'dev-workflow'  → split Chats + Work Items + Tasks tabs
 */

import { useState, useCallback } from 'react';
import type { UiLayoutMode } from '../types/dashboard';

const STORAGE_KEY = 'coc-ui-layout-mode';

function readMode(): UiLayoutMode {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'classic' || v === 'dev-workflow') return v;
    } catch { /* ignore */ }
    return 'classic';
}

export function useUiLayoutMode(): [UiLayoutMode, (mode: UiLayoutMode) => void] {
    const [mode, setModeState] = useState<UiLayoutMode>(readMode);
    const setMode = useCallback((next: UiLayoutMode) => {
        setModeState(next);
        try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    }, []);
    return [mode, setMode];
}
