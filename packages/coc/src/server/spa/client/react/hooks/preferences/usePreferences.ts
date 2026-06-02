/**
 * usePreferences — fetches and persists the user's per-mode AI models, depth, effort, and per-mode skills.
 * When repoId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When repoId is empty/undefined, returns empty defaults immediately (loaded = true).
 */

import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient } from '../../api/cocClient';

export type SkillMode = 'task' | 'ask';
export type ModelMode = SkillMode | 'note';

export interface LastSkillsByMode {
    task: string[];
    ask: string[];
}

export interface LastModelsByMode {
    task: string;
    ask: string;
    note: string;
}

export interface UsePreferencesResult {
    /** @deprecated Use models instead. Single model kept for backward compat. */
    model: string;
    /** Per-mode last-used AI models. */
    models: LastModelsByMode;
    setModel: (mode: ModelMode, m: string) => void;
    depth: string;
    setDepth: (d: string) => void;
    effort: string;
    setEffort: (e: string) => void;
    skills: LastSkillsByMode;
    setSkill: (mode: SkillMode, s: string[]) => void;
    /** Max iterations a Ralph loop runs before stopping. `undefined` falls back to server default. */
    maxRalphIterations: number | undefined;
    setMaxRalphIterations: (n: number | undefined) => void;
    loaded: boolean;
}

const EMPTY_SKILLS: LastSkillsByMode = { task: [], ask: [] };
const EMPTY_MODELS: LastModelsByMode = { task: '', ask: '', note: '' };

export function usePreferences(repoId?: string): UsePreferencesResult {
    const [models, setModelsState] = useState<LastModelsByMode>({ ...EMPTY_MODELS });
    const [depth, setDepthState] = useState('');
    const [effort, setEffortState] = useState('');
    const [skills, setSkillsState] = useState<LastSkillsByMode>({ ...EMPTY_SKILLS });
    const [maxRalphIterations, setMaxRalphIterationsLocal] = useState<number | undefined>(undefined);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setModelsState({ ...EMPTY_MODELS });
        setDepthState('');
        setEffortState('');
        setSkillsState({ ...EMPTY_SKILLS });
        setMaxRalphIterationsLocal(undefined);
        if (!repoId) {
            setLoaded(true);
            return;
        }
        setLoaded(false);
        let cancelled = false;
        (async () => {
            try {
                const prefs = await getSpaCocClient().preferences.getRepo(repoId);
                if (!cancelled) {
                    // Read per-mode models, falling back to legacy lastModel
                    if (typeof prefs.lastModels === 'object' && prefs.lastModels !== null) {
                        setModelsState({
                            task: typeof prefs.lastModels.task === 'string' ? prefs.lastModels.task : '',
                            ask: typeof prefs.lastModels.ask === 'string' ? prefs.lastModels.ask : '',
                            note: typeof prefs.lastModels.note === 'string' ? prefs.lastModels.note : '',
                        });
                    } else if (typeof prefs.lastModel === 'string') {
                        // Backward compat: populate all modes from legacy single model
                        setModelsState({
                            task: prefs.lastModel,
                            ask: prefs.lastModel,
                            note: '',
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
                        });
                    }
                    if (typeof prefs.maxRalphIterations === 'number'
                        && Number.isInteger(prefs.maxRalphIterations)
                        && prefs.maxRalphIterations > 0) {
                        setMaxRalphIterationsLocal(prefs.maxRalphIterations);
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

    const setModel = useCallback((mode: ModelMode, m: string) => {
        setModelsState(prev => ({ ...prev, [mode]: m }));
        if (!repoId) return;
        getSpaCocClient().preferences.patchRepo(repoId, { lastModels: { [mode]: m } }).catch(() => {});
    }, [repoId]);

    const setDepth = useCallback((d: string) => {
        setDepthState(d);
        if (!repoId) return;
        getSpaCocClient().preferences.patchRepo(repoId, { lastDepth: d }).catch(() => {});
    }, [repoId]);

    const setEffort = useCallback((e: string) => {
        setEffortState(e);
        if (!repoId) return;
        getSpaCocClient().preferences.patchRepo(repoId, { lastEffort: e }).catch(() => {});
    }, [repoId]);

    const setSkill = useCallback((mode: SkillMode, s: string[]) => {
        setSkillsState(prev => ({ ...prev, [mode]: s }));
        if (!repoId) return;
        getSpaCocClient().preferences.patchRepo(repoId, { lastSkills: { [mode]: s } }).catch(() => {});
    }, [repoId]);

    const setMaxRalphIterations = useCallback((n: number | undefined) => {
        setMaxRalphIterationsLocal(n);
        if (!repoId) return;
        // Send null to clear (matches server-side patch semantics for omit).
        getSpaCocClient().preferences.patchRepo(repoId, {
            maxRalphIterations: n as any,
        }).catch(() => {});
    }, [repoId]);

    // Backward compat: expose task model as the single 'model' property
    const model = models.task;

    return {
        model,
        models,
        setModel,
        depth,
        setDepth,
        effort,
        setEffort,
        skills,
        setSkill,
        maxRalphIterations,
        setMaxRalphIterations,
        loaded,
    };
}
