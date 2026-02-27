/**
 * useRecentPrompts — reads and persists recently-used prompts/skills from preferences.
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

export function useRecentPrompts(): UseRecentPromptsResult {
    const [recentItems, setRecentItems] = useState<RecentFollowPromptEntry[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getApiBase() + '/preferences');
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
    }, []);

    const trackUsage = useCallback((type: 'prompt' | 'skill', name: string, path?: string, description?: string) => {
        setRecentItems(prev => {
            const entry: RecentFollowPromptEntry = { type, name, timestamp: Date.now() };
            if (path) entry.path = path;
            if (description) entry.description = description;

            const filtered = prev.filter(e => !(e.type === type && e.name === name));
            const updated = [entry, ...filtered].slice(0, MAX_RECENT);

            // Fire-and-forget persistence
            fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recentFollowPrompts: updated }),
            }).catch(() => {});

            return updated;
        });
    }, []);

    return { recentItems, trackUsage, loaded };
}
