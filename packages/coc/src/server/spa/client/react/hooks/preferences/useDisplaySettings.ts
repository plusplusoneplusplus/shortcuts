/**
 * useDisplaySettings — fetches display-related settings from the admin config API.
 * Caches the result in a module-level variable so all components share one fetch.
 */

import { useState, useEffect } from 'react';
import {
    getScratchpadLayout,
    isDreamsEnabled,
    isMyLifeEnabled,
    isMyWorkEnabled,
    isNotesEnabled,
    isPullRequestsEnabled,
    isScratchpadEnabled,
    isTerminalEnabled,
    isVimNavigationEnabled,
    isWorkflowsEnabled,
} from '../../utils/config';
import { getSpaCocClient } from '../../api/cocClient';

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
    dreamsEnabled: boolean;
    vimNavigationEnabled: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = {
    showReportIntent: false,
    toolCompactness: 3,
    taskCardDensity: 'dense',
    historyGrouping: true,
    groupSingleLineMessages: true,
    terminalEnabled: true,
    notesEnabled: true,
    myWorkEnabled: false,
    myLifeEnabled: false,
    scratchpadEnabled: false,
    scratchpadLayout: 'vertical',
    workflowsEnabled: false,
    pullRequestsEnabled: false,
    dreamsEnabled: false,
    vimNavigationEnabled: false,
};

/** Build initial settings seeded from window.__DASHBOARD_CONFIG__ when available. */
function getInitialSettings(): DisplaySettings {
    return {
        ...DEFAULT_SETTINGS,
        terminalEnabled: isTerminalEnabled(),
        notesEnabled: isNotesEnabled(),
        myWorkEnabled: isMyWorkEnabled(),
        myLifeEnabled: isMyLifeEnabled(),
        scratchpadEnabled: isScratchpadEnabled(),
        scratchpadLayout: getScratchpadLayout(),
        workflowsEnabled: isWorkflowsEnabled(),
        pullRequestsEnabled: isPullRequestsEnabled(),
        dreamsEnabled: isDreamsEnabled(),
        vimNavigationEnabled: isVimNavigationEnabled(),
    };
}

let cachedSettings: DisplaySettings | null = null;
let fetchPromise: Promise<DisplaySettings> | null = null;

async function fetchDisplaySettings(): Promise<DisplaySettings> {
    try {
        const data = await getSpaCocClient().admin.getConfig();
        const resolved = (data as any)?.resolved;
        return {
            showReportIntent: resolved?.showReportIntent ?? false,
            toolCompactness: (resolved?.toolCompactness ?? 3) as 0 | 1 | 2 | 3,
            taskCardDensity: (resolved?.taskCardDensity === 'compact' ? 'compact' : 'dense') as 'compact' | 'dense',
            historyGrouping: resolved?.historyGrouping ?? true,
            groupSingleLineMessages: resolved?.groupSingleLineMessages ?? true,
            terminalEnabled: resolved?.terminal?.enabled ?? true,
            notesEnabled: resolved?.notes?.enabled ?? true,
            myWorkEnabled: resolved?.myWork?.enabled ?? false,
            myLifeEnabled: resolved?.myLife?.enabled ?? false,
            scratchpadEnabled: resolved?.scratchpad?.enabled ?? false,
            scratchpadLayout: (resolved?.scratchpad?.layout === 'horizontal' ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical',
            workflowsEnabled: resolved?.workflows?.enabled ?? false,
            pullRequestsEnabled: resolved?.pullRequests?.enabled ?? false,
            dreamsEnabled: resolved?.dreams?.enabled ?? false,
            vimNavigationEnabled: resolved?.vimNavigation?.enabled ?? false,
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
