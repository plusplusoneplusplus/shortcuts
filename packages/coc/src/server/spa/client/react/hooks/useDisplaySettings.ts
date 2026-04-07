/**
 * useDisplaySettings — fetches display-related settings from the admin config API.
 * Caches the result in a module-level variable so all components share one fetch.
 */

import { useState, useEffect } from 'react';
import { getApiBase } from '../utils/config';

interface DisplaySettings {
    showReportIntent: boolean;
    toolCompactness: 0 | 1 | 2 | 3;
    taskCardDensity: 'compact' | 'dense';
    groupSingleLineMessages: boolean;
    terminalEnabled: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false, toolCompactness: 3, taskCardDensity: 'dense', groupSingleLineMessages: true, terminalEnabled: false };

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
            groupSingleLineMessages: data?.resolved?.groupSingleLineMessages ?? true,
            terminalEnabled: data?.resolved?.terminal?.enabled ?? false,
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
    const [settings, setSettings] = useState<DisplaySettings>(cachedSettings ?? DEFAULT_SETTINGS);

    useEffect(() => {
        let cancelled = false;
        getOrFetch().then(s => { if (!cancelled) setSettings(s); });
        return () => { cancelled = true; };
    }, []);

    return settings;
}
