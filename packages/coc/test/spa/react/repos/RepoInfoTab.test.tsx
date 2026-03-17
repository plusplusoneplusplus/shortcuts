/**
 * Tests for RepoInfoTab — preferences section rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

// fetchApi mock
const mockFetchApi = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
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
        '../../../../src/server/spa/client/react/repos/RepoInfoTab'
    );
    return render(<RepoInfoTab repo={repo as any} />);
}

// Default: processes returns empty, preferences returns {}
beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/preferences')) return Promise.resolve({});
        return Promise.resolve({ processes: [] });
    });
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
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return new Promise((r) => { resolve = r; });
            return Promise.resolve({ processes: [] });
        });

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
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return Promise.resolve({});
            return Promise.resolve({ processes: [] });
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('No preferences set')).toBeTruthy());
    });

    it('shows "No preferences set" when all preference fields are empty strings', async () => {
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return Promise.resolve({ lastModel: '', lastSkills: {} });
            return Promise.resolve({ processes: [] });
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('No preferences set')).toBeTruthy());
    });
});

// ── 4. Populated state ───────────────────────────────────────────────────────

describe('populated preferences', () => {
    it('renders model, depth, effort, skill values', async () => {
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return Promise.resolve({
                lastModels: { task: 'gpt-4o', ask: 'claude-3' },
                lastDepth: 'deep',
                lastEffort: 'high',
                lastSkills: { task: 'my-skill', ask: 'go-deep' },
            });
            return Promise.resolve({ processes: [] });
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('gpt-4o')).toBeTruthy());

        expect(screen.getByText('claude-3')).toBeTruthy();
        expect(screen.getByText('deep')).toBeTruthy();
        expect(screen.getByText('high')).toBeTruthy();
        expect(screen.getByText('my-skill')).toBeTruthy();
        expect(screen.getByText('go-deep')).toBeTruthy();
    });

    it('renders recentFollowPrompts as cards with count in section header', async () => {
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return Promise.resolve({
                lastModel: 'claude',
                recentFollowPrompts: [
                    { type: 'prompt', name: 'p1', timestamp: Date.now() - 60_000, prompt: 'First prompt', mode: 'ask', model: 'gpt-4o', skills: ['impl'] },
                    { type: 'skill', name: 'p2', timestamp: Date.now() - 3_600_000, mode: 'task' },
                ],
            });
            return Promise.resolve({ processes: [] });
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Recent Prompts (2)')).toBeTruthy());

        // Each prompt rendered as a card
        const cards = screen.getAllByTestId('recent-prompt-card');
        expect(cards.length).toBe(2);

        // Prompt text clamp and skill chip
        expect(screen.getByText('First prompt')).toBeTruthy();
        expect(screen.getByText('impl')).toBeTruthy();

        // Mode badges
        expect(screen.getByText('ask')).toBeTruthy();
        expect(screen.getByText('task')).toBeTruthy();
    });

    it('does not render recent prompts section when recentFollowPrompts is empty', async () => {
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return Promise.resolve({
                lastModel: 'claude',
                recentFollowPrompts: [],
            });
            return Promise.resolve({ processes: [] });
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByTestId('recent-prompt-card')).toBeNull());
        expect(screen.queryByText(/Recent Prompts \(/)).toBeNull();
    });

    it('fetches from correct workspace endpoint', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('No preferences set')).toBeTruthy());

        const prefCalls = mockFetchApi.mock.calls.filter((c: any[]) =>
            (c[0] as string).includes('/preferences')
        );
        expect(prefCalls.length).toBeGreaterThan(0);
        expect(prefCalls[0][0]).toContain('ws-1');
    });
});

// ── 5. Error state ───────────────────────────────────────────────────────────

describe('error state', () => {
    it('shows error message when preferences fetch fails', async () => {
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/preferences')) return Promise.reject(new Error('Network error'));
            return Promise.resolve({ processes: [] });
        });

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
    });
});
