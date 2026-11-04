/**
 * useSkillTemplates — reads and persists explicitly saved (model, mode, skills) templates.
 * When wsId is provided, uses per-repo preferences at /api/workspaces/:id/preferences.
 * When wsId is empty/undefined, falls back to global /api/preferences.
 */

import { useCallback } from 'react';
import { createTemplateId, usePreferenceTemplates } from './usePreferenceTemplates';
import { isRecord } from '../../../utils/typeGuards';

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
    error: string | null;
}

function isSkillTemplate(value: unknown): value is SkillTemplate {
    return isRecord(value)
        && typeof value.id === 'string' && value.id.length > 0
        && (value.name === undefined || typeof value.name === 'string')
        && typeof value.model === 'string'
        && (value.mode === 'ask' || value.mode === 'task')
        && Array.isArray(value.skills) && value.skills.every((skill: unknown) => typeof skill === 'string')
        && (value.postActions === undefined || (
            Array.isArray(value.postActions) && value.postActions.every((action: unknown) =>
                isRecord(action) && (
                    (action.type === 'script' && typeof action.script === 'string')
                    || (action.type === 'skill' && typeof action.skillName === 'string'
                        && (action.prompt === undefined || typeof action.prompt === 'string'))
                ))
        ));
}

export function useSkillTemplates(wsId?: string): UseSkillTemplatesResult {
    const { templates, loaded, error, deleteTemplate, saveTemplate: save } =
        usePreferenceTemplates(wsId, 'skillTemplates', isSkillTemplate);
    const saveTemplate = useCallback((template: Omit<SkillTemplate, 'id'>) => {
        save({ ...template, id: createTemplateId() });
    }, [save]);
    return { templates, loaded, error, deleteTemplate, saveTemplate };
}
