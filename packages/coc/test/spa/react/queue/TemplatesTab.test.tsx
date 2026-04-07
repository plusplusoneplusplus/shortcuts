/**
 * Tests for TemplatesTab — mode-based template filtering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplatesTab } from '../../../../src/server/spa/client/react/queue/TemplatesTab';
import type { SkillTemplate } from '../../../../src/server/spa/client/react/hooks/useSkillTemplates';

const ASK_TEMPLATE: SkillTemplate = { id: 'ask-1', name: 'Ask Template', model: 'gpt-4', mode: 'ask', skills: [] };
const TASK_TEMPLATE: SkillTemplate = { id: 'task-1', name: 'Task Template', model: 'gpt-4', mode: 'task', skills: ['skill-a'] };

const defaultProps = {
    loaded: true,
    currentModel: 'gpt-4',
    currentSkills: [],
    currentPostActions: [],
    selectedTemplateId: null,
    onSelect: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
};

describe('TemplatesTab – mode filtering', () => {
    it('shows only ask-mode templates when currentMode is ask', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE, TASK_TEMPLATE]}
                currentMode="ask"
            />
        );
        expect(screen.getByTestId('template-card-ask-1')).toBeDefined();
        expect(screen.queryByTestId('template-card-task-1')).toBeNull();
    });

    it('shows only task-mode templates when currentMode is task', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE, TASK_TEMPLATE]}
                currentMode="task"
            />
        );
        expect(screen.getByTestId('template-card-task-1')).toBeDefined();
        expect(screen.queryByTestId('template-card-ask-1')).toBeNull();
    });

    it('shows unified empty state when templates exist but none match current mode', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[TASK_TEMPLATE]}
                currentMode="ask"
            />
        );
        const emptyState = screen.getByTestId('templates-empty-state');
        expect(emptyState.textContent).toContain('ask');
        expect(emptyState.textContent).toContain('templates yet');
        // Should NOT show a "Switch to" hint
        expect(emptyState.textContent).not.toContain('Switch to');
    });

    it('shows unified empty state when no templates exist at all', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[]}
                currentMode="ask"
            />
        );
        const emptyState = screen.getByTestId('templates-empty-state');
        expect(emptyState.textContent).toContain('ask');
        expect(emptyState.textContent).toContain('templates yet');
    });

    it('shows loading spinner when loaded is false', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[]}
                loaded={false}
                currentMode="ask"
            />
        );
        expect(screen.getByText(/Loading/)).toBeDefined();
        expect(screen.queryByTestId('templates-empty-state')).toBeNull();
    });

    it('calls onSelect with the correct template when a card is clicked', () => {
        const onSelect = vi.fn();
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE, TASK_TEMPLATE]}
                currentMode="ask"
                onSelect={onSelect}
            />
        );
        fireEvent.click(screen.getByTestId('template-card-ask-1'));
        expect(onSelect).toHaveBeenCalledWith(ASK_TEMPLATE);
        expect(onSelect).not.toHaveBeenCalledWith(TASK_TEMPLATE);
    });

    it('calls onDelete with the correct id', () => {
        const onDelete = vi.fn();
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE]}
                currentMode="ask"
                onDelete={onDelete}
            />
        );
        fireEvent.click(screen.getByTestId('template-delete-ask-1'));
        expect(onDelete).toHaveBeenCalledWith('ask-1');
    });

    it('renders selected checkmark for selectedTemplateId', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE]}
                currentMode="ask"
                selectedTemplateId="ask-1"
            />
        );
        expect(screen.getByTestId('template-selected-ask-1')).toBeDefined();
    });

    it('empty state shows current mode name correctly in task mode', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE]}
                currentMode="task"
            />
        );
        const emptyState = screen.getByTestId('templates-empty-state');
        expect(emptyState.textContent).toContain('task');
        expect(emptyState.textContent).toContain('templates yet');
        expect(emptyState.textContent).not.toContain('Switch to');
    });
});

describe('TemplatesTab – post-action chips', () => {
    const TEMPLATE_WITH_POST_ACTIONS: SkillTemplate = {
        id: 'pa-1',
        name: 'With Hooks',
        model: 'gpt-4',
        mode: 'ask',
        skills: [],
        postActions: [
            { type: 'script', script: './cleanup.sh' },
            { type: 'skill', skillName: 'summarize' },
        ],
    };

    it('renders post-action chips with correct icons and labels', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[TEMPLATE_WITH_POST_ACTIONS]}
                currentMode="ask"
            />
        );
        const card = screen.getByTestId('template-card-pa-1');
        expect(card.textContent).toContain('🔧');
        expect(card.textContent).toContain('./cleanup.sh');
        expect(card.textContent).toContain('⚡');
        expect(card.textContent).toContain('summarize');
        expect(card.textContent).toContain('→ post');
    });

    it('does not render post-action section when template has no postActions', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[ASK_TEMPLATE]}
                currentMode="ask"
            />
        );
        const card = screen.getByTestId('template-card-ask-1');
        expect(card.textContent).not.toContain('→ post');
    });
});

describe('TemplatesTab – canSave with post-actions', () => {
    it('canSave is true when only currentPostActions is non-empty', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[]}
                currentMode="ask"
                currentModel=""
                currentSkills={[]}
                currentPostActions={[{ type: 'script', script: './test.sh' }]}
            />
        );
        const btn = screen.getByTestId('save-template-btn');
        expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('canSave is false when model, skills, and postActions are all empty', () => {
        render(
            <TemplatesTab
                {...defaultProps}
                templates={[]}
                currentMode="ask"
                currentModel=""
                currentSkills={[]}
                currentPostActions={[]}
            />
        );
        const btn = screen.getByTestId('save-template-btn');
        expect(btn.hasAttribute('disabled')).toBe(true);
    });
});
