/**
 * useDisplaySettings — fetches display-related settings from the admin config API.
 * Caches the result in a module-level variable so all components share one fetch.
 */

import { useState, useEffect } from 'react';
import { getApiBase, isTerminalEnabled, isNotesEnabled, isMyWorkEnabled, isMyLifeEnabled, isScratchpadEnabled, getScratchpadLayout, isWorkflowsEnabled, isPullRequestsEnabled } from '../../utils/config';

interface DisplaySettings {
    showReportIntent: boolean;
    toolCompactness: 0 | 1 | 2 | 3;
    taskCardDensity: 'compact' | 'dense';
    historyGrouping: boolean;
    groupSingleLineMessages: boolean;
    terminalEnabled: boolean;
    notesEnabled: boolean;
    myWorkEnabled: boolean;
    myLifeEnabled: boolean;
    scratchpadEnabled: boolean;
    scratchpadLayout: 'horizontal' | 'vertical';
    workflowsEnabled: boolean;
    pullRequestsEnabled: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = { showReportIntent: false, toolCompactness: 3, taskCardDensity: 'dense', historyGrouping: true, groupSingleLineMessages: true, terminalEnabled: false, notesEnabled: true, myWorkEnabled: false, myLifeEnabled: false, scratchpadEnabled: false, scratchpadLayout: 'vertical', workflowsEnabled: false, pullRequestsEnabled: false };

/** Build initial settings seeded from window.__DASHBOARD_CONFIG__ when available. */
function getInitialSettings(): DisplaySettings {
    return { ...DEFAULT_SETTINGS, terminalEnabled: isTerminalEnabled(), notesEnabled: isNotesEnabled(), myWorkEnabled: isMyWorkEnabled(), myLifeEnabled: isMyLifeEnabled(), scratchpadEnabled: isScratchpadEnabled(), scratchpadLayout: getScratchpadLayout(), workflowsEnabled: isWorkflowsEnabled(), pullRequestsEnabled: isPullRequestsEnabled() };
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
            notesEnabled: data?.resolved?.notes?.enabled ?? true,
            myWorkEnabled: data?.resolved?.myWork?.enabled ?? false,
            myLifeEnabled: data?.resolved?.myLife?.enabled ?? false,
            scratchpadEnabled: data?.resolved?.scratchpad?.enabled ?? false,
            scratchpadLayout: (data?.resolved?.scratchpad?.layout === 'horizontal' ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical',
            workflowsEnabled: data?.resolved?.workflows?.enabled ?? false,
            pullRequestsEnabled: data?.resolved?.pullRequests?.enabled ?? false,
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
