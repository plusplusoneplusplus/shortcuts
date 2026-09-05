/**
 * AC-03 — the Agent Skills panel in repo-group mode.
 *
 * A repo group is a virtual workspace with no git checkout, so there is no
 * `<groupRoot>/.github/skills` to install into, edit, or delete from. The panel keeps the
 * one thing a group can change — the per-skill enable/disable toggle — and drops every
 * write affordance behind a short inline hint. Member-repo skills still show which repo
 * they came from so the user can tell inherited rows from global ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AgentSkillsPanel } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';
import type { Skill } from '../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel';
import type { WorkspaceSkillsController } from '../../../../src/server/spa/client/react/features/skills/useWorkspaceSkillsController';
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

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

// One global skill and one inherited from a live member repo, exactly as
// skill-handler tags them for a group workspace.
const skills: Skill[] = [
    { name: 'code-review', description: 'Reviews code changes', source: 'global' },
    {
        name: 'deploy-api',
        description: 'Deploys the API',
        source: 'repo-group-member',
        sourceRepoId: 'repo-api',
        folderPath: '/src/api/.github/skills',
    },
];

const memberRepos = [
    { workspace: { id: 'repo-api', name: 'api', path: '/src/api' } },
] as unknown as RepoData[];

function renderPanel(
    overrides: Partial<WorkspaceSkillsController> = {},
    panelOverrides: Partial<Omit<Parameters<typeof AgentSkillsPanel>[0], 'controller' | 'resolveClient'>> = {},
) {
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
        setDeleteConfirm: vi.fn(),
        refresh: vi.fn(),
        expandSkill: vi.fn(),
        deleteSkill: vi.fn(),
        toggleSkill: vi.fn(),
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
            workspaceId="group-demo"
            controller={controller}
            resolveClient={() => mockClient as any}
            allRepos={memberRepos}
            groupMode
            {...panelOverrides}
        />
    );
    return { ...result, controller };
}

beforeEach(() => vi.clearAllMocks());

describe('AgentSkillsPanel — group mode', () => {
    it('drops the install affordance and explains why', () => {
        renderPanel();
        expect(screen.queryByTestId('skills-install-btn')).toBeNull();
        expect(screen.getByTestId('skills-group-readonly-hint').textContent)
            .toMatch(/no repository checkout/);
    });

    it('drops the delete affordance on every row', () => {
        renderPanel();
        expect(screen.queryByTestId('skill-delete-btn-code-review')).toBeNull();
        expect(screen.queryByTestId('skill-delete-btn-deploy-api')).toBeNull();
    });

    it('drops the source-set writes — link a repo, add folder, reorder', () => {
        renderPanel();
        expect(screen.queryByTestId('link-from-repo-btn')).toBeNull();
        expect(screen.queryByTestId('source-add-folder-btn')).toBeNull();
        for (const button of screen.getAllByTitle(/^Move (up|down)$/)) {
            expect((button as HTMLButtonElement).disabled).toBe(true);
        }
    });

    it('keeps the enable/disable toggle — the one thing a group may change', () => {
        renderPanel();
        expect(screen.getByTestId('skill-toggle-code-review')).toBeTruthy();
        expect(screen.getByTestId('skill-toggle-deploy-api')).toBeTruthy();
    });

    it('shows the member repo a skill was inherited from', () => {
        renderPanel();
        const list = screen.getByTestId('skills-list');
        expect(within(list).getByText('api')).toBeTruthy();
    });

    it('points the empty state at global settings and member repos, not an install button', () => {
        renderPanel({ skills: [] });
        const empty = screen.getByTestId('skills-empty-state');
        expect(empty.textContent).toMatch(/member repos/);
        expect(screen.queryByTestId('skills-install-btn')).toBeNull();
        expect(screen.queryByTestId('empty-state-link-repo-btn')).toBeNull();
    });

    it('still offers install, delete and linking for an ordinary repo workspace', () => {
        renderPanel({}, { groupMode: false, workspaceId: 'repo-api' });
        expect(screen.getByTestId('skills-install-btn')).toBeTruthy();
        expect(screen.getByTestId('source-add-folder-btn')).toBeTruthy();
    });
});
