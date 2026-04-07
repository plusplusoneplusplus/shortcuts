/**
 * useSkillTemplates — reads and persists explicitly saved (model, mode, skills) templates.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface SkillTemplate {
    id: string;
    /** Optional display name; auto-generated at save time when absent. */
    name?: string;
    /** Model id; '' means default. */
    model: string;
    mode: 'ask' | 'task';
    skills: string[];
    /** Post-actions (scripts/skills) to run after the AI task. */
    postActions?: Array<
        | { type: 'script'; script: string }
        | { type: 'skill'; skillName: string; prompt?: string }
    >;
}

export interface UseSkillTemplatesResult {
    templates: SkillTemplate[];
    saveTemplate: (t: Omit<SkillTemplate, 'id'>) => void;
    deleteTemplate: (id: string) => void;
    loaded: boolean;
}

export function useSkillTemplates(wsId?: string): UseSkillTemplatesResult {
    const prefsUrl = wsId
        ? getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/preferences'
        : getApiBase() + '/preferences';
    const [templates, setTemplates] = useState<SkillTemplate[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(prefsUrl);
                if (!res.ok) return;
                const prefs = await res.json();
                if (!cancelled && Array.isArray(prefs.skillTemplates)) {
                    setTemplates(prefs.skillTemplates.filter((t: any) => t && t.id));
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [wsId]);

    const persist = useCallback((updated: SkillTemplate[]) => {
        fetch(prefsUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillTemplates: updated }),
        }).catch(() => {});
    }, [wsId]);

    const saveTemplate = useCallback((t: Omit<SkillTemplate, 'id'>) => {
        const entry: SkillTemplate = { ...t, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
        setTemplates(prev => {
            const updated = [entry, ...prev];
            persist(updated);
            return updated;
        });
    }, [persist]);

    const deleteTemplate = useCallback((id: string) => {
        setTemplates(prev => {
            const updated = prev.filter(t => t.id !== id);
            persist(updated);
            return updated;
        });
    }, [persist]);

    return { templates, saveTemplate, deleteTemplate, loaded };
}
