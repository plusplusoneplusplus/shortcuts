// @vitest-environment jsdom

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
        listAllWorkspace: vi.fn(),
    },
    preferences: {
        getRepo: vi.fn(),
        patchRepo: vi.fn(),
        getTaskSettings: vi.fn(),
    },
    models: {
        list: vi.fn(),
    },
    workspaces: {
        getInstructions: vi.fn(),
        updateInstruction: vi.fn(),
        deleteInstruction: vi.fn(),
        update: vi.fn(),
        discoverEnDevXDpu: vi.fn(),
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

vi.mock('../../../../src/server/spa/client/react/features/repo-settings/RepoPreferencesSection', async () => {
    const { EnDevXDpuSettingsSection, deriveEnDevXDpuWorkspaceDefaults } = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/repo-settings/EnDevXDpuSettingsSection')>(
        '../../../../src/server/spa/client/react/features/repo-settings/EnDevXDpuSettingsSection'
    );

    return {
        RepoPreferencesSection: ({ workspaceId, rootPath, enDevXDpu, onEnDevXDpuActivated }: {
            workspaceId: string;
            rootPath?: string;
            enDevXDpu?: { enabled?: boolean; wslDistro?: string; xstoreRepoRoot?: string };
            onEnDevXDpuActivated?: (result: { wslDistro?: string; xstoreRepoRoot?: string; mcpConfigPath?: string }) => void;
        }) => {
            const resolvedRootPath = rootPath ?? '';
            const showEnDevXDpu = deriveEnDevXDpuWorkspaceDefaults(resolvedRootPath).supported;
            return (
                <div data-testid="preferences-section-stub">
                    Preferences for {workspaceId}
                    <div data-testid="section-advanced">Advanced</div>
                    {showEnDevXDpu ? (
                        <EnDevXDpuSettingsSection
                            workspaceId={workspaceId}
                            rootPath={resolvedRootPath}
                            initialConfig={enDevXDpu}
                            onActivated={onEnDevXDpuActivated}
                        />
                    ) : null}
                </div>
            );
        },
    };
});

const repo = {
    workspace: { id: 'ws-1', rootPath: 'C:\\repo', color: '#ccc', description: '' },
    gitInfo: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
};

function makeRepo(workspaceId: string, rootPath?: string, endevXDpu?: any) {
    return {
        ...repo,
        workspace: {
            ...repo.workspace,
            id: workspaceId,
            rootPath: rootPath ?? (workspaceId === 'ws-1' ? repo.workspace.rootPath : ''),
            ...(endevXDpu ? { endevXDpu } : {}),
        },
    };
}

async function renderSettingsTab({
    workspaceId = 'ws-1',
    initialSection,
    rootPath,
    endevXDpu,
}: {
    workspaceId?: string;
    initialSection?: SettingsSection;
    rootPath?: string;
    endevXDpu?: any;
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
            <RepoSettingsTab workspaceId={workspaceId} repo={makeRepo(workspaceId, rootPath, endevXDpu) as any} />
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
        mockClient.skills.listAllWorkspace.mockResolvedValue({ merged: [] });
        mockClient.preferences.getRepo.mockResolvedValue({});
        mockClient.preferences.patchRepo.mockResolvedValue({});
        mockClient.preferences.getTaskSettings.mockResolvedValue({});
        mockClient.models.list.mockResolvedValue([
            { id: 'gpt-4', name: 'GPT-4', enabled: true, tokenLimit: 128000 },
        ]);
        mockClient.workspaces.getInstructions.mockResolvedValue({ base: null, ask: null, plan: null, autopilot: null });
        mockClient.workspaces.updateInstruction.mockResolvedValue({ mode: 'base', content: '' });
        mockClient.workspaces.deleteInstruction.mockResolvedValue({ success: true });
        mockClient.workspaces.update.mockResolvedValue({ workspace: {} });
        mockClient.workspaces.discoverEnDevXDpu.mockResolvedValue({
            workspace: {
                id: 'ws-1',
                rootPath: '\\\\wsl$\\Ubuntu\\home\\xstore',
                extraSkillFolders: ['\\\\wsl$\\Ubuntu\\home\\user\\.endev\\skills'],
                endevXDpu: {
                    enabled: true,
                    wslDistro: 'Ubuntu',
                    xstoreRepoRoot: '/home/xstore',
                    mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
                },
            },
            wslDistro: 'Ubuntu',
            xstoreRepoRoot: '/home/xstore',
            pluginSkillFolder: '/home/user/.endev/skills',
            extraSkillFolder: '\\\\wsl$\\Ubuntu\\home\\user\\.endev\\skills',
            mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
            wrapperSkillPath: 'C:\\data\\skills\\EnDev-xDpu\\SKILL.md',
            doctorOutput: 'endev doctor ok',
        });
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

    it.each(['my_work', 'my_life'])('hides the Notes nav item for virtual workspace %s', async (workspaceId) => {
        await act(async () => { await renderSettingsTab({ workspaceId }); });
        await waitFor(() => expect(screen.getByTestId('settings-sidebar')).toBeTruthy());

        expect(screen.queryByTestId('nav-item-notes')).toBeNull();
        expect(screen.queryByTestId('notes-settings-section')).toBeNull();
    });

    it.each(['my_work', 'my_life'])('redirects direct Notes settings links for virtual workspace %s to Info', async (workspaceId) => {
        location.hash = `#repos/${workspaceId}/settings/notes`;

        await act(async () => { await renderSettingsTab({ workspaceId, initialSection: 'notes' }); });

        await waitFor(() => expect(location.hash).toBe(`#repos/${workspaceId}/settings/info`));
        expect(screen.queryByTestId('nav-item-notes')).toBeNull();
        expect(screen.queryByTestId('notes-settings-section')).toBeNull();
    });

    it('shows EnDev-xDpu near the end of Preferences for WSL workspaces and saves WSL defaults when enabled', async () => {
        await act(async () => {
            await renderSettingsTab({
                initialSection: 'preferences',
                rootPath: '\\\\wsl$\\Ubuntu\\home\\xstore',
            });
        });

        await waitFor(() => expect(screen.queryByTestId('nav-item-endev-xdpu')).toBeNull());
        const advancedSection = await screen.findByTestId('section-advanced');
        const enDevSection = await screen.findByTestId('endev-xdpu-settings-section');
        expect(advancedSection.compareDocumentPosition(enDevSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(enDevSection.textContent).toContain('xDPU development workspaces that live inside WSL');
        expect(enDevSection.textContent).toContain('endev doctor');

        const toggle = await screen.findByTestId('endev-xdpu-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        expect(toggle.disabled).toBe(false);

        await act(async () => {
            fireEvent.click(toggle);
        });

        await waitFor(() => expect(mockClient.workspaces.update).toHaveBeenCalledWith('ws-1', {
            endevXDpu: {
                enabled: true,
                wslDistro: 'Ubuntu',
                xstoreRepoRoot: '/home/xstore',
            },
        }));
        expect((screen.getByTestId('endev-xdpu-distro') as HTMLInputElement).value).toBe('Ubuntu');
        expect((screen.getByTestId('endev-xdpu-root') as HTMLInputElement).value).toBe('/home/xstore');
    });

    it('saves native WSL EnDev-xDpu defaults without requiring a distro', async () => {
        await act(async () => {
            await renderSettingsTab({
                initialSection: 'preferences',
                rootPath: '/home/user/xstore',
            });
        });

        const toggle = await screen.findByTestId('endev-xdpu-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(false);

        await act(async () => {
            fireEvent.click(toggle);
        });

        await waitFor(() => expect(mockClient.workspaces.update).toHaveBeenCalledWith('ws-1', {
            endevXDpu: {
                enabled: true,
                xstoreRepoRoot: '/home/user/xstore',
            },
        }));
        expect((screen.getByTestId('endev-xdpu-distro') as HTMLInputElement).value).toBe('');
        expect((screen.getByTestId('endev-xdpu-root') as HTMLInputElement).value).toBe('/home/user/xstore');
    });

    it('hides EnDev-xDpu controls for non-WSL workspaces', async () => {
        await act(async () => {
            await renderSettingsTab({ initialSection: 'preferences', rootPath: 'C:\\repo' });
        });

        await waitFor(() => expect(screen.getByTestId('section-advanced')).toBeTruthy());
        expect(screen.queryByTestId('nav-item-endev-xdpu')).toBeNull();
        expect(screen.queryByTestId('endev-xdpu-settings-section')).toBeNull();
        expect(screen.queryByTestId('endev-xdpu-toggle')).toBeNull();
    });

    it('saves dirty EnDev-xDpu settings before running discovery and refreshing skills', async () => {
        await act(async () => {
            await renderSettingsTab({
                initialSection: 'preferences',
                rootPath: '\\\\wsl$\\Ubuntu\\home\\xstore',
                endevXDpu: { enabled: true, wslDistro: 'Ubuntu', xstoreRepoRoot: '/home/old-xstore' },
            });
        });
        await waitFor(() => expect(mockClient.skills.listWorkspace).toHaveBeenCalledWith('ws-1'));
        const initialSkillLoads = mockClient.skills.listWorkspace.mock.calls.length;

        await act(async () => {
            fireEvent.change(screen.getByTestId('endev-xdpu-root'), { target: { value: '/home/xstore' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('endev-xdpu-discover'));
        });

        await waitFor(() => expect(mockClient.workspaces.update).toHaveBeenCalledWith('ws-1', {
            endevXDpu: {
                enabled: true,
                wslDistro: 'Ubuntu',
                xstoreRepoRoot: '/home/xstore',
            },
        }));
        await waitFor(() => expect(mockClient.workspaces.discoverEnDevXDpu).toHaveBeenCalledWith('ws-1'));
        await waitFor(() => expect(mockClient.skills.listWorkspace.mock.calls.length).toBeGreaterThan(initialSkillLoads));

        expect(screen.getByTestId('endev-xdpu-discovery-success').textContent).toContain('funbird-mcp');
        expect(screen.getByTestId('endev-xdpu-discovery-success').textContent).toContain('endev doctor output');
        expect((screen.getByTestId('endev-xdpu-root') as HTMLInputElement).value).toBe('/home/xstore');
    });

    it('surfaces actionable EnDev-xDpu discovery errors', async () => {
        mockClient.workspaces.discoverEnDevXDpu.mockRejectedValueOnce(
            new Error('endev doctor failed in WSL. Open the WSL workspace terminal and run `endev doctor`.'),
        );

        await act(async () => {
            await renderSettingsTab({
                initialSection: 'preferences',
                rootPath: '\\\\wsl$\\Ubuntu\\home\\xstore',
                endevXDpu: { enabled: true, wslDistro: 'Ubuntu', xstoreRepoRoot: '/home/xstore' },
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('endev-xdpu-discover'));
        });

        await waitFor(() => expect(mockClient.workspaces.discoverEnDevXDpu).toHaveBeenCalledWith('ws-1'));
        expect(screen.getByTestId('endev-xdpu-discovery-error').textContent).toContain('run `endev doctor`');
    });
});

describe('RepoSettingsTab redesigned sidebar', () => {
    beforeEach(() => {
        vi.resetAllMocks();
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
});
