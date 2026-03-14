import { useState, useEffect } from 'react';

export type DiffViewMode = 'unified' | 'split';

const STORAGE_KEY = 'coc-diff-view-mode';

function readStoredMode(): DiffViewMode {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'unified' || v === 'split') return v;
    } catch {
        // localStorage unavailable (SSR / private browsing quota)
    }
    return 'unified';
}

export function useDiffViewMode(): [DiffViewMode, (mode: DiffViewMode) => void] {
    const [mode, setModeState] = useState<DiffViewMode>(readStoredMode);

    const setMode = (next: DiffViewMode) => {
        try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
        setModeState(next);
    };

    // Sync if another tab changes the preference
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY && (e.newValue === 'unified' || e.newValue === 'split')) {
                setModeState(e.newValue);
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    return [mode, setMode];
}
