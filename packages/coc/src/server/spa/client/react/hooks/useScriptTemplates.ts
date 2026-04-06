/**
 * useScriptTemplates — reads and persists script templates for the Run Script dialog.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface ScriptTemplate {
    id: string;
    name: string;
    scriptPath: string;
    args?: string;
    workingDirectory?: string;
    model?: string;
    pauseOnFailure?: boolean;
}

export interface UseScriptTemplatesResult {
    templates: ScriptTemplate[];
    saveTemplate: (t: Omit<ScriptTemplate, 'id'>) => void;
    updateTemplate: (id: string, updates: Partial<Omit<ScriptTemplate, 'id'>>) => void;
    deleteTemplate: (id: string) => void;
    loaded: boolean;
}

export function useScriptTemplates(wsId?: string): UseScriptTemplatesResult {
    const prefsUrl = wsId
        ? getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/preferences'
        : getApiBase() + '/preferences';
    const [templates, setTemplates] = useState<ScriptTemplate[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(prefsUrl);
                if (!res.ok) return;
                const prefs = await res.json();
                if (!cancelled && Array.isArray(prefs.scriptTemplates)) {
                    setTemplates(prefs.scriptTemplates.filter((t: any) => t && t.id));
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [wsId]);

    const persist = useCallback((updated: ScriptTemplate[]) => {
        fetch(prefsUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scriptTemplates: updated }),
        }).catch(() => {});
    }, [wsId]);

    const saveTemplate = useCallback((t: Omit<ScriptTemplate, 'id'>) => {
        const entry: ScriptTemplate = { ...t, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
        setTemplates(prev => {
            const updated = [entry, ...prev];
            persist(updated);
            return updated;
        });
    }, [persist]);

    const updateTemplate = useCallback((id: string, updates: Partial<Omit<ScriptTemplate, 'id'>>) => {
        setTemplates(prev => {
            const updated = prev.map(t => t.id === id ? { ...t, ...updates } : t);
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

    return { templates, saveTemplate, updateTemplate, deleteTemplate, loaded };
}
