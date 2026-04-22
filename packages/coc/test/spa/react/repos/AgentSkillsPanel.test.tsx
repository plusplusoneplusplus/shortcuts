/**
 * Tests for AgentSkillsPanel — expand/collapse, enable/disable toggle, delete confirmation.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentSkillsPanel } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';
import type { Skill } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';

// Mock ToastContext used internally
vi.mock('../../../../src/server/spa/client/react/context/ToastContext', () => ({
    useGlobalToast: () => ({ showToast: vi.fn() }),
}));

// Mock fetch to avoid network calls
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });

const skills: Skill[] = [
    { name: 'code-review', description: 'Reviews code changes' },
    { name: 'impl', description: 'Implements features' },
];

function renderPanel(overrides: Partial<Parameters<typeof AgentSkillsPanel>[0]> = {}) {
    const onExpandSkill = vi.fn();
    const onDeleteSkill = vi.fn();
    const onSkillToggle = vi.fn();
    const onSetDeleteConfirm = vi.fn();
    const onInstalled = vi.fn();

    const result = render(
        <AgentSkillsPanel
            workspaceId="ws-test"
            skills={skills}
            skillsLoading={false}
            disabledSkills={[]}
            skillToggleSaving={false}
            expandedSkill={null}
            skillDetail={null}
            detailLoading={false}
            deleteConfirm={null}
            onExpandSkill={onExpandSkill}
            onDeleteSkill={onDeleteSkill}
            onSkillToggle={onSkillToggle}
            onSetDeleteConfirm={onSetDeleteConfirm}
            onInstalled={onInstalled}
            {...overrides}
        />
    );
    return { ...result, onExpandSkill, onDeleteSkill, onSkillToggle, onSetDeleteConfirm, onInstalled };
}

describe('AgentSkillsPanel — skill list rendering', () => {
    it('renders skill names', () => {
        renderPanel();
        expect(screen.getByText(/code-review/)).toBeTruthy();
        expect(screen.getByText(/impl/)).toBeTruthy();
    });

    it('renders skill descriptions', () => {
        renderPanel();
        expect(screen.getByText('Reviews code changes')).toBeTruthy();
        expect(screen.getByText('Implements features')).toBeTruthy();
    });

    it('shows empty state when skills array is empty', () => {
        renderPanel({ skills: [] });
        expect(screen.getByTestId('skills-empty-state')).toBeTruthy();
    });
});

describe('AgentSkillsPanel — expand', () => {
    it('calls onExpandSkill when skill row is clicked', async () => {
        const user = userEvent.setup();
        const { onExpandSkill } = renderPanel();
        await user.click(screen.getByTestId('skill-expand-code-review'));
        expect(onExpandSkill).toHaveBeenCalledWith('code-review');
    });
});

describe('AgentSkillsPanel — toggle', () => {
    it('calls onSkillToggle with name and true when enabling a disabled skill', async () => {
        const user = userEvent.setup();
        const { onSkillToggle } = renderPanel({ disabledSkills: ['code-review'] });
        const toggle = screen.getByTestId('skill-toggle-code-review');
        await user.click(toggle);
        expect(onSkillToggle).toHaveBeenCalledWith('code-review', true);
    });

    it('calls onSkillToggle with false when disabling an enabled skill', async () => {
        const user = userEvent.setup();
        const { onSkillToggle } = renderPanel({ disabledSkills: [] });
        const toggle = screen.getByTestId('skill-toggle-impl');
        await user.click(toggle);
        expect(onSkillToggle).toHaveBeenCalledWith('impl', false);
    });
});

describe('AgentSkillsPanel — delete confirmation', () => {
    it('calls onSetDeleteConfirm when delete button is clicked', async () => {
        const user = userEvent.setup();
        const { onSetDeleteConfirm } = renderPanel();
        // Delete button is opacity-0 by default; trigger via testid
        const deleteBtn = screen.getByTestId('skill-delete-btn-code-review');
        await user.click(deleteBtn);
        expect(onSetDeleteConfirm).toHaveBeenCalledWith('code-review');
    });

    it('shows confirm prompt when deleteConfirm matches skill name', () => {
        renderPanel({ deleteConfirm: 'code-review' });
        expect(screen.getByTestId('skill-delete-confirm-code-review')).toBeTruthy();
        expect(screen.getByText('Delete?')).toBeTruthy();
    });

    it('calls onDeleteSkill when Yes confirm is clicked', async () => {
        const user = userEvent.setup();
        const { onDeleteSkill } = renderPanel({ deleteConfirm: 'code-review' });
        await user.click(screen.getByTestId('skill-delete-confirm-code-review'));
        expect(onDeleteSkill).toHaveBeenCalledWith('code-review');
    });
});
