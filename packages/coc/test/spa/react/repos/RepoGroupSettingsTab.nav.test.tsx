/**
 * RepoGroupSettingsTab navigation (AC-01).
 *
 * A repo group's Settings tab reuses the shared `SettingsNavSidebar` rather than
 * a second copy of the layout, so these tests pin what a group's sidebar shows
 * (a "Group" and an "Agent" nav group), that picking an item swaps the right
 * pane and rewrites `#repos/<groupId>/settings/<section>`, that arriving on that
 * hash deep-links to the section, and that a section a group does not have falls
 * back to Member repos instead of rendering an empty pane.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SettingsSection } from '../../../../src/server/spa/client/react/types/dashboard';

const mockGetRepoGroup = vi.fn();
const mockUpdateRepoGroup = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup: (...args: unknown[]) => mockGetRepoGroup(...args),
    updateRepoGroup: (...args: unknown[]) => mockUpdateRepoGroup(...args),
    REPO_GROUP_DESCRIPTION_MAX_LENGTH: 280,
}));

const mockClient = vi.hoisted(() => ({
    skills: {
        listWorkspace: vi.fn(async () => ({ skills: [] })),
        getWorkspaceConfig: vi.fn(async () => ({ disabledSkills: [], extraSkillFolders: [] })),
        updateWorkspaceConfig: vi.fn(async () => ({})),
        listBundledWorkspace: vi.fn(async () => ({ skills: [] })),
        getWorkspacePath: vi.fn(async () => ({ path: null })),
    },
    preferences: { getRepo: vi.fn(async () => ({})), patchRepo: vi.fn(async () => ({})) },
    workspaces: {
        getMcpConfig: vi.fn(async () => ({ availableServers: [], enabledMcpServers: null })),
        updateMcpConfig: vi.fn(async () => ({})),
    },
}));

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => mockClient,
    requestForWorkspace: vi.fn(async () => ({})),
}));

// The Agent panels have their own suites; stub them so these assertions are
// about the shell — which section is mounted — not about panel internals.
vi.mock('../../../../src/server/spa/client/react/features/skills/McpServersPanel', () => ({
    McpServersPanel: (props: Record<string, unknown>) => (
        <div data-testid="mcp-servers-panel" data-workspace-id={props.workspaceId as string} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/skills/AgentSkillsPanel', () => ({
    AgentSkillsPanel: (props: Record<string, unknown>) => (
        <div data-testid="agent-skills-panel" data-workspace-id={props.workspaceId as string} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-settings/LlmToolsPanel', () => ({
    LlmToolsPanel: (props: { workspaceId: string }) => (
        <div data-testid="llm-tools-panel" data-workspace-id={props.workspaceId} />
    ),
}));

const GROUP_ID = 'group-ai-repos';
const MEMBERS = [
    { workspaceId: 'r1', stale: false, name: 'shortcuts', rootPath: '/r/r1', description: 'The monorepo' },
    { workspaceId: 'r2', stale: false, name: 'docs', rootPath: '/r/r2' },
];

async function renderGroupSettings(initialSection?: SettingsSection) {
    const { RepoGroupSettingsTab } = await import(
        '../../../../src/server/spa/client/react/repos/RepoGroupSettingsTab'
    );
    const { AppProvider, useApp } = await import(
        '../../../../src/server/spa/client/react/contexts/AppContext'
    );

    function InitialSectionSetter() {
        const { dispatch } = useApp();
        useEffect(() => {
            if (initialSection) dispatch({ type: 'SET_SETTINGS_SECTION', section: initialSection });
        }, [dispatch]);
        return null;
    }

    return render(
        <AppProvider>
            <InitialSectionSetter />
            <RepoGroupSettingsTab workspaceId={GROUP_ID} active />
        </AppProvider>
    );
}

beforeEach(() => {
    cleanup();
    location.hash = '';
    mockGetRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
    mockUpdateRepoGroup.mockReset().mockResolvedValue({ id: GROUP_ID, name: 'AI Repos', members: MEMBERS });
});

describe('RepoGroupSettingsTab navigation', () => {
    it('renders the Group and Agent nav groups with the group sections', async () => {
        await renderGroupSettings();

        expect(screen.getByTestId('settings-sidebar')).toBeTruthy();
        const groupNav = screen.getByTestId('nav-group-group');
        expect(within(groupNav).getByTestId('nav-item-members')).toBeTruthy();

        const agentNav = screen.getByTestId('nav-group-agent');
        expect(within(agentNav).getByTestId('nav-item-mcp')).toBeTruthy();
        expect(within(agentNav).getByTestId('nav-item-skills')).toBeTruthy();
        expect(within(agentNav).getByTestId('nav-item-llm-tools')).toBeTruthy();
        expect(agentNav.textContent).toContain('Agent');

        // Sections a group has no writable home for stay off the list.
        expect(screen.queryByTestId('nav-item-info')).toBeNull();
        expect(screen.queryByTestId('nav-item-instructions')).toBeNull();
        expect(screen.queryByTestId('nav-item-memory')).toBeNull();
        expect(screen.queryByTestId('nav-item-notes')).toBeNull();
    });

    it('opens on Member repos and badges it with the member count', async () => {
        await renderGroupSettings();

        expect(screen.getByTestId('nav-item-members').getAttribute('aria-current')).toBe('page');
        await waitFor(() => expect(screen.getByTestId('repo-group-member-list')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('nav-item-members').textContent).toContain('2'));
    });

    it('swaps the right pane and rewrites the hash when a section is picked', async () => {
        await renderGroupSettings();

        fireEvent.click(screen.getByTestId('nav-item-llm-tools'));
        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());
        expect(screen.getByTestId('llm-tools-panel').getAttribute('data-workspace-id')).toBe(GROUP_ID);
        expect(location.hash).toBe('#repos/' + GROUP_ID + '/settings/llm-tools');

        fireEvent.click(screen.getByTestId('nav-item-mcp'));
        await waitFor(() => expect(screen.getByTestId('mcp-servers-panel')).toBeTruthy());
        expect(location.hash).toBe('#repos/' + GROUP_ID + '/settings/mcp');

        fireEvent.click(screen.getByTestId('nav-item-skills'));
        await waitFor(() => expect(screen.getByTestId('agent-skills-panel')).toBeTruthy());
        expect(location.hash).toBe('#repos/' + GROUP_ID + '/settings/skills');
        expect(screen.queryByTestId('repo-group-member-list')).toBeNull();
    });

    it('deep-links to the section named by the hash', async () => {
        await renderGroupSettings('llm-tools');

        await waitFor(() => expect(screen.getByTestId('llm-tools-panel')).toBeTruthy());
        expect(screen.getByTestId('nav-item-llm-tools').getAttribute('aria-current')).toBe('page');
    });

    it('falls back to Member repos for a section a group does not have', async () => {
        await renderGroupSettings('instructions');

        await waitFor(() => expect(screen.getByTestId('repo-group-member-list')).toBeTruthy());
        expect(screen.getByTestId('nav-item-members').getAttribute('aria-current')).toBe('page');
        expect(screen.getByTestId('settings-section-title').textContent).toBe('Member repos');
    });

    it('filters the sidebar without unmounting the filtered-out active section', async () => {
        await renderGroupSettings();
        await waitFor(() => expect(screen.getByTestId('repo-group-member-list')).toBeTruthy());

        fireEvent.change(screen.getByTestId('settings-filter-input'), { target: { value: 'mcp' } });

        expect(screen.getByTestId('nav-item-mcp')).toBeTruthy();
        expect(screen.queryByTestId('nav-item-members')).toBeNull();
        expect(screen.queryByTestId('nav-item-llm-tools')).toBeNull();
        // The right pane still shows Member repos — filtering narrows the list only.
        expect(screen.getByTestId('repo-group-member-list')).toBeTruthy();
    });
});
