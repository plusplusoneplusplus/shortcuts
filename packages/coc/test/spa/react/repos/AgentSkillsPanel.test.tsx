/**
 * Tests for AgentSkillsPanel — expand/collapse, enable/disable toggle, delete confirmation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentSkillsPanel } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';
import type { Skill } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';
import type { WorkspaceSkillsController } from '../../../../src/server/spa/client/react/features/skills/useWorkspaceSkillsController';

// Mock ToastContext used internally
vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn() }),
}));

const mockClient = {
    skills: {
        listBundledWorkspace: vi.fn().mockResolvedValue([]),
        scanWorkspace: vi.fn(),
        installWorkspace: vi.fn(),
    },
};

const skills: Skill[] = [
    { name: 'code-review', description: 'Reviews code changes' },
    { name: 'impl', description: 'Implements features' },
];

function renderPanel(
    overrides: Partial<WorkspaceSkillsController> = {},
    panelOverrides: Partial<Omit<Parameters<typeof AgentSkillsPanel>[0], 'controller' | 'resolveClient'>> = {},
) {
    const onExpandSkill = vi.fn();
    const onDeleteSkill = vi.fn();
    const onSkillToggle = vi.fn();
    const onSetDeleteConfirm = vi.fn();
    const onInstalled = vi.fn();

    const controller: WorkspaceSkillsController = {
        skills,
        skillsLoading: false,
        skillsError: null,
        disabledSkills: [],
        extraSkillFolders: [],
        linkedRepoIds: [],
        skillToggleSaving: false,
        expandedSkill: null,
        skillDetail: null,
        detailLoading: false,
        detailError: null,
        deleteConfirm: null,
        setDeleteConfirm: onSetDeleteConfirm,
        refresh: onInstalled,
        expandSkill: onExpandSkill,
        deleteSkill: onDeleteSkill,
        toggleSkill: onSkillToggle,
        addExtraSkillFolder: vi.fn(),
        removeExtraSkillFolder: vi.fn(),
        moveExtraSkillFolder: vi.fn(),
        linkRepo: vi.fn().mockResolvedValue(true),
        unlinkRepo: vi.fn(),
        readSkillFile: vi.fn(),
        probeRepoSkills: vi.fn(),
        ...overrides,
    };
    const result = render(
        <AgentSkillsPanel
            workspaceId="ws-test"
            controller={controller}
            resolveClient={() => mockClient as any}
            {...panelOverrides}
        />
    );
    return { ...result, controller, onExpandSkill, onDeleteSkill, onSkillToggle, onSetDeleteConfirm, onInstalled };
}

beforeEach(() => vi.clearAllMocks());

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

describe('AgentSkillsPanel — sources and filtering', () => {
    const sourcedSkills: Skill[] = [
        { name: 'repo-skill', source: 'repo', folderPath: '/repo/.github/skills' },
        { name: 'global-skill', source: 'global', folderPath: '/home/me/.coc/skills' },
        { name: 'linked-skill', source: 'linked-repo', sourceRepoId: 'ws-other', folderPath: '/other/.github/skills' },
    ];

    it('filters the list when a source rail row is selected', async () => {
        const user = userEvent.setup();
        renderPanel({ skills: sourcedSkills });

        await user.click(screen.getByTestId('source-group:global'));

        expect(screen.getByTestId('skill-item-global-skill')).toBeTruthy();
        expect(screen.queryByTestId('skill-item-repo-skill')).toBeNull();
    });

    it('removes a linked repo through the controller', async () => {
        const user = userEvent.setup();
        const { controller } = renderPanel(
            { skills: sourcedSkills, linkedRepoIds: ['ws-other'] },
            { allRepos: [
                { workspace: { id: 'ws-test', name: 'Current', rootPath: '/repo' } } as any,
                { workspace: { id: 'ws-other', name: 'Other', rootPath: '/other' } } as any,
            ] },
        );
        const source = screen.getByTestId('source-group:/other/.github/skills');

        await user.click(within(source).getByTitle('Remove this source'));

        expect(controller.unlinkRepo).toHaveBeenCalledWith('ws-other');
    });

    it('renders resolution rows and delegates extra-folder reordering', async () => {
        const user = userEvent.setup();
        const { controller } = renderPanel({
            skills: sourcedSkills,
            extraSkillFolders: ['/one', '/two'],
        });

        const secondExtra = screen.getByTestId('resolution-item-extra:1');
        await user.click(within(secondExtra).getByTitle('Move up'));

        expect(controller.moveExtraSkillFolder).toHaveBeenCalledWith('/two', -1);
    });

    it('shows load errors without replacing an existing skill list', () => {
        renderPanel({ skillsError: 'Failed to load skill config' });
        expect(screen.getByTestId('skills-load-error').textContent).toContain('Failed to load skill config');
        expect(screen.getByTestId('skill-item-code-review')).toBeTruthy();
    });
});

describe('AgentSkillsPanel — install dialog', () => {
    it('opens the install dialog and loads bundled skills through the injected client', async () => {
        const user = userEvent.setup();
        renderPanel();

        await user.click(screen.getByTestId('skills-install-btn'));

        expect(screen.getByTestId('install-skills-dialog')).toBeTruthy();
        await waitFor(() => expect(mockClient.skills.listBundledWorkspace).toHaveBeenCalledWith('ws-test'));
    });
});

describe('AgentSkillsPanel — expand', () => {
    it('calls onExpandSkill when skill row is clicked', async () => {
        const user = userEvent.setup();
        const { onExpandSkill } = renderPanel();
        await user.click(screen.getByTestId('skill-expand-code-review'));
        expect(onExpandSkill).toHaveBeenCalledWith('code-review');
    });

    it('renders an expanded detail panel from list metadata when fetched detail is missing', () => {
        renderPanel({
            skills: [{ name: 'code-review', description: 'Reviews code changes', version: '1.2.3' }],
            expandedSkill: 'code-review',
            skillDetail: null,
            detailLoading: false,
        });

        expect(screen.getByTestId('skill-detail-panel')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-version').textContent).toContain('v1.2.3');
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
