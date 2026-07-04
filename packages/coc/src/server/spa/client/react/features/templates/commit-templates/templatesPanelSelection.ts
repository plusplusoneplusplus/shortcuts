/**
 * Pure selection model for TemplatesTab's four mutually exclusive panel domains:
 * workflow, commit template, AI chat (skill) template, and prompt/script template.
 *
 * `reduceTemplatesPanel` computes the full next selection for a user action, guaranteeing
 * that selecting one domain clears the incompatible IDs of the others. `templatesPanelHash`
 * derives the canonical route hash from a selection so the URL always agrees with the panel.
 * Both are React-free so the transitions can be unit-tested in isolation.
 */

import { enc } from './helpers';

export interface TemplatesPanelSelection {
    workflowName: string | null;
    commitTemplateName: string | null;
    skillTemplateId: string | null;
    scriptTemplateId: string | null;
    showCommitCreate: boolean;
    editingCommitName: string | null;
    editingScriptId: string | null;
}

export const EMPTY_TEMPLATES_PANEL_SELECTION: TemplatesPanelSelection = {
    workflowName: null,
    commitTemplateName: null,
    skillTemplateId: null,
    scriptTemplateId: null,
    showCommitCreate: false,
    editingCommitName: null,
    editingScriptId: null,
};

export type TemplatesPanelAction =
    | { type: 'select-workflow'; name: string }
    | { type: 'close-workflow' }
    | { type: 'select-commit'; name: string }
    | { type: 'create-commit' }
    | { type: 'edit-commit'; name: string }
    | { type: 'select-skill'; id: string }
    | { type: 'select-script'; id: string }
    | { type: 'edit-script'; id: string }
    | { type: 'reset' };

/**
 * Compute the next panel selection. Every "select" action starts from an empty selection so
 * the previously selected workflow/commit/skill/script is always cleared. `edit-commit`
 * preserves the underlying commit selection (so closing the form restores its detail), and
 * `close-workflow` only clears the workflow, leaving any other domain untouched.
 */
export function reduceTemplatesPanel(
    prev: TemplatesPanelSelection,
    action: TemplatesPanelAction,
): TemplatesPanelSelection {
    switch (action.type) {
        case 'select-workflow':
            return { ...EMPTY_TEMPLATES_PANEL_SELECTION, workflowName: action.name };
        case 'close-workflow':
            return { ...prev, workflowName: null };
        case 'select-commit':
            return { ...EMPTY_TEMPLATES_PANEL_SELECTION, commitTemplateName: action.name };
        case 'create-commit':
            return { ...EMPTY_TEMPLATES_PANEL_SELECTION, showCommitCreate: true };
        case 'edit-commit':
            return {
                ...EMPTY_TEMPLATES_PANEL_SELECTION,
                commitTemplateName: prev.commitTemplateName,
                editingCommitName: action.name,
            };
        case 'select-skill':
            return { ...EMPTY_TEMPLATES_PANEL_SELECTION, skillTemplateId: action.id };
        case 'select-script':
            return { ...EMPTY_TEMPLATES_PANEL_SELECTION, scriptTemplateId: action.id };
        case 'edit-script':
            return {
                ...EMPTY_TEMPLATES_PANEL_SELECTION,
                scriptTemplateId: action.id,
                editingScriptId: action.id,
            };
        case 'reset':
            return { ...EMPTY_TEMPLATES_PANEL_SELECTION };
        default:
            return prev;
    }
}

/** Canonical `#repos/<ws>/templates[...]` hash for a selection. */
export function templatesPanelHash(workspaceId: string, selection: TemplatesPanelSelection): string {
    const base = `#repos/${enc(workspaceId)}/templates`;
    if (selection.skillTemplateId) return `${base}/chat-template/${enc(selection.skillTemplateId)}`;
    if (selection.scriptTemplateId) return `${base}/script-template/${enc(selection.scriptTemplateId)}`;
    if (selection.workflowName) return `${base}/${enc(selection.workflowName)}`;
    return base;
}
