/**
 * Regression test: ReposGrid.selectRepo must dispatch SET_CURRENT_AGENT
 * when clicking a repo that belongs to a specific agent in container mode.
 *
 * Previously, only the desktop RepoTabStrip set the agent on repo selection.
 * ReposGrid (used on mobile) just dispatched SET_SELECTED_REPO without the
 * agent, causing the wrong agent to be selected when two agents share a repo
 * with the same workspace ID (same repo name).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────

const mockAppDispatch = vi.fn();
const mockQueueDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    SHOW_WELCOME_TUTORIAL: false,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            selectedRepoId: null,
            activeTab: 'repos',
            repoTabState: {},
        },
        dispatch: mockAppDispatch,
    }),
    AppProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskId: null, selectedTaskIdByRepo: {}, repoQueueMap: {} },
        dispatch: mockQueueDispatch,
    }),
    QueueProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ContainerAgentContext', () => ({
    useContainerAgents: () => ({
        agents: [
            { id: 'agent-1', name: 'Agent One', address: 'http://localhost:4001', status: 'online' },
            { id: 'agent-2', name: 'Agent Two', address: 'http://localhost:4002', status: 'online' },
        ],
        loading: false,
        refresh: vi.fn(),
        addAgent: vi.fn(),
        removeAgent: vi.fn(),
        renameAgent: vi.fn(),
        updateAgent: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => true,
    getRawApiBase: () => '',
    getApiBase: () => '',
    getHostname: () => 'localhost',
    isServersEnabled: () => false,
    isContainerDefaultAgentEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    browseWorkspaceFolders: vi.fn().mockResolvedValue({ path: '', parent: null, entries: [] }),
    cloneRepository: vi.fn().mockResolvedValue({ clonedPath: '/repo' }),
    getGlobalPreferences: vi.fn().mockResolvedValue({}),
    getRepositoryApiErrorMessage: vi.fn((error: unknown, fallback: string) => {
        if (error instanceof Error && error.message) return error.message;
        return fallback;
    }),
    registerWorkspace: vi.fn().mockResolvedValue({}),
    updateGlobalPreferences: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }),
    ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import { ReposGrid } from '../../../../src/server/spa/client/react/repos/ReposGrid';
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeRepo(id: string, name: string, agentId: string): RepoData {
    return {
        workspace: {
            id,
            name,
            path: `/home/user/${name}`,
            agentId,
            remoteUrl: `https://github.com/org/${name}`,
        },
        gitInfo: { isGitRepo: true, branch: 'main', dirty: false },
        gitInfoLoading: false,
        workflows: [],
        stats: { success: 0, failed: 0, running: 0 },
        taskCount: 0,
    } as any;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ReposGrid — container mode agent switching on repo select', () => {
    beforeEach(() => {
        location.hash = '';
        mockAppDispatch.mockClear();
        mockQueueDispatch.mockClear();
    });

    afterEach(() => {
        location.hash = '';
        vi.clearAllMocks();
    });

    it('dispatches SET_CURRENT_AGENT before SET_SELECTED_REPO when repo has agentId', () => {
        const repos: RepoData[] = [
            makeRepo('ws-same-name', 'my-repo', 'agent-1'),
            makeRepo('ws-same-name', 'my-repo', 'agent-2'),
        ];

        render(<ReposGrid repos={repos} onRefresh={vi.fn()} />);

        // Find one of the repo cards and click it
        const cards = screen.getAllByText('my-repo');
        expect(cards.length).toBeGreaterThanOrEqual(1);
        fireEvent.click(cards[0]);

        // Verify SET_CURRENT_AGENT was dispatched with the correct agentId
        const agentAction = mockAppDispatch.mock.calls.find(
            ([action]: any) => action.type === 'SET_CURRENT_AGENT'
        );
        expect(agentAction).toBeDefined();
        expect(agentAction![0].agentId).toMatch(/^agent-/);

        // Verify SET_SELECTED_REPO was also dispatched
        const repoAction = mockAppDispatch.mock.calls.find(
            ([action]: any) => action.type === 'SET_SELECTED_REPO'
        );
        expect(repoAction).toBeDefined();
        expect(repoAction![0].id).toBe('ws-same-name');

        // Verify SET_CURRENT_AGENT comes before SET_SELECTED_REPO
        const agentIdx = mockAppDispatch.mock.calls.findIndex(
            ([action]: any) => action.type === 'SET_CURRENT_AGENT'
        );
        const repoIdx = mockAppDispatch.mock.calls.findIndex(
            ([action]: any) => action.type === 'SET_SELECTED_REPO'
        );
        expect(agentIdx).toBeLessThan(repoIdx);
    });

    it('does not dispatch SET_CURRENT_AGENT when repo has no agentId', () => {
        const repos: RepoData[] = [
            makeRepo('ws-local', 'local-repo', ''),
        ];

        render(<ReposGrid repos={repos} onRefresh={vi.fn()} />);

        const card = screen.getByText('local-repo');
        fireEvent.click(card);

        const agentAction = mockAppDispatch.mock.calls.find(
            ([action]: any) => action.type === 'SET_CURRENT_AGENT'
        );
        expect(agentAction).toBeUndefined();

        // SET_SELECTED_REPO should still be dispatched
        const repoAction = mockAppDispatch.mock.calls.find(
            ([action]: any) => action.type === 'SET_SELECTED_REPO'
        );
        expect(repoAction).toBeDefined();
    });
});
