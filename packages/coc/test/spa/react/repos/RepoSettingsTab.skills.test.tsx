/**
 * Regression tests for RepoSettingsTab navigation behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect } from 'react';
import type { SettingsSection } from '../../../../src/server/spa/client/react/types/dashboard';

const mockFetchApi = vi.hoisted(() => vi.fn());
const mockClient = vi.hoisted(() => ({
    skills: {
        listWorkspace: vi.fn(),
        getWorkspaceConfig: vi.fn(),
        updateWorkspaceConfig: vi.fn(),
        detailWorkspace: vi.fn(),
        deleteWorkspace: vi.fn(),
        listBundledWorkspace: vi.fn(),
        getWorkspacePath: vi.fn(),
    },
    preferences: {
        getRepo: vi.fn(),
        patchRepo: vi.fn(),
        getTaskSettings: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [] }),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-settings/NotesSettingsSection', () => ({
    NotesSettingsSection: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="notes-settings-section">Notes settings for {workspaceId}</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-settings/SyncSettingsSection', () => ({
    SyncSettingsSection: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="sync-settings-section">Sync settings for {workspaceId}</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-settings/RepoPreferencesSection', () => ({
    RepoPreferencesSection: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="preferences-section-stub">Preferences for {workspaceId}</div>
    ),
}));

// Capture props passed to McpServersPanel for regression tests.
const capturedMcpPanelProps: Record<string, unknown>[] = [];
vi.mock('../../../../src/server/spa/client/react/features/skills/McpServersPanel', () => ({
    McpServersPanel: (props: Record<string, unknown>) => {
        capturedMcpPanelProps.push(props);
        return <div data-testid="mcp-servers-panel" data-workspace-id={props.workspaceId as string} />;
    },
}));

const repo = {
    workspace: { id: 'ws-1', rootPath: 'C:\\repo', color: '#ccc', description: '' },
    gitInfo: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
};

function makeRepo(workspaceId: string) {
    return {
        ...repo,
        workspace: {
            ...repo.workspace,
            id: workspaceId,
            rootPath: workspaceId === 'ws-1' ? repo.workspace.rootPath : '',
        },
    };
}

async function renderSettingsTab({
    workspaceId = 'ws-1',
    initialSection,
}: {
    workspaceId?: string;
    initialSection?: SettingsSection;
} = {}) {
    const { RepoSettingsTab } = await import(
        '../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab'
    );
    const { AppProvider, useApp } = await import(
        '../../../../src/server/spa/client/react/contexts/AppContext'
    );

    function InitialSectionSetter() {
        const { dispatch } = useApp();
        useEffect(() => {
            if (initialSection) {
                dispatch({ type: 'SET_SETTINGS_SECTION', section: initialSection });
            }
        }, [dispatch, initialSection]);
        return null;
    }

    render(
        <AppProvider>
            <InitialSectionSetter />
            <RepoSettingsTab workspaceId={workspaceId} repo={makeRepo(workspaceId) as any} />
        </AppProvider>
    );
}

describe('RepoSettingsTab skill expansion', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        location.hash = '';
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/mcp-config')) return Promise.resolve({ availableServers: [], enabledMcpServers: null });
            if (url.includes('/processes')) return Promise.resolve({ processes: [] });
            if (url.includes('/workspaces/')) return Promise.resolve({});
            return Promise.resolve({});
        });
        mockClient.skills.listWorkspace.mockResolvedValue([
            { name: 'impl', description: 'Implements features', version: '2.0.0' },
        ]);
        mockClient.skills.getWorkspaceConfig.mockResolvedValue({ disabledSkills: [], extraSkillFolders: [] });
        mockClient.skills.updateWorkspaceConfig.mockResolvedValue({});
        mockClient.skills.detailWorkspace.mockRejectedValue(new Error('detail failed'));
        mockClient.skills.deleteWorkspace.mockResolvedValue(undefined);
        mockClient.skills.listBundledWorkspace.mockResolvedValue([]);
        mockClient.skills.getWorkspacePath.mockResolvedValue({ path: 'C:\\repo\\.github\\skills', skillCount: 1, accessible: true });
        mockClient.preferences.getRepo.mockResolvedValue({});
        mockClient.preferences.patchRepo.mockResolvedValue({});
        mockClient.preferences.getTaskSettings.mockResolvedValue({});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ base: null, ask: null, plan: null, autopilot: null }),
        }));
    });

    it('keeps an inline detail panel visible when the detail API rejects', async () => {
        await act(async () => { await renderSettingsTab(); });
        await waitFor(() => expect(screen.getByTestId('nav-item-skills')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-skills'));
        });
        await waitFor(() => expect(screen.getByTestId('skill-expand-impl')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('skill-expand-impl'));
        });

        await waitFor(() => expect(mockClient.skills.detailWorkspace).toHaveBeenCalledWith('ws-1', 'impl'));
        await waitFor(() => expect(screen.queryByTestId('skill-detail-loading')).toBeNull());
        expect(screen.getByTestId('skill-detail-panel')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-version').textContent).toContain('v2.0.0');
    });

    it('shows the Notes nav item and opens Notes settings for normal repos', async () => {
        await act(async () => { await renderSettingsTab(); });
        await waitFor(() => expect(screen.getByTestId('nav-item-notes')).toBeTruthy());

        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-notes'));
        });

        await waitFor(() => expect(screen.getByTestId('notes-settings-section')).toBeTruthy());
        expect(location.hash).toBe('#repos/ws-1/settings/notes');
    });

    it.each(['my_work', 'my_life'])('shows Notes nav item with sync settings for virtual workspace %s', async (workspaceId) => {
        await act(async () => { await renderSettingsTab({ workspaceId }); });
        await waitFor(() => expect(screen.getByTestId('settings-sidebar')).toBeTruthy());

        expect(screen.getByTestId('nav-item-notes')).toBeTruthy();
    });

    it.each(['my_work', 'my_life'])('shows sync settings section when Notes is selected for virtual workspace %s', async (workspaceId) => {
        location.hash = `#repos/${workspaceId}/settings/notes`;

        await act(async () => { await renderSettingsTab({ workspaceId, initialSection: 'notes' }); });

        await waitFor(() => expect(location.hash).toBe(`#repos/${workspaceId}/settings/notes`));
        expect(screen.getByTestId('nav-item-notes')).toBeTruthy();
        expect(screen.getByTestId('sync-settings-section')).toBeTruthy();
    });
});

describe('RepoSettingsTab redesigned sidebar', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        capturedMcpPanelProps.length = 0;
        location.hash = '';
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/mcp-config')) return Promise.resolve({ availableServers: [], enabledMcpServers: null });
            if (url.includes('/processes')) return Promise.resolve({ processes: [] });
            if (url.includes('/workspaces/')) return Promise.resolve({});
            return Promise.resolve({});
        });
        mockClient.skills.listWorkspace.mockResolvedValue([]);
        mockClient.skills.getWorkspaceConfig.mockResolvedValue({ disabledSkills: [], extraSkillFolders: [] });
        mockClient.skills.updateWorkspaceConfig.mockResolvedValue({});
        mockClient.skills.detailWorkspace.mockResolvedValue({ skill: null });
        mockClient.skills.deleteWorkspace.mockResolvedValue(undefined);
        mockClient.skills.listBundledWorkspace.mockResolvedValue([]);
        mockClient.skills.getWorkspacePath.mockResolvedValue({ path: 'C:\\repo\\.github\\skills', skillCount: 0, accessible: true });
        mockClient.preferences.getRepo.mockResolvedValue({});
        mockClient.preferences.patchRepo.mockResolvedValue({});
        mockClient.preferences.getTaskSettings.mockResolvedValue({});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ base: null, ask: null, plan: null, autopilot: null }),
        }));
    });

    it('renders Repository and Agent group labels in the sidebar', async () => {
        await act(async () => { await renderSettingsTab(); });
        await waitFor(() => expect(screen.getByTestId('settings-sidebar')).toBeTruthy());
        expect(screen.getByTestId('nav-group-repository')).toBeTruthy();
        expect(screen.getByTestId('nav-group-agent')).toBeTruthy();
        const repoGroup = screen.getByTestId('nav-group-repository');
        expect(repoGroup.textContent).toContain('Repository');
        const agentGroup = screen.getByTestId('nav-group-agent');
        expect(agentGroup.textContent).toContain('Agent');
    });

    it('filters sidebar items by query and shows an empty state when nothing matches', async () => {
        await act(async () => { await renderSettingsTab(); });
        const input = await screen.findByTestId('settings-filter-input') as HTMLInputElement;

        await act(async () => {
            fireEvent.change(input, { target: { value: 'mcp' } });
        });
        expect(screen.getByTestId('nav-item-mcp')).toBeTruthy();
        expect(screen.queryByTestId('nav-item-info')).toBeNull();
        expect(screen.queryByTestId('nav-item-preferences')).toBeNull();

        await act(async () => {
            fireEvent.change(input, { target: { value: 'zzzzz-no-match' } });
        });
        expect(screen.getByTestId('settings-filter-empty')).toBeTruthy();
        expect(screen.queryByTestId('nav-item-mcp')).toBeNull();

        await act(async () => {
            fireEvent.change(input, { target: { value: '' } });
        });
        expect(screen.getByTestId('nav-item-info')).toBeTruthy();
        expect(screen.getByTestId('nav-item-mcp')).toBeTruthy();
    });

    it('renders the Info section header with title and description', async () => {
        await act(async () => { await renderSettingsTab({ initialSection: 'info' }); });
        await waitFor(() => expect(screen.getByTestId('settings-section-title')).toBeTruthy());
        expect(screen.getByTestId('settings-section-title').textContent).toBe('Info');
        expect(screen.getByTestId('settings-section-description').textContent).toContain('Workspace metadata');
    });

    it('renders the Info workspace, description, and activity cards with stat values', async () => {
        const repoWithStats = {
            ...makeRepo('ws-1'),
            stats: { success: 308, failed: 2, running: 1 },
            taskCount: 341,
            workflows: new Array(23).fill({}),
        };

        const { RepoSettingsTab } = await import(
            '../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab'
        );
        const { AppProvider } = await import(
            '../../../../src/server/spa/client/react/contexts/AppContext'
        );

        await act(async () => {
            render(
                <AppProvider>
                    <RepoSettingsTab workspaceId="ws-1" repo={repoWithStats as any} />
                </AppProvider>
            );
        });

        await waitFor(() => expect(screen.getByTestId('info-workspace-card')).toBeTruthy());
        expect(screen.getByTestId('info-description-card')).toBeTruthy();
        expect(screen.getByTestId('info-activity-card')).toBeTruthy();
        expect(screen.getByTestId('info-stat-workflows').textContent).toContain('23');
        expect(screen.getByTestId('info-stat-plans').textContent).toContain('341');
        expect(screen.getByTestId('info-stat-running').textContent).toContain('1');
        expect(screen.getByTestId('info-stat-completed').textContent).toContain('308');
        expect(screen.getByTestId('info-stat-failed').textContent).toContain('2');
    });

    it('exposes refresh and copy header actions on the Info section only', async () => {
        await act(async () => { await renderSettingsTab({ initialSection: 'info' }); });
        await waitFor(() => expect(screen.getByTestId('settings-header-refresh')).toBeTruthy());
        expect(screen.getByTestId('settings-header-copy')).toBeTruthy();

        // Refresh re-issues the processes fetch.
        mockFetchApi.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByTestId('settings-header-refresh'));
        });
        expect(mockFetchApi.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/processes?workspace=ws-1'))).toBe(true);

        // Switching off Info hides the header actions.
        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-preferences'));
        });
        expect(screen.queryByTestId('settings-header-refresh')).toBeNull();
        expect(screen.queryByTestId('settings-header-copy')).toBeNull();
    });

    it('passes workspaceId to McpServersPanel (regression: OAuth "not found in config")', async () => {
        await act(async () => { await renderSettingsTab({ workspaceId: 'ws-42' }); });

        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-mcp'));
        });

        await waitFor(() => expect(screen.getByTestId('mcp-servers-panel')).toBeTruthy());
        const panel = screen.getByTestId('mcp-servers-panel');
        expect(panel.getAttribute('data-workspace-id')).toBe('ws-42');
        // Ensure the prop was explicitly forwarded in the last render of the panel.
        const lastProps = capturedMcpPanelProps[capturedMcpPanelProps.length - 1];
        expect(lastProps.workspaceId).toBe('ws-42');
    });
});
