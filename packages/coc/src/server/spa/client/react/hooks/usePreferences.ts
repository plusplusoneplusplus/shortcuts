/**
 * usePreferences — fetches and persists the user's last-selected AI model, depth, and effort.
 * When repoId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When repoId is empty/undefined, returns empty defaults immediately (loaded = true).
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
    skill: string;
    setSkill: (s: string) => void;
    queueTaskSkill: string;
    setQueueTaskSkill: (s: string) => void;
    loaded: boolean;
}

export function usePreferences(repoId?: string): UsePreferencesResult {
    const [model, setModelState] = useState('');
    const [depth, setDepthState] = useState('');
    const [effort, setEffortState] = useState('');
    const [skill, setSkillState] = useState('');
    const [queueTaskSkill, setQueueTaskSkillState] = useState('');
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setModelState('');
        setDepthState('');
        setEffortState('');
        setSkillState('');
        setQueueTaskSkillState('');
        if (!repoId) {
            setLoaded(true);
            return;
        }
        setLoaded(false);
        let cancelled = false;
        const url = getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences';
        (async () => {
            try {
                const res = await fetch(url);
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
                    if (typeof prefs.lastSkill === 'string') {
                        setSkillState(prefs.lastSkill);
                    }
                    if (typeof prefs.lastQueueTaskSkill === 'string') {
                        setQueueTaskSkillState(prefs.lastQueueTaskSkill);
                    }
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [repoId]);

    const setModel = useCallback((m: string) => {
        setModelState(m);
        if (!repoId) return;
        // Fire-and-forget persistence
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastModel: m }),
        }).catch(() => {});
    }, [repoId]);

    const setDepth = useCallback((d: string) => {
        setDepthState(d);
        if (!repoId) return;
        // Fire-and-forget persistence
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastDepth: d }),
        }).catch(() => {});
    }, [repoId]);

    const setEffort = useCallback((e: string) => {
        setEffortState(e);
        if (!repoId) return;
        // Fire-and-forget persistence
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastEffort: e }),
        }).catch(() => {});
    }, [repoId]);

    const setSkill = useCallback((s: string) => {
        setSkillState(s);
        if (!repoId) return;
        // Fire-and-forget persistence
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSkill: s }),
        }).catch(() => {});
    }, [repoId]);

    const setQueueTaskSkill = useCallback((s: string) => {
        setQueueTaskSkillState(s);
        if (!repoId) return;
        // Fire-and-forget persistence
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastQueueTaskSkill: s }),
        }).catch(() => {});
    }, [repoId]);

    return { model, setModel, depth, setDepth, effort, setEffort, skill, setSkill, queueTaskSkill, setQueueTaskSkill, loaded };
}
