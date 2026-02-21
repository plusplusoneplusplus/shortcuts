/**
 * useDisplaySettings — fetches display-related settings from the admin config API.
 * Caches the result in a module-level variable so all components share one fetch.
 */

import { useState, useEffect } from 'react';
import { getApiBase } from '../utils/config';

interface DisplaySettings {
    showReportIntent: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false };

let cachedSettings: DisplaySettings | null = null;
let fetchPromise: Promise<DisplaySettings> | null = null;

async function fetchDisplaySettings(): Promise<DisplaySettings> {
    try {
        const res = await fetch(getApiBase() + '/admin/config');
        if (!res.ok) return DEFAULT_SETTINGS;
        const data = await res.json();
        return {
            showReportIntent: data?.resolved?.showReportIntent ?? false,
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
