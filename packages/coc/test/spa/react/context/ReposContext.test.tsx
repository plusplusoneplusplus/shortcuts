/**
 * Tests for ReposContext provider and useRepos hook.
 *
 * ReposContext depends on AppContext, QueueContext, and WebSocket hooks.
 * We mock those dependencies so the context logic can be tested in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock heavy dependencies before importing the context
vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/repos/workflow-api', () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useUnseenActivity', () => ({
    computeUnseenCount: vi.fn(() => 0),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';
import { ReposProvider, useRepos } from '../../../../src/server/spa/client/react/context/ReposContext';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';

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
    const { repos, loading } = useRepos();
    if (loading) return <div data-testid="loading">Loading</div>;
    return (
        <ul>
            {repos.map(r => (
                <li key={r.workspace.id} data-testid={`repo-${r.workspace.id}`}>
                    {r.workspace.name}
                </li>
            ))}
            {repos.length === 0 && <li data-testid="empty">empty</li>}
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
});
