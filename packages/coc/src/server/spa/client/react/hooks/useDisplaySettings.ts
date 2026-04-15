/**
 * useDisplaySettings — fetches display-related settings from the admin config API.
 * Caches the result in a module-level variable so all components share one fetch.
 */

import { useState, useEffect } from 'react';
import { getApiBase, isTerminalEnabled, isNotesEnabled, isMyWorkEnabled } from '../utils/config';

interface DisplaySettings {
    showReportIntent: boolean;
    toolCompactness: 0 | 1 | 2 | 3;
    taskCardDensity: 'compact' | 'dense';
    historyGrouping: boolean;
    groupSingleLineMessages: boolean;
    terminalEnabled: boolean;
    notesEnabled: boolean;
    myWorkEnabled: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false, toolCompactness: 3, taskCardDensity: 'dense', historyGrouping: true, groupSingleLineMessages: true, terminalEnabled: false, notesEnabled: false, myWorkEnabled: false };

/** Build initial settings seeded from window.__DASHBOARD_CONFIG__ when available. */
function getInitialSettings(): DisplaySettings {
    return { ...DEFAULT_SETTINGS, terminalEnabled: isTerminalEnabled(), notesEnabled: isNotesEnabled(), myWorkEnabled: isMyWorkEnabled() };
}

let cachedSettings: DisplaySettings | null = null;
let fetchPromise: Promise<DisplaySettings> | null = null;

async function fetchDisplaySettings(): Promise<DisplaySettings> {
    try {
        const res = await fetch(getApiBase() + '/admin/config');
        if (!res.ok) return DEFAULT_SETTINGS;
        const data = await res.json();
        return {
            showReportIntent: data?.resolved?.showReportIntent ?? false,
            toolCompactness: (data?.resolved?.toolCompactness ?? 3) as 0 | 1 | 2 | 3,
            taskCardDensity: (data?.resolved?.taskCardDensity === 'compact' ? 'compact' : 'dense') as 'compact' | 'dense',
            historyGrouping: data?.resolved?.historyGrouping ?? true,
            groupSingleLineMessages: data?.resolved?.groupSingleLineMessages ?? true,
            terminalEnabled: data?.resolved?.terminal?.enabled ?? false,
            notesEnabled: data?.resolved?.notes?.enabled ?? false,
            myWorkEnabled: data?.resolved?.myWork?.enabled ?? false,
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

function getOrFetch(): Promise<DisplaySettings> {
    if (cachedSettings) return Promise.resolve(cachedSettings);
    if (!fetchPromise) {
        fetchPromise = fetchDisplaySettings().then(settings => {
            cachedSettings = settings;
            fetchPromise = null;
            return settings;
        });
    }
    return fetchPromise;
}

/** Invalidate cache so the next hook mount re-fetches. */
export function invalidateDisplaySettings(): void {
    cachedSettings = null;
    fetchPromise = null;
}

export function useDisplaySettings(): DisplaySettings {
    const [settings, setSettings] = useState<DisplaySettings>(cachedSettings ?? getInitialSettings());

    useEffect(() => {
        let cancelled = false;
        getOrFetch().then(s => { if (!cancelled) setSettings(s); });
        return () => { cancelled = true; };
    }, []);

    return settings;
}
