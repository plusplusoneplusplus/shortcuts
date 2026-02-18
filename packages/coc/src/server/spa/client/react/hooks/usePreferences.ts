/**
 * usePreferences — fetches and persists the user's last-selected AI model.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface UsePreferencesResult {
    model: string;
    setModel: (m: string) => void;
    loaded: boolean;
}

export function usePreferences(): UsePreferencesResult {
    const [model, setModelState] = useState('');
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getApiBase() + '/preferences');
                if (!res.ok) return;
                const prefs = await res.json();
                if (!cancelled && typeof prefs.lastModel === 'string') {
                    setModelState(prefs.lastModel);
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const setModel = useCallback((m: string) => {
        setModelState(m);
        // Fire-and-forget persistence
        fetch(getApiBase() + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastModel: m }),
        }).catch(() => {});
    }, []);

    return { model, setModel, loaded };
}
