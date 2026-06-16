/**
 * useRecentSkills — reads and persists recently-used skills from preferences.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

export interface RecentSkillEntry {
    type: 'prompt' | 'skill';
    name: string;
    description?: string;
    timestamp: number;
    /** Full prompt text at submission time. */
    prompt?: string;
    /** Selected skill names at submission time. */
    skills?: string[];
    /** Model id; omitted if default. */
    model?: string;
    /** Dialog mode at submission time. */
    mode?: 'ask' | 'task';
}

export interface UseRecentSkillsResult {
    recentItems: RecentSkillEntry[];
    trackUsage: (name: string, opts?: { description?: string; prompt?: string; skills?: string[]; model?: string; mode?: 'ask' | 'task' }) => void;
    loaded: boolean;
}

const MAX_RECENT = 5;

export function useRecentSkills(wsId?: string): UseRecentSkillsResult {
    const [recentItems, setRecentItems] = useState<RecentSkillEntry[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const client = getCocClientForWorkspace(wsId);
                const prefs = wsId
                    ? await client.preferences.getRepo(wsId)
                    : await client.preferences.getGlobal();
                // Read from legacy key for backwards compatibility
                if (!cancelled && Array.isArray(prefs.recentFollowPrompts)) {
                    const items: RecentSkillEntry[] = (prefs.recentFollowPrompts as any[])
                        .filter((e: any) => e.name)
                        .map((e: any) => ({
                            type: e.type || 'skill' as const,
                            name: e.name,
                            description: e.description,
                            timestamp: e.timestamp,
                            prompt: e.prompt,
                            skills: Array.isArray(e.skills) ? e.skills : undefined,
                            model: e.model,
                            mode: e.mode,
                        }));
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

    const trackUsage = useCallback((name: string, opts?: { description?: string; prompt?: string; skills?: string[]; model?: string; mode?: 'ask' | 'task' }) => {
        setRecentItems(prev => {
            const entry: RecentSkillEntry = { type: 'prompt', name, timestamp: Date.now(), ...opts };

            const filtered = prev.filter(e => e.name !== name);
            const updated = [entry, ...filtered].slice(0, MAX_RECENT);

            // Fire-and-forget persistence (uses legacy key for backwards compat)
            const client = getCocClientForWorkspace(wsId);
            const patchData = { recentFollowPrompts: updated } as any;
            (wsId
                ? client.preferences.patchRepo(wsId, patchData)
                : client.preferences.patchGlobal(patchData)
            ).catch(() => {});

            return updated;
        });
    }, [wsId]);

    return { recentItems, trackUsage, loaded };
}
