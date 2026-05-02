/**
 * Tests for RepoInfoTab — preferences section rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const mockClient = vi.hoisted(() => ({
    processes: {
        list: vi.fn(),
    },
    preferences: {
        getTaskSettings: vi.fn(),
        getRepo: vi.fn(),
    },
    workspaces: {
        update: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: () => '1m ago',
}));

const baseRepo = {
    workspace: { id: 'ws-1', rootPath: '/home/user/project' },
    gitInfo: { branch: 'main', dirty: false, isGitRepo: true, ahead: 0, behind: 0 },
    stats: { success: 3, failed: 1, running: 0 },
    pipelines: [],
    taskCount: 5,
};

async function renderTab(repo = baseRepo) {
    const { RepoInfoTab } = await import(
        '../../../../src/server/spa/client/react/features/repo-detail/RepoInfoTab'
    );
    return render(<RepoInfoTab repo={repo as any} />);
}

// Default: processes returns empty, preferences returns {}
beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockClient.processes.list.mockResolvedValue({ processes: [] });
    mockClient.preferences.getTaskSettings.mockResolvedValue({});
    mockClient.preferences.getRepo.mockResolvedValue({});
    mockClient.workspaces.update.mockResolvedValue({});
});

// ── 1. Preferences section heading always renders ───────────────────────────

describe('preferences heading', () => {
    it('renders "Preferences" heading', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.getByText('Preferences')).toBeTruthy();
    });
});

// ── 2. Loading state ─────────────────────────────────────────────────────────

describe('loading state', () => {
    it('shows Loading... while preferences are pending', async () => {
        let resolve: (v: any) => void;
        mockClient.preferences.getRepo.mockReturnValue(new Promise((r) => { resolve = r; }));

        await act(async () => { await renderTab(); });

        // At least one "Loading..." should be visible (preferences section)
        expect(screen.getAllByText('Loading...').length).toBeGreaterThan(0);

        // Resolve to avoid unhandled rejection
        await act(async () => { resolve!({}); });
    });
});

// ── 3. Empty state ───────────────────────────────────────────────────────────

describe('empty preferences', () => {
    it('shows "No preferences set" when API returns {}', async () => {
        mockClient.preferences.getRepo.mockResolvedValue({});

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('No preferences set')).toBeTruthy());
    });

    it('shows "No preferences set" when all preference fields are empty strings', async () => {
        mockClient.preferences.getRepo.mockResolvedValue({ lastModel: '', lastSkills: {} });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('No preferences set')).toBeTruthy());
    });
});

// ── 4. Populated state ───────────────────────────────────────────────────────

describe('populated preferences', () => {
    it('renders model, depth, effort, skill values', async () => {
        mockClient.preferences.getRepo.mockResolvedValue({
            lastModels: { task: 'gpt-4o', ask: 'claude-3' },
            lastDepth: 'deep',
            lastEffort: 'high',
            lastSkills: { task: 'my-skill', ask: 'go-deep' },
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('gpt-4o')).toBeTruthy());

        expect(screen.getByText('claude-3')).toBeTruthy();
        expect(screen.getByText('deep')).toBeTruthy();
        expect(screen.getByText('high')).toBeTruthy();
        expect(screen.getByText('my-skill')).toBeTruthy();
        expect(screen.getByText('go-deep')).toBeTruthy();
    });

    it('fetches from correct workspace endpoint', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('No preferences set')).toBeTruthy());

        expect(mockClient.preferences.getRepo).toHaveBeenCalledWith('ws-1');
    });
});

// ── 5. Error state ───────────────────────────────────────────────────────────

describe('error state', () => {
    it('shows error message when preferences fetch fails', async () => {
        mockClient.preferences.getRepo.mockRejectedValue(new Error('Network error'));

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
    });
});

// ── 6. Non-git repo hides branch/sync rows ──────────────────────────────────

describe('non-git repo display', () => {
    const nonGitRepo = {
        ...baseRepo,
        gitInfo: { branch: null, dirty: false, isGitRepo: false, ahead: 0, behind: 0 },
    };

    it('hides Branch row for non-git repos', async () => {
        await act(async () => { await renderTab(nonGitRepo); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.queryByText('Branch')).toBeNull();
    });

    it('hides Sync row for non-git repos', async () => {
        await act(async () => { await renderTab(nonGitRepo); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.queryByText('Sync')).toBeNull();
    });

    it('shows "Not a git repository" indicator', async () => {
        await act(async () => { await renderTab(nonGitRepo); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.getByText('Not a git repository')).toBeTruthy();
    });

    it('still shows Branch/Sync for git repos', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.getByText('Branch')).toBeTruthy();
        expect(screen.getByText('Sync')).toBeTruthy();
    });
});

// ── 7. Non-git repo with undefined gitInfo ───────────────────────────────────

describe('undefined gitInfo display', () => {
    const undefinedGitInfoRepo = {
        ...baseRepo,
        gitInfo: undefined,
    };

    it('hides Branch row when gitInfo is undefined', async () => {
        await act(async () => { await renderTab(undefinedGitInfoRepo); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.queryByText('Branch')).toBeNull();
    });

    it('shows "Not a git repository" when gitInfo is undefined', async () => {
        await act(async () => { await renderTab(undefinedGitInfoRepo); });
        await waitFor(() => expect(screen.queryAllByText('Loading...').length).toBe(0));
        expect(screen.getByText('Not a git repository')).toBeTruthy();
    });
});
