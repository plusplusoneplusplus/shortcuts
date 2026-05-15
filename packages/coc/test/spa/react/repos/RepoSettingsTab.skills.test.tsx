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
    },
    preferences: {
        getRepo: vi.fn(),
        patchRepo: vi.fn(),
        getTaskSettings: vi.fn(),
    },
    workspaces: {
        getInstructions: vi.fn(),
        updateInstruction: vi.fn(),
        deleteInstruction: vi.fn(),
        update: vi.fn(),
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
        mockClient.preferences.getRepo.mockResolvedValue({});
        mockClient.preferences.patchRepo.mockResolvedValue({});
        mockClient.preferences.getTaskSettings.mockResolvedValue({});
        mockClient.workspaces.getInstructions.mockResolvedValue({ base: null, ask: null, plan: null, autopilot: null });
        mockClient.workspaces.updateInstruction.mockResolvedValue({ mode: 'base', content: '' });
        mockClient.workspaces.deleteInstruction.mockResolvedValue({ success: true });
        mockClient.workspaces.update.mockResolvedValue({ workspace: {} });
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

    it('shows EnDev-xDpu disabled by default and saves WSL defaults when enabled', async () => {
        await act(async () => {
            await renderSettingsTab({
                initialSection: 'endev-xdpu',
                rootPath: '\\\\wsl$\\Ubuntu\\home\\xstore',
            });
        });

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

    it('disables EnDev-xDpu toggle for non-WSL workspaces', async () => {
        await act(async () => {
            await renderSettingsTab({ initialSection: 'endev-xdpu', rootPath: 'C:\\repo' });
        });

        const toggle = await screen.findByTestId('endev-xdpu-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        expect(toggle.disabled).toBe(true);
        expect(screen.getByTestId('endev-xdpu-unsupported').textContent).toContain('not a WSL path');
    });
});
