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
