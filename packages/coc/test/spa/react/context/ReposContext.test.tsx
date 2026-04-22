/**
 * Tests for ReposContext provider and useRepos hook.
 *
 * ReposContext depends on AppContext, QueueContext, and WebSocket hooks.
 * We mock those dependencies so the context logic can be tested in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useRef, useLayoutEffect, type ReactNode } from 'react';

// Mock heavy dependencies before importing the context
vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/features/workflow/workflow-api', () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat', () => ({
    computeUnseenCount: vi.fn(() => 0),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';
import { ReposProvider, useRepos } from '../../../../src/server/spa/client/react/contexts/ReposContext';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';

afterEach(() => {
    vi.clearAllMocks();
});

const makeWorkspace = (id: string, name = id) => ({
    id,
    name,
    rootPath: `/repos/${id}`,
    virtual: false,
});

function makeWorkspacesResponse(workspaces: any[]) {
    return { workspaces };
}

function Wrapper({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                {children}
            </QueueProvider>
        </AppProvider>
    );
}

function ReposConsumer() {
    const { repos, loading, refreshUnseenCounts } = useRepos();
    if (loading) return <div data-testid="loading">Loading</div>;
    return (
        <ul>
            {repos.map(r => (
                <li key={r.workspace.id} data-testid={`repo-${r.workspace.id}`}>
                    {r.workspace.name}
                </li>
            ))}
            {repos.length === 0 && <li data-testid="empty">empty</li>}
            <li data-testid="has-refresh">{typeof refreshUnseenCounts}</li>
        </ul>
    );
}

function ProviderWithConsumer() {
    return (
        <Wrapper>
            <ReposProvider>
                <ReposConsumer />
            </ReposProvider>
        </Wrapper>
    );
}

/**
 * Helper that pre-selects a repo via dispatch before ReposProvider mounts,
 * then renders ReposConsumer showing the current selectedRepoId.
 */
function ProviderWithPreselectedRepo({ repoId }: { repoId: string }) {
    return (
        <Wrapper>
            <PreSelector repoId={repoId}>
                <ReposProvider>
                    <SelectedRepoConsumer />
                </ReposProvider>
            </PreSelector>
        </Wrapper>
    );
}

function PreSelector({ repoId, children }: { repoId: string; children: ReactNode }) {
    const { dispatch } = useApp();
    const dispatched = useRef(false);
    useLayoutEffect(() => {
        if (!dispatched.current) {
            dispatched.current = true;
            dispatch({ type: 'SET_SELECTED_REPO', id: repoId });
        }
    }, [repoId, dispatch]);
    return <>{children}</>;
}

function SelectedRepoConsumer() {
    const { repos, loading } = useRepos();
    const { state } = useApp();
    return (
        <div>
            <div data-testid="selected-repo">{state.selectedRepoId ?? 'none'}</div>
            <div data-testid="repo-loading">{String(loading)}</div>
            {repos.map(r => (
                <div key={r.workspace.id} data-testid={`repo-${r.workspace.id}`}>{r.workspace.name}</div>
            ))}
        </div>
    );
}

describe('ReposContext', () => {
    it('throws when useRepos is used outside ReposProvider', () => {
        // Suppress React error boundary console noise
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => {
            render(
                <Wrapper>
                    <ReposConsumer />
                </Wrapper>
            );
        }).toThrow('useRepos must be used within ReposProvider');
        spy.mockRestore();
    });

    it('starts in loading state', () => {
        (fetchApi as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
        render(<ProviderWithConsumer />);
        expect(screen.getByTestId('loading')).toBeTruthy();
    });

    it('fetches and provides repo list on mount', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('ws-1', 'Repo One')])) // /workspaces
            .mockResolvedValue(null); // subsequent calls (workflows, tasks, processes, queue)

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-ws-1')).toBeTruthy();
        });
        expect(screen.getByText('Repo One')).toBeTruthy();
    });

    it('fetches a single global /processes/summaries instead of per-workspace calls', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('ws-1')])) // /workspaces
            .mockResolvedValue(null); // subsequent calls

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-ws-1')).toBeTruthy();
        });

        const calls = (fetchApi as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        const processCalls = calls.filter((url: string) => url?.includes('/processes'));
        expect(processCalls.length).toBe(1);
        expect(processCalls[0]).toBe('/processes/summaries?limit=5000');
        // No per-workspace process calls
        expect(processCalls.some((url: string) => url?.includes('workspace='))).toBe(false);
    });

    it('shows empty list when workspaces API returns empty array', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([]))
            .mockResolvedValue(null);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('empty')).toBeTruthy();
        });
    });

    it('handles fetch error gracefully (empty repo list)', async () => {
        (fetchApi as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network fail'));
        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('empty')).toBeTruthy();
        });
    });

    it('excludes virtual workspaces from repo list', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('real-ws'),
                { ...makeWorkspace('virtual-ws'), virtual: true },
            ]))
            .mockResolvedValue(null);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-real-ws')).toBeTruthy();
        });
        expect(screen.queryByTestId('repo-virtual-ws')).toBeNull();
    });

    it('exposes refreshUnseenCounts as a function', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('ws-1')]))
            .mockResolvedValue(null);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-ws-1')).toBeTruthy();
        });
        expect(screen.getByTestId('has-refresh').textContent).toBe('function');
    });

    it('does not deselect a virtual workspace (e.g. my_work) on refresh', async () => {
        // Regression: fetchRepos() used to check the filtered `enriched` list
        // (which excludes virtual workspaces) to decide whether to clear selection.
        // Virtual workspaces like my_work were never in that list, so every
        // refresh would dispatch SET_SELECTED_REPO(null).
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('real-ws'),
                { ...makeWorkspace('my_work', 'My Work'), virtual: true },
            ]))
            .mockResolvedValue(null);

        render(<ProviderWithPreselectedRepo repoId="my_work" />);

        // Wait for repos to load
        await waitFor(() => {
            expect(screen.getByTestId('repo-loading').textContent).toBe('false');
        });

        // The virtual workspace should still be selected
        expect(screen.getByTestId('selected-repo').textContent).toBe('my_work');
    });

    it('clears selection when a non-virtual repo is removed', async () => {
        // The guard should still clear selection for repos that genuinely disappear
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('remaining-ws'),
                // 'removed-ws' is NOT in the response — it was unregistered
            ]))
            .mockResolvedValue(null);

        render(<ProviderWithPreselectedRepo repoId="removed-ws" />);

        await waitFor(() => {
            expect(screen.getByTestId('repo-loading').textContent).toBe('false');
        });

        // Selection should have been cleared because 'removed-ws' is gone
        expect(screen.getByTestId('selected-repo').textContent).toBe('none');
    });
});
