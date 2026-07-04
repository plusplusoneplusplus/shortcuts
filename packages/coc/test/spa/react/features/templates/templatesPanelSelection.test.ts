/**
 * Unit tests for the pure TemplatesTab selection reducer and hash helper.
 * These lock the "selecting one domain clears the others" contract without rendering.
 */

import { describe, it, expect } from 'vitest';
import {
    reduceTemplatesPanel,
    templatesPanelHash,
    EMPTY_TEMPLATES_PANEL_SELECTION,
    type TemplatesPanelSelection,
} from '../../../../../src/server/spa/client/react/features/templates/commit-templates/templatesPanelSelection';

// A fully-populated selection so we can assert each action clears the incompatible domains.
const FULL: TemplatesPanelSelection = {
    workflowName: 'wf',
    commitTemplateName: 'commit-a',
    skillTemplateId: 'skill-a',
    scriptTemplateId: 'script-a',
    showCommitCreate: true,
    editingCommitName: 'commit-a',
    editingScriptId: 'script-a',
};

describe('reduceTemplatesPanel — mutual exclusivity', () => {
    it('select-workflow keeps only the workflow', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'select-workflow', name: 'wf2' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            workflowName: 'wf2',
        });
    });

    it('select-commit keeps only the commit template', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'select-commit', name: 'commit-b' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            commitTemplateName: 'commit-b',
        });
    });

    it('select-skill keeps only the skill template', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'select-skill', id: 'skill-b' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            skillTemplateId: 'skill-b',
        });
    });

    it('select-script keeps only the script template', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'select-script', id: 'script-b' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            scriptTemplateId: 'script-b',
        });
    });

    it('create-commit opens the create form and clears every selected id', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'create-commit' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            showCommitCreate: true,
        });
    });

    it('edit-commit preserves the underlying commit selection and clears other domains', () => {
        const prev: TemplatesPanelSelection = {
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            commitTemplateName: 'commit-a',
            skillTemplateId: 'skill-a',
        };
        expect(reduceTemplatesPanel(prev, { type: 'edit-commit', name: 'commit-a' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            commitTemplateName: 'commit-a',
            editingCommitName: 'commit-a',
        });
    });

    it('edit-script selects and enters edit for the same script, clearing others', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'edit-script', id: 'script-b' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            scriptTemplateId: 'script-b',
            editingScriptId: 'script-b',
        });
    });

    it('close-workflow clears only the workflow, leaving other domains intact', () => {
        const prev: TemplatesPanelSelection = {
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            workflowName: 'wf',
            skillTemplateId: 'skill-a',
        };
        expect(reduceTemplatesPanel(prev, { type: 'close-workflow' })).toEqual({
            ...EMPTY_TEMPLATES_PANEL_SELECTION,
            skillTemplateId: 'skill-a',
        });
    });

    it('reset clears everything', () => {
        expect(reduceTemplatesPanel(FULL, { type: 'reset' })).toEqual(EMPTY_TEMPLATES_PANEL_SELECTION);
    });
});

describe('templatesPanelHash', () => {
    it('returns the base route when nothing is selected', () => {
        expect(templatesPanelHash('ws-1', EMPTY_TEMPLATES_PANEL_SELECTION)).toBe('#repos/ws-1/templates');
    });

    it('routes to the workflow', () => {
        expect(templatesPanelHash('ws-1', { ...EMPTY_TEMPLATES_PANEL_SELECTION, workflowName: 'build' }))
            .toBe('#repos/ws-1/templates/build');
    });

    it('routes to the AI chat template', () => {
        expect(templatesPanelHash('ws-1', { ...EMPTY_TEMPLATES_PANEL_SELECTION, skillTemplateId: 'st-1' }))
            .toBe('#repos/ws-1/templates/chat-template/st-1');
    });

    it('routes to the prompt/script template', () => {
        expect(templatesPanelHash('ws-1', { ...EMPTY_TEMPLATES_PANEL_SELECTION, scriptTemplateId: 'sc-1' }))
            .toBe('#repos/ws-1/templates/script-template/sc-1');
    });

    it('uses the base route for a commit-template selection or create form', () => {
        expect(templatesPanelHash('ws-1', { ...EMPTY_TEMPLATES_PANEL_SELECTION, commitTemplateName: 'c' }))
            .toBe('#repos/ws-1/templates');
        expect(templatesPanelHash('ws-1', { ...EMPTY_TEMPLATES_PANEL_SELECTION, showCommitCreate: true }))
            .toBe('#repos/ws-1/templates');
    });

    it('encodes the workspace id and selection segments', () => {
        expect(templatesPanelHash('ws/1', { ...EMPTY_TEMPLATES_PANEL_SELECTION, skillTemplateId: 'a b' }))
            .toBe('#repos/ws%2F1/templates/chat-template/a%20b');
    });
});
