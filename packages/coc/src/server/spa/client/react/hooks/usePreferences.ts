/**
 * usePreferences — fetches and persists the user's per-mode AI models, depth, effort, and per-mode skills.
 * When repoId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When repoId is empty/undefined, returns empty defaults immediately (loaded = true).
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export type SkillMode = 'task' | 'ask' | 'plan';

export interface LastSkillsByMode {
    task: string[];
    ask: string[];
    plan: string[];
}

export interface LastModelsByMode {
    task: string;
    ask: string;
    plan: string;
}

export interface UsePreferencesResult {
    /** @deprecated Use models instead. Single model kept for backward compat. */
    model: string;
    /** Per-mode last-used AI models. */
    models: LastModelsByMode;
    setModel: (mode: SkillMode, m: string) => void;
    depth: string;
    setDepth: (d: string) => void;
    effort: string;
    setEffort: (e: string) => void;
    skills: LastSkillsByMode;
    setSkill: (mode: SkillMode, s: string[]) => void;
    loaded: boolean;
}

const EMPTY_SKILLS: LastSkillsByMode = { task: [], ask: [], plan: [] };
const EMPTY_MODELS: LastModelsByMode = { task: '', ask: '', plan: '' };

export function usePreferences(repoId?: string): UsePreferencesResult {
    const [models, setModelsState] = useState<LastModelsByMode>({ ...EMPTY_MODELS });
    const [depth, setDepthState] = useState('');
    const [effort, setEffortState] = useState('');
    const [skills, setSkillsState] = useState<LastSkillsByMode>({ ...EMPTY_SKILLS });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setModelsState({ ...EMPTY_MODELS });
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
                    // Read per-mode models, falling back to legacy lastModel
                    if (typeof prefs.lastModels === 'object' && prefs.lastModels !== null) {
                        setModelsState({
                            task: typeof prefs.lastModels.task === 'string' ? prefs.lastModels.task : '',
                            ask: typeof prefs.lastModels.ask === 'string' ? prefs.lastModels.ask : '',
                            plan: typeof prefs.lastModels.plan === 'string' ? prefs.lastModels.plan : '',
                        });
                    } else if (typeof prefs.lastModel === 'string') {
                        // Backward compat: populate all modes from legacy single model
                        setModelsState({
                            task: prefs.lastModel,
                            ask: prefs.lastModel,
                            plan: prefs.lastModel,
                        });
                    }
                    if (typeof prefs.lastDepth === 'string') {
                        setDepthState(prefs.lastDepth);
                    }
                    if (typeof prefs.lastEffort === 'string') {
                        setEffortState(prefs.lastEffort);
                    }
                    if (typeof prefs.lastSkills === 'object' && prefs.lastSkills !== null) {
                        const normalizeArr = (val: unknown): string[] => {
                            if (Array.isArray(val)) return val.filter((s): s is string => typeof s === 'string');
                            if (typeof val === 'string' && val) return [val];
                            return [];
                        };
                        setSkillsState({
                            task: normalizeArr(prefs.lastSkills.task),
                            ask: normalizeArr(prefs.lastSkills.ask),
                            plan: normalizeArr(prefs.lastSkills.plan),
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

    const setModel = useCallback((mode: SkillMode, m: string) => {
        setModelsState(prev => ({ ...prev, [mode]: m }));
        if (!repoId) return;
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastModels: { [mode]: m } }),
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

    const setSkill = useCallback((mode: SkillMode, s: string[]) => {
        setSkillsState(prev => ({ ...prev, [mode]: s }));
        if (!repoId) return;
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(repoId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSkills: { [mode]: s } }),
        }).catch(() => {});
    }, [repoId]);

    // Backward compat: expose task model as the single 'model' property
    const model = models.task;

    return { model, models, setModel, depth, setDepth, effort, setEffort, skills, setSkill, loaded };
}
