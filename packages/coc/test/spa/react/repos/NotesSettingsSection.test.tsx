/**
 * Tests for NotesSettingsSection — Notes tab in Repo Settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockAddToast = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type AutoCommitState = {
    enabled: boolean;
    intervalMs?: number;
    lastCommittedAt?: string | null;
    lastError?: string | null;
};

function mockAutoCommitHook(state: AutoCommitState) {
    return {
        autoCommitEnabled: state.enabled,
        intervalMs: state.intervalMs ?? null,
        lastCommittedAt: state.lastCommittedAt ?? null,
        lastError: state.lastError ?? null,
        loading: false,
        enabling: false,
        enable: vi.fn().mockResolvedValue(undefined),
        disable: vi.fn().mockResolvedValue(undefined),
        updateInterval: vi.fn().mockResolvedValue(undefined),
    };
}

async function renderSection(opts: {
    gitInitialized?: boolean;
    autoCommit?: AutoCommitState;
}) {
    const { gitInitialized = true, autoCommit = { enabled: false } } = opts;

    const mockHook = mockAutoCommitHook(autoCommit);

    vi.doMock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesAutoCommit', () => ({
        useNotesAutoCommit: () => mockHook,
    }));

    vi.doMock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
        notesApi: {
            getGitStatus: vi.fn().mockResolvedValue({ initialized: gitInitialized }),
        },
    }));

    const { NotesSettingsSection } = await import(
        '../../../../src/server/spa/client/react/features/repo-settings/NotesSettingsSection'
    );

    const result = render(<NotesSettingsSection workspaceId="ws-1" />);

    // Wait for loading to finish
    await waitFor(() => {
        expect(screen.queryByTestId('notes-settings-loading')).toBeNull();
    });

    return { result, mockHook };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

describe('NotesSettingsSection', () => {
    it('shows loading state while fetching', async () => {
        vi.doMock('../../../../src/server/spa/client/react/features/notes/hooks/useNotesAutoCommit', () => ({
            useNotesAutoCommit: () => ({
                autoCommitEnabled: false,
                intervalMs: null,
                lastCommittedAt: null,
                lastError: null,
                loading: true,
                enabling: false,
                enable: vi.fn(),
                disable: vi.fn(),
                updateInterval: vi.fn(),
            }),
        }));
        vi.doMock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
            notesApi: {
                getGitStatus: vi.fn().mockResolvedValue({ initialized: true }),
            },
        }));
        const { NotesSettingsSection } = await import(
            '../../../../src/server/spa/client/react/features/repo-settings/NotesSettingsSection'
        );
        render(<NotesSettingsSection workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-settings-loading')).toBeTruthy();
    });

    it('shows git-not-initialized hint when git is not set up', async () => {
        await renderSection({ gitInitialized: false });

        expect(screen.getByTestId('notes-git-not-initialized')).toBeTruthy();
        expect(screen.getByTestId('notes-git-init-link')).toBeTruthy();
    });

    it('does not show git-not-initialized hint when git is initialized', async () => {
        await renderSection({ gitInitialized: true });

        expect(screen.queryByTestId('notes-git-not-initialized')).toBeNull();
    });

    it('shows disabled state when auto-commit is off', async () => {
        await renderSection({ gitInitialized: true, autoCommit: { enabled: false } });

        const toggle = screen.getByTestId('auto-commit-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        expect(screen.getByText('Disabled')).toBeTruthy();
    });

    it('shows enabled state with interval dropdown when auto-commit is on', async () => {
        await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: true, intervalMs: 1_800_000 },
        });

        const toggle = screen.getByTestId('auto-commit-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(true);
        expect(screen.getByText('Enabled')).toBeTruthy();
        expect(screen.getByTestId('auto-commit-interval')).toBeTruthy();
    });

    it('hides interval dropdown when auto-commit is disabled', async () => {
        await renderSection({ gitInitialized: true, autoCommit: { enabled: false } });
        expect(screen.queryByTestId('auto-commit-interval')).toBeNull();
    });

    it('calls enable() when toggle is checked', async () => {
        const { mockHook } = await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: false },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('auto-commit-toggle'));
        });

        expect(mockHook.enable).toHaveBeenCalledWith(1_800_000);
    });

    it('calls disable() when toggle is unchecked', async () => {
        const { mockHook } = await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: true, intervalMs: 1_800_000 },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('auto-commit-toggle'));
        });

        expect(mockHook.disable).toHaveBeenCalled();
    });

    it('calls updateInterval() when interval is changed', async () => {
        const { mockHook } = await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: true, intervalMs: 1_800_000 },
        });

        await act(async () => {
            fireEvent.change(screen.getByTestId('auto-commit-interval'), {
                target: { value: '300000' },
            });
        });

        expect(mockHook.updateInterval).toHaveBeenCalledWith(300_000);
    });

    it('shows last-committed timestamp when available', async () => {
        const ts = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
        await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: true, intervalMs: 1_800_000, lastCommittedAt: ts },
        });

        const el = screen.getByTestId('last-committed-at');
        expect(el.textContent).toBeTruthy();
        expect(el.textContent).toContain('ago');
    });

    it('hides last-committed when auto-commit is disabled', async () => {
        await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: false, lastCommittedAt: new Date().toISOString() },
        });

        expect(screen.queryByTestId('last-committed-at')).toBeNull();
    });

    it('shows last error in red when present', async () => {
        await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: true, intervalMs: 300_000, lastError: 'commit failed: nothing to commit' },
        });

        const el = screen.getByTestId('last-error');
        expect(el.textContent).toContain('commit failed');
    });

    it('hides last error when auto-commit is disabled', async () => {
        await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: false, lastError: 'some error' },
        });

        expect(screen.queryByTestId('last-error')).toBeNull();
    });

    it('interval dropdown contains all expected options', async () => {
        await renderSection({
            gitInitialized: true,
            autoCommit: { enabled: true, intervalMs: 60_000 },
        });

        const select = screen.getByTestId('auto-commit-interval') as HTMLSelectElement;
        const values = Array.from(select.options).map(o => Number(o.value));
        expect(values).toEqual([60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]);
    });

    it('notes-settings-section testid is present', async () => {
        await renderSection({ gitInitialized: true });
        expect(screen.getByTestId('notes-settings-section')).toBeTruthy();
    });
});

describe('RepoSettingsTab notes nav item', () => {
    it('shows the Notes nav item', async () => {
        const mockFetchApi = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/mcp-config')) return Promise.resolve({ availableServers: [], enabledMcpServers: null });
            if (url.includes('/skills-config')) return Promise.resolve({ disabledSkills: [], extraSkillFolders: [] });
            if (url.includes('/preferences')) return Promise.resolve({});
            if (url.includes('/processes')) return Promise.resolve({ processes: [] });
            if (url.includes('/instructions')) return Promise.resolve({ base: null, ask: null, plan: null, autopilot: null });
            if (url.includes('/tasks/settings')) return Promise.resolve({ taskRootPath: '/tasks', folderPaths: [] });
            return Promise.resolve({});
        });
        vi.doMock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
            fetchApi: (...args: any[]) => mockFetchApi(...args),
        }));

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }));

        vi.doMock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
            useGlobalToast: () => ({ addToast: vi.fn() }),
        }));
        vi.doMock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
            useRepos: () => ({ repos: [] }),
        }));

        const { RepoSettingsTab } = await import(
            '../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab'
        );
        const { AppProvider } = await import(
            '../../../../src/server/spa/client/react/contexts/AppContext'
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
            expect(screen.getByTestId('nav-item-notes')).toBeTruthy();
        });
        expect(screen.getByTestId('nav-item-notes').textContent).toContain('Notes');
    });
});
