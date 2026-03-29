/**
 * Tests for the Tasks Settings section in RepoSettingsTab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockSettingsGet(data: { taskRootPath?: string; folderPaths?: string[] } = {}) {
    return {
        taskRootPath: data.taskRootPath ?? '/home/user/.coc/repos/ws-1/tasks',
        folderPaths: data.folderPaths ?? [],
    };
}

function mockPatchOk(folderPaths: string[]) {
    return { folderPaths };
}

function mockPatchError(status: number, error: string) {
    return new Error(`API error: ${status} - ${error}`);
}

async function renderSection(opts: { taskRootPath?: string; folderPaths?: string[] } = {}) {
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/tasks/settings')) {
            return Promise.resolve(mockSettingsGet(opts));
        }
        return Promise.resolve({});
    });

    const { TasksSettingsSection } = await import(
        '../../../../src/server/spa/client/react/repos/TasksSettingsSection'
    );

    const result = render(<TasksSettingsSection workspaceId="ws-1" />);

    // Wait for loading to finish
    await waitFor(() => {
        expect(screen.queryByTestId('tasks-settings-loading')).toBeNull();
    });

    return result;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.resetAllMocks();
});

describe('TasksSettingsSection', () => {
    it('calls fetchApi with correct path (no double /api/ prefix)', async () => {
        mockFetchApi.mockResolvedValue(mockSettingsGet());

        const { TasksSettingsSection } = await import(
            '../../../../src/server/spa/client/react/repos/TasksSettingsSection'
        );
        render(<TasksSettingsSection workspaceId="ws-abc" />);

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalled();
        });

        const [url] = mockFetchApi.mock.calls[0];
        expect(url).toBe('/workspaces/ws-abc/tasks/settings');
        expect(url).not.toContain('/api/');
    });

    it('shows loading state initially', async () => {
        // Never resolves so we stay in loading
        mockFetchApi.mockReturnValue(new Promise(() => {}));

        const { TasksSettingsSection } = await import(
            '../../../../src/server/spa/client/react/repos/TasksSettingsSection'
        );
        render(<TasksSettingsSection workspaceId="ws-1" />);

        expect(screen.getByTestId('tasks-settings-loading')).toBeTruthy();
    });

    it('renders the primary folder as read-only with default badge', async () => {
        await renderSection({ taskRootPath: '/data/tasks' });

        const primary = screen.getByTestId('primary-folder');
        expect(primary.textContent).toContain('/data/tasks');
        expect(primary.textContent).toContain('default');
    });

    it('shows empty state when no additional folders', async () => {
        await renderSection({ folderPaths: [] });

        expect(screen.getByTestId('no-extra-folders')).toBeTruthy();
        expect(screen.getByTestId('no-extra-folders').textContent).toBe(
            'No additional folders configured.'
        );
    });

    it('renders additional folder paths', async () => {
        await renderSection({ folderPaths: ['/extra/a', '/extra/b'] });

        const folders = screen.getAllByTestId('extra-folder');
        expect(folders.length).toBe(2);
        expect(folders[0].textContent).toContain('/extra/a');
        expect(folders[1].textContent).toContain('/extra/b');
    });

    it('adds a new folder and calls PATCH', async () => {
        await renderSection({ folderPaths: [] });

        mockFetchApi.mockImplementation((url: string, init?: any) => {
            if (init?.method === 'PATCH') {
                return Promise.resolve(mockPatchOk(['/new/path']));
            }
            return Promise.resolve(mockSettingsGet({ folderPaths: [] }));
        });

        const input = screen.getByTestId('new-folder-input');
        const addBtn = screen.getByTestId('add-folder-btn');

        await act(async () => {
            fireEvent.change(input, { target: { value: '/new/path' } });
        });

        await act(async () => {
            fireEvent.click(addBtn);
        });

        // Verify PATCH was called
        await waitFor(() => {
            const patchCall = mockFetchApi.mock.calls.find(
                (c: any[]) => c[1]?.method === 'PATCH'
            );
            expect(patchCall).toBeTruthy();
            const body = JSON.parse(patchCall![1].body);
            expect(body.folderPaths).toEqual(['/new/path']);
        });

        // Folder should appear in the list
        await waitFor(() => {
            expect(screen.getByText('/new/path')).toBeTruthy();
        });
    });

    it('adds a folder on Enter key', async () => {
        await renderSection({ folderPaths: [] });

        mockFetchApi.mockImplementation((url: string, init?: any) => {
            if (init?.method === 'PATCH') {
                return Promise.resolve(mockPatchOk(['/entered']));
            }
            return Promise.resolve(mockSettingsGet({ folderPaths: [] }));
        });

        const input = screen.getByTestId('new-folder-input');

        await act(async () => {
            fireEvent.change(input, { target: { value: '/entered' } });
        });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        await waitFor(() => {
            const patchCall = mockFetchApi.mock.calls.find(
                (c: any[]) => c[1]?.method === 'PATCH'
            );
            expect(patchCall).toBeTruthy();
        });
    });

    it('disables Add button when input is empty', async () => {
        await renderSection();

        const addBtn = screen.getByTestId('add-folder-btn') as HTMLButtonElement;
        expect(addBtn.disabled).toBe(true);
    });

    it('prevents adding duplicate folder paths', async () => {
        await renderSection({ folderPaths: ['/existing'] });

        const input = screen.getByTestId('new-folder-input');

        await act(async () => {
            fireEvent.change(input, { target: { value: '/existing' } });
        });

        const addBtn = screen.getByTestId('add-folder-btn') as HTMLButtonElement;
        expect(addBtn.disabled).toBe(true);
    });

    it('removes a folder and calls PATCH', async () => {
        await renderSection({ folderPaths: ['/remove/me', '/keep'] });

        mockFetchApi.mockImplementation((url: string, init?: any) => {
            if (init?.method === 'PATCH') {
                return Promise.resolve(mockPatchOk(['/keep']));
            }
            return Promise.resolve(mockSettingsGet({ folderPaths: ['/remove/me', '/keep'] }));
        });

        const removeBtns = screen.getAllByTestId('remove-folder-btn');
        expect(removeBtns.length).toBe(2);

        await act(async () => {
            fireEvent.click(removeBtns[0]);
        });

        await waitFor(() => {
            const patchCall = mockFetchApi.mock.calls.find(
                (c: any[]) => c[1]?.method === 'PATCH'
            );
            expect(patchCall).toBeTruthy();
            const body = JSON.parse(patchCall![1].body);
            expect(body.folderPaths).toEqual(['/keep']);
        });
    });

    it('shows error when PATCH fails', async () => {
        await renderSection({ folderPaths: [] });

        mockFetchApi.mockImplementation((url: string, init?: any) => {
            if (init?.method === 'PATCH') {
                return Promise.reject(mockPatchError(403, 'Path outside trusted directories'));
            }
            return Promise.resolve(mockSettingsGet({ folderPaths: [] }));
        });

        const input = screen.getByTestId('new-folder-input');
        const addBtn = screen.getByTestId('add-folder-btn');

        await act(async () => {
            fireEvent.change(input, { target: { value: '/bad/path' } });
        });
        await act(async () => {
            fireEvent.click(addBtn);
        });

        await waitFor(() => {
            const errorEl = screen.getByTestId('tasks-settings-error');
            expect(errorEl).toBeTruthy();
            expect(errorEl.textContent).toContain('Path outside trusted directories');
        });
    });

    it('shows error when GET fails', async () => {
        mockFetchApi.mockImplementation(() =>
            Promise.reject(new Error('API error: 500 Internal Server Error'))
        );

        const { TasksSettingsSection } = await import(
            '../../../../src/server/spa/client/react/repos/TasksSettingsSection'
        );

        render(<TasksSettingsSection workspaceId="ws-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('tasks-settings-error')).toBeTruthy();
        });
    });

    it('clears input after successful add', async () => {
        await renderSection({ folderPaths: [] });

        mockFetchApi.mockImplementation((url: string, init?: any) => {
            if (init?.method === 'PATCH') {
                return Promise.resolve(mockPatchOk(['/added']));
            }
            return Promise.resolve(mockSettingsGet({ folderPaths: [] }));
        });

        const input = screen.getByTestId('new-folder-input') as HTMLInputElement;

        await act(async () => {
            fireEvent.change(input, { target: { value: '/added' } });
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('add-folder-btn'));
        });

        await waitFor(() => {
            expect(input.value).toBe('');
        });
    });
});

describe('RepoSettingsTab tasks nav item', () => {
    it('shows the Tasks nav item', async () => {
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/tasks/settings')) return Promise.resolve(mockSettingsGet());
            if (url.includes('/mcp-config')) return Promise.resolve({ availableServers: [], enabledMcpServers: null });
            if (url.includes('/skills-config')) return Promise.resolve({ disabledSkills: [], extraSkillFolders: [] });
            if (url.includes('/preferences')) return Promise.resolve({});
            if (url.includes('/processes')) return Promise.resolve({ processes: [] });
            if (url.includes('/instructions')) return Promise.resolve({ base: null, ask: null, plan: null, autopilot: null });
            return Promise.resolve({});
        });

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
            if (url.includes('/preferences')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            if (url.includes('/instructions')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ base: null, ask: null, plan: null, autopilot: null }) });
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }));

        // Mock ToastContext and ReposContext needed by RepoSettingsTab
        vi.mock('../../../../src/server/spa/client/react/context/ToastContext', () => ({
            useGlobalToast: () => ({ addToast: vi.fn() }),
        }));
        vi.mock('../../../../src/server/spa/client/react/context/ReposContext', () => ({
            useRepos: () => ({ repos: [] }),
        }));

        const { RepoSettingsTab } = await import(
            '../../../../src/server/spa/client/react/repos/RepoSettingsTab'
        );
        const { AppProvider } = await import(
            '../../../../src/server/spa/client/react/context/AppContext'
        );

        const repo = {
            workspace: { id: 'ws-1', rootPath: '/repo', color: '#ccc', description: '' },
            gitInfo: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
            stats: { success: 0, failed: 0, running: 0 },
            workflows: [],
            taskCount: 0,
        };

        render(
            <AppProvider>
                <RepoSettingsTab workspaceId="ws-1" repo={repo as any} />
            </AppProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('nav-item-tasks')).toBeTruthy();
        });
        expect(screen.getByTestId('nav-item-tasks').textContent).toContain('Tasks');
    });
});
