/**
 * useRecentPrompts — reads and persists recently-used prompts/skills from preferences.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface RecentFollowPromptEntry {
    type: 'prompt' | 'skill';
    name: string;
    path?: string;
    description?: string;
    timestamp: number;
}

export interface UseRecentPromptsResult {
    recentItems: RecentFollowPromptEntry[];
    trackUsage: (type: 'prompt' | 'skill', name: string, path?: string, description?: string) => void;
    loaded: boolean;
}

const MAX_RECENT = 10;

export function useRecentPrompts(wsId?: string): UseRecentPromptsResult {
    const [recentItems, setRecentItems] = useState<RecentFollowPromptEntry[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const url = wsId
            ? getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/preferences'
            : getApiBase() + '/preferences';
        (async () => {
            try {
                const res = await fetch(url);
                if (!res.ok) return;
                const prefs = await res.json();
                if (!cancelled && Array.isArray(prefs.recentFollowPrompts)) {
                    setRecentItems(prefs.recentFollowPrompts);
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [wsId]);

    const trackUsage = useCallback((type: 'prompt' | 'skill', name: string, path?: string, description?: string) => {
        setRecentItems(prev => {
            const entry: RecentFollowPromptEntry = { type, name, timestamp: Date.now() };
            if (path) entry.path = path;
            if (description) entry.description = description;

            const filtered = prev.filter(e => !(e.type === type && e.name === name));
            const updated = [entry, ...filtered].slice(0, MAX_RECENT);

            // Fire-and-forget persistence
            const url = wsId
                ? getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/preferences'
                : getApiBase() + '/preferences';
            fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recentFollowPrompts: updated }),
            }).catch(() => {});

            return updated;
        });
    }, [wsId]);

    return { recentItems, trackUsage, loaded };
}
