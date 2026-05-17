import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// Mock context hooks
const mockAddToast = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }),
    ToastContext: { Provider: ({ children }: any) => children },
    ToastProvider: ({ children }: any) => children,
}));

const mockRepos = [
    { workspace: { id: 'repo-a', name: 'Repo A', rootPath: '/a' } },
    { workspace: { id: 'repo-b', name: 'Repo B', rootPath: '/b' } },
    { workspace: { id: 'repo-c', name: 'Repo C', rootPath: '/c' } },
];

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, loading: false, fetchRepos: vi.fn(), unseenCounts: {} }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
}));

const mockSetFilesViewMode = vi.fn();
let mockFilesViewModeValue: 'flat' | 'tree' = 'tree';

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => {
    const { useState, useCallback } = require('react');
    return {
        useFilesViewMode: () => {
            const [mode, setModeState] = useState<'flat' | 'tree'>(mockFilesViewModeValue);
            const setMode = useCallback((m: 'flat' | 'tree') => {
                mockSetFilesViewMode(m);
                setModeState(m);
            }, []);
            return { mode, setMode };
        },
    };
});

import { RepoPreferencesSection } from '../../../../src/server/spa/client/react/features/repo-settings/RepoPreferencesSection';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockAddToast.mockReset();
    mockSetFilesViewMode.mockReset();
    mockFilesViewModeValue = 'tree';
    global.fetch = mockFetch;
});

/**
 * Default mock that handles all the fetches the component makes on mount:
 * 1. GET /workspaces/:id/preferences (usePreferences)
 * 2. GET /models (useModels)
 * 3. GET /workspaces/:id/skills/all
 * 4. GET /workspaces/:id/preferences (linked repos)
 */
function mockDefaultFetches(overrides?: {
    preferences?: Record<string, any>;
    models?: any[];
    skills?: any;
    linkedPrefs?: Record<string, any>;
}) {
    const prefs = overrides?.preferences ?? {};
    const models = overrides?.models ?? [
        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', enabled: true, tokenLimit: 200000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } } },
        { id: 'gpt-4', name: 'GPT-4', enabled: true, tokenLimit: 128000, capabilities: { supports: { vision: true, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
        { id: 'disabled-model', name: 'Disabled Model', enabled: false, tokenLimit: 8000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 8000 } } },
    ];
    const skills = overrides?.skills ?? { merged: [
        { name: 'impl', description: 'Implementation skill', source: 'repo' },
        { name: 'go-deep', description: 'Deep research', source: 'global' },
    ] };
    const linkedPrefs = overrides?.linkedPrefs ?? { linkedRepoIds: [] };

    mockFetch.mockImplementation((url: string, opts?: any) => {
        // PATCH requests
        if (opts?.method === 'PATCH') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        // GET /models
        if (url.includes('/models')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(models) });
        }
        // GET /skills/all
        if (url.includes('/skills/all')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(skills) });
        }
        // GET /preferences (both usePreferences and linked repos fetch)
        if (url.includes('/preferences')) {
            // If linkedPrefs has linkedRepoIds, return them with the prefs
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...prefs, ...linkedPrefs }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
}

function renderSection(workspaceId = 'repo-a') {
    return render(<RepoPreferencesSection workspaceId={workspaceId} />);
}

describe('RepoPreferencesSection', () => {
    describe('loading state', () => {
        it('shows loading indicator while preferences and models load', () => {
            mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
            renderSection();
            expect(screen.getByTestId('repo-preferences-loading')).toBeDefined();
            expect(screen.getByText('Loading…')).toBeDefined();
        });
    });

    describe('rendered form', () => {
        it('renders all sections: Models, Execution, Skills, Advanced', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('section-models')).toBeDefined();
                expect(screen.getByTestId('section-execution')).toBeDefined();
                expect(screen.getByTestId('section-skills')).toBeDefined();
                expect(screen.getByTestId('section-advanced')).toBeDefined();
            });
        });

        it('shows auto-save footer note', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('auto-save-note')).toBeDefined();
                expect(screen.getByText('Changes are saved automatically.')).toBeDefined();
            });
        });

        it('renders model dropdowns with enabled models only', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                const taskModel = screen.getByTestId('pref-model-task') as HTMLSelectElement;
                expect(taskModel).toBeDefined();
                // Should have default + 2 enabled models (not the disabled one)
                const options = Array.from(taskModel.options);
                expect(options.map(o => o.value)).toContain('default');
                expect(options.map(o => o.value)).toContain('claude-sonnet-4');
                expect(options.map(o => o.value)).toContain('gpt-4');
                expect(options.map(o => o.value)).not.toContain('disabled-model');
            });
        });

        it('renders Plan Model dropdown', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-model-plan')).toBeDefined();
            });
        });

        it('populates model selects from preferences', async () => {
            mockDefaultFetches({
                preferences: { lastModels: { task: 'gpt-4', ask: 'claude-sonnet-4' } },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                const taskModel = screen.getByTestId('pref-model-task') as HTMLSelectElement;
                expect(taskModel.value).toBe('gpt-4');
                const askModel = screen.getByTestId('pref-model-ask') as HTMLSelectElement;
                expect(askModel.value).toBe('claude-sonnet-4');
            });
        });

        it('populates depth and effort from preferences', async () => {
            mockDefaultFetches({
                preferences: { lastDepth: 'deep', lastEffort: 'high' },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                const depth = screen.getByTestId('pref-depth') as HTMLSelectElement;
                expect(depth.value).toBe('deep');
                const effort = screen.getByTestId('pref-effort') as HTMLSelectElement;
                expect(effort.value).toBe('high');
            });
        });

        it('shows default values when no preferences exist', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                const taskModel = screen.getByTestId('pref-model-task') as HTMLSelectElement;
                expect(taskModel.value).toBe('default');
                const depth = screen.getByTestId('pref-depth') as HTMLSelectElement;
                expect(depth.value).toBe('default');
                const effort = screen.getByTestId('pref-effort') as HTMLSelectElement;
                expect(effort.value).toBe('default');
            });
        });
    });

    describe('auto-save: models', () => {
        it('fires PATCH with lastModels when task model changes', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-model-task')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('pref-model-task'), { target: { value: 'gpt-4' } });
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastModels).toEqual({ task: 'gpt-4' });
            });
        });

        it('sends empty string when "default" is selected', async () => {
            mockDefaultFetches({
                preferences: { lastModels: { task: 'gpt-4' } },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-model-task')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('pref-model-task'), { target: { value: 'default' } });
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastModels).toEqual({ task: '' });
            });
        });
    });

    describe('auto-save: depth and effort', () => {
        it('fires PATCH with lastDepth when depth changes', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-depth')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('pref-depth'), { target: { value: 'deep' } });
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastDepth).toBe('deep');
            });
        });

        it('fires PATCH with lastEffort when effort changes', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-effort')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('pref-effort'), { target: { value: 'medium' } });
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastEffort).toBe('medium');
            });
        });

        it('clears depth to empty string when "default" is selected', async () => {
            mockDefaultFetches({ preferences: { lastDepth: 'deep' } });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-depth')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('pref-depth'), { target: { value: 'default' } });
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const body = JSON.parse(patchCalls[0][1].body);
                expect(body.lastDepth).toBe('');
            });
        });
    });

    describe('skills section', () => {
        it('renders skill pickers for task, ask, and plan', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-skill-task')).toBeDefined();
                expect(screen.getByTestId('pref-skill-ask')).toBeDefined();
                expect(screen.getByTestId('pref-skill-plan')).toBeDefined();
            });
        });
    });

    describe('EnDev xDPU (no UI)', () => {
        it('does not render any EnDev preference UI even when the wrapper skill is in the workspace skill list', async () => {
            mockDefaultFetches({
                skills: { merged: [{ name: 'EnDev-xDpu', description: 'EnDev wrapper', source: 'global' }] },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('section-skills')).toBeDefined();
            });
            expect(screen.queryByTestId('section-endev-xdpu')).toBeNull();
            expect(screen.queryByTestId('pref-endev-xdpu-enabled')).toBeNull();
            expect(screen.queryByTestId('pref-endev-xdpu-revalidate')).toBeNull();

            const endevCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
                url.includes('/endev/status') || url.includes('/endev/revalidate'));
            expect(endevCalls).toHaveLength(0);
        });
    });

    describe('linked repos', () => {
        it('renders linked repo tags', async () => {
            mockDefaultFetches({
                linkedPrefs: { linkedRepoIds: ['repo-b'] },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('linked-repo-repo-b')).toBeDefined();
                expect(screen.getByText('Repo B')).toBeDefined();
            });
        });

        it('shows "None" when no linked repos', async () => {
            mockDefaultFetches({ linkedPrefs: { linkedRepoIds: [] } });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByText('None')).toBeDefined();
            });
        });

        it('shows Add button when linkable repos exist', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('add-linked-repo')).toBeDefined();
            });
        });

        it('opens add repo dropdown when Add is clicked', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('add-linked-repo')).toBeDefined();
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('add-linked-repo'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('linked-repo-select')).toBeDefined();
            });
        });

        it('fires PATCH when adding a linked repo', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('add-linked-repo')).toBeDefined();
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('add-linked-repo'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('linked-repo-select')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('linked-repo-select'), { target: { value: 'repo-b' } });
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([url, opts]: [string, any]) => opts?.method === 'PATCH' && url.includes('/preferences')
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const body = JSON.parse(patchCalls[patchCalls.length - 1][1].body);
                expect(body.linkedRepoIds).toContain('repo-b');
            });
        });

        it('fires PATCH when removing a linked repo', async () => {
            mockDefaultFetches({
                linkedPrefs: { linkedRepoIds: ['repo-b', 'repo-c'] },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('remove-linked-repo-repo-b')).toBeDefined();
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('remove-linked-repo-repo-b'));
            });

            await waitFor(() => {
                const patchCalls = mockFetch.mock.calls.filter(
                    ([url, opts]: [string, any]) => opts?.method === 'PATCH' && url.includes('/preferences')
                );
                expect(patchCalls.length).toBeGreaterThan(0);
                const lastPatch = patchCalls[patchCalls.length - 1];
                const body = JSON.parse(lastPatch[1].body);
                expect(body.linkedRepoIds).toEqual(['repo-c']);
            });
        });

        it('reverts and shows toast on linked repo save failure', async () => {
            mockDefaultFetches({
                linkedPrefs: { linkedRepoIds: ['repo-b'] },
            });

            // Override PATCH to fail
            const originalImpl = mockFetch.getMockImplementation()!;
            mockFetch.mockImplementation((url: string, opts?: any) => {
                if (opts?.method === 'PATCH' && url.includes('/preferences')) {
                    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
                }
                return originalImpl(url, opts);
            });

            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('remove-linked-repo-repo-b')).toBeDefined();
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('remove-linked-repo-repo-b'));
            });

            await waitFor(() => {
                expect(mockAddToast).toHaveBeenCalledWith(
                    expect.stringContaining('CoC API request failed'),
                    'error'
                );
            });
        });
    });

    describe('does not show Add button when no repos to link', () => {
        it('hides Add button when all repos are already linked', async () => {
            mockDefaultFetches({
                linkedPrefs: { linkedRepoIds: ['repo-b', 'repo-c'] },
            });
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('linked-repos-chips')).toBeDefined();
            });

            expect(screen.queryByTestId('add-linked-repo')).toBeNull();
        });
    });

    describe('file list view mode', () => {
        it('renders File List View dropdown in Execution section', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-files-view-mode')).toBeDefined();
            });
        });

        it('defaults to tree', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                const select = screen.getByTestId('pref-files-view-mode') as HTMLSelectElement;
                expect(select.value).toBe('tree');
            });
        });

        it('shows flat when preference is flat', async () => {
            mockFilesViewModeValue = 'flat';
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                const select = screen.getByTestId('pref-files-view-mode') as HTMLSelectElement;
                expect(select.value).toBe('flat');
            });
        });

        it('calls setFilesViewMode when changed to flat', async () => {
            mockDefaultFetches();
            await act(async () => { renderSection(); });

            await waitFor(() => {
                expect(screen.getByTestId('pref-files-view-mode')).toBeDefined();
            });

            await act(async () => {
                fireEvent.change(screen.getByTestId('pref-files-view-mode'), { target: { value: 'flat' } });
            });

            expect(mockSetFilesViewMode).toHaveBeenCalledWith('flat');
        });
    });
});
