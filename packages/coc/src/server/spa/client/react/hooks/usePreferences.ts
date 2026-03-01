/**
 * usePreferences — fetches and persists the user's last-selected AI model, depth, and effort.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface UsePreferencesResult {
    model: string;
    setModel: (m: string) => void;
    depth: string;
    setDepth: (d: string) => void;
    effort: string;
    setEffort: (e: string) => void;
    loaded: boolean;
}

export function usePreferences(): UsePreferencesResult {
    const [model, setModelState] = useState('');
    const [depth, setDepthState] = useState('');
    const [effort, setEffortState] = useState('');
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getApiBase() + '/preferences');
                if (!res.ok) return;
                const prefs = await res.json();
                if (!cancelled) {
                    if (typeof prefs.lastModel === 'string') {
                        setModelState(prefs.lastModel);
                    }
                    if (typeof prefs.lastDepth === 'string') {
                        setDepthState(prefs.lastDepth);
                    }
                    if (typeof prefs.lastEffort === 'string') {
                        setEffortState(prefs.lastEffort);
                    }
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

    const setDepth = useCallback((d: string) => {
        setDepthState(d);
        // Fire-and-forget persistence
        fetch(getApiBase() + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastDepth: d }),
        }).catch(() => {});
    }, []);

    const setEffort = useCallback((e: string) => {
        setEffortState(e);
        // Fire-and-forget persistence
        fetch(getApiBase() + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastEffort: e }),
        }).catch(() => {});
    }, []);

    return { model, setModel, depth, setDepth, effort, setEffort, loaded };
}
