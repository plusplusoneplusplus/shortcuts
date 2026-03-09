/**
 * useRecentSkills — reads and persists recently-used skills from preferences.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface RecentSkillEntry {
    name: string;
    description?: string;
    timestamp: number;
}

export interface UseRecentSkillsResult {
    recentItems: RecentSkillEntry[];
    trackUsage: (name: string, description?: string) => void;
    loaded: boolean;
}

const MAX_RECENT = 10;

export function useRecentSkills(wsId?: string): UseRecentSkillsResult {
    const [recentItems, setRecentItems] = useState<RecentSkillEntry[]>([]);
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
                // Read from legacy key for backwards compatibility
                if (!cancelled && Array.isArray(prefs.recentFollowPrompts)) {
                    const items: RecentSkillEntry[] = prefs.recentFollowPrompts
                        .filter((e: any) => e.name)
                        .map((e: any) => ({ name: e.name, description: e.description, timestamp: e.timestamp }));
                    setRecentItems(items);
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [wsId]);

    const trackUsage = useCallback((name: string, description?: string) => {
        setRecentItems(prev => {
            const entry: RecentSkillEntry = { name, timestamp: Date.now() };
            if (description) entry.description = description;

            const filtered = prev.filter(e => e.name !== name);
            const updated = [entry, ...filtered].slice(0, MAX_RECENT);

            // Fire-and-forget persistence (uses legacy key for backwards compat)
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
