/**
 * useScriptTemplates — reads and persists script templates for the Prompt & Script dialog.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useCallback } from 'react';
import { createTemplateId, usePreferenceTemplates } from './usePreferenceTemplates';
import { isRecord } from '../../../utils/typeGuards';

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
    error: string | null;
}

function isScriptTemplate(value: unknown): value is ScriptTemplate {
    return isRecord(value)
        && typeof value.id === 'string' && value.id.length > 0
        && typeof value.name === 'string'
        && typeof value.scriptPath === 'string'
        && (value.args === undefined || typeof value.args === 'string')
        && (value.workingDirectory === undefined || typeof value.workingDirectory === 'string')
        && (value.model === undefined || typeof value.model === 'string')
        && (value.pauseOnFailure === undefined || typeof value.pauseOnFailure === 'boolean');
}

export function useScriptTemplates(wsId?: string): UseScriptTemplatesResult {
    const { saveTemplate: save, ...result } = usePreferenceTemplates(wsId, 'scriptTemplates', isScriptTemplate);
    const saveTemplate = useCallback((template: Omit<ScriptTemplate, 'id'>) => {
        save({ ...template, id: createTemplateId() });
    }, [save]);
    return { ...result, saveTemplate };
}
