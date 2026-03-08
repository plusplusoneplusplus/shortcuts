/**
 * usePreferences — fetches and persists the user's last-selected AI model, depth, effort, and per-mode skills.
 * When repoId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When repoId is empty/undefined, returns empty defaults immediately (loaded = true).
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export type SkillMode = 'task' | 'ask' | 'plan';

export interface LastSkillsByMode {
    task: string;
    ask: string;
    plan: string;
}

export interface UsePreferencesResult {
    model: string;
    setModel: (m: string) => void;
    depth: string;
    setDepth: (d: string) => void;
    effort: string;
    setEffort: (e: string) => void;
    skills: LastSkillsByMode;
    setSkill: (mode: SkillMode, s: string) => void;
    loaded: boolean;
}

const EMPTY_SKILLS: LastSkillsByMode = { task: '', ask: '', plan: '' };

export function usePreferences(repoId?: string): UsePreferencesResult {
    const [model, setModelState] = useState('');
    const [depth, setDepthState] = useState('');
    const [effort, setEffortState] = useState('');
    const [skills, setSkillsState] = useState<LastSkillsByMode>({ ...EMPTY_SKILLS });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setModelState('');
        setDepthState('');
        setEffortState('');
        setSkillsState({ ...EMPTY_SKILLS });
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
                    if (typeof prefs.lastSkills === 'object' && prefs.lastSkills !== null) {
                        setSkillsState({
                            task: typeof prefs.lastSkills.task === 'string' ? prefs.lastSkills.task : '',
                            ask: typeof prefs.lastSkills.ask === 'string' ? prefs.lastSkills.ask : '',
                            plan: typeof prefs.lastSkills.plan === 'string' ? prefs.lastSkills.plan : '',
                        });
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
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastModel: m }),
        }).catch(() => {});
    }, [repoId]);

    const setDepth = useCallback((d: string) => {
        setDepthState(d);
        if (!repoId) return;
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastDepth: d }),
        }).catch(() => {});
    }, [repoId]);

    const setEffort = useCallback((e: string) => {
        setEffortState(e);
        if (!repoId) return;
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastEffort: e }),
        }).catch(() => {});
    }, [repoId]);

    const setSkill = useCallback((mode: SkillMode, s: string) => {
        setSkillsState(prev => ({ ...prev, [mode]: s }));
        if (!repoId) return;
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSkills: { [mode]: s } }),
        }).catch(() => {});
    }, [repoId]);

    return { model, setModel, depth, setDepth, effort, setEffort, skills, setSkill, loaded };
}
