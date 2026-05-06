/**
 * Regression tests for RepoSettingsTab Agent Skills expansion behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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

const repo = {
    workspace: { id: 'ws-1', rootPath: 'C:\\repo', color: '#ccc', description: '' },
    gitInfo: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
};

async function renderSettingsTab() {
    const { RepoSettingsTab } = await import(
        '../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab'
    );
    const { AppProvider } = await import(
        '../../../../src/server/spa/client/react/contexts/AppContext'
    );

    render(
        <AppProvider>
            <RepoSettingsTab workspaceId="ws-1" repo={repo as any} />
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
});
