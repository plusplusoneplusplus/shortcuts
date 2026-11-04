import { useCallback, useEffect, useRef, useState } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { getRepoPreferences, patchRepoPreferences } from '../../../api/repoPreferences';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { useRequestScope } from '../../../hooks/useRequestScope';

export function usePreferenceTemplates<T extends { id: string }>(
    wsId: string | undefined,
    key: 'scriptTemplates' | 'skillTemplates',
    isTemplate: (value: unknown) => value is T,
) {
    const client = useCocClient(wsId);
    const isCurrent = useRequestScope(client, JSON.stringify([wsId, key]));
    const [templates, setTemplates] = useState<T[]>([]);
    const templatesRef = useRef(templates);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        templatesRef.current = [];
        setTemplates([]);
        setLoaded(false);
        setError(null);
        const initial = templatesRef.current;
        void (async () => {
            try {
                const prefs = wsId ? await getRepoPreferences(client, wsId) : await client.preferences.getGlobal();
                if (!cancelled && isCurrent() && templatesRef.current === initial) {
                    const saved: unknown = prefs[key];
                    const entries = Array.isArray(saved) ? saved.filter(isTemplate) : [];
                    templatesRef.current = entries;
                    setTemplates(entries);
                }
            } catch (err) {
                if (!cancelled && isCurrent()) {
                    setError(getSpaCocClientErrorMessage(err, 'Failed to load templates'));
                }
            } finally {
                if (!cancelled && isCurrent()) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [client, wsId, key, isTemplate, isCurrent]);

    const changeTemplates = useCallback((change: (previous: T[]) => T[]) => {
        if (!isCurrent()) return;
        const updated = change(templatesRef.current);
        templatesRef.current = updated;
        setTemplates(updated);
        setError(null);
        const patch = { [key]: updated };
        void (async () => {
            try {
                if (wsId) await patchRepoPreferences(client, wsId, patch);
                else await client.preferences.patchGlobal(patch);
            } catch (err) {
                if (isCurrent()) setError(getSpaCocClientErrorMessage(err, 'Failed to save templates'));
            }
        })();
    }, [client, wsId, key, isCurrent]);

    const saveTemplate = useCallback((template: T) => {
        changeTemplates(previous => [template, ...previous]);
    }, [changeTemplates]);

    const updateTemplate = useCallback((id: string, updates: Partial<Omit<T, 'id'>>) => {
        changeTemplates(previous => previous.map(template => template.id === id ? { ...template, ...updates } : template));
    }, [changeTemplates]);

    const deleteTemplate = useCallback((id: string) => {
        changeTemplates(previous => previous.filter(template => template.id !== id));
    }, [changeTemplates]);

    return { templates, loaded, error, saveTemplate, updateTemplate, deleteTemplate };
}

export function createTemplateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
