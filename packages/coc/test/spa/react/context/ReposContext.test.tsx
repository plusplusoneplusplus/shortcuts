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
vi.mock('../../../../src/server/spa/client/react/features/workflow/workflow-api', () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat', () => ({
    computeUnseenCount: vi.fn(() => 0),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/seenStateApi', () => ({
    fetchUnseenCount: vi.fn().mockResolvedValue(0),
}));

const repositoryServiceMocks = vi.hoisted(() => ({
    getWorkspaceGitInfo: vi.fn(),
    getWorkspaceGitInfoBatch: vi.fn(),
    getWorkspaceSummary: vi.fn(),
    listProcessSummaries: vi.fn(),
    listQueueRepos: vi.fn(),
    listWorkspaces: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

// Stub only aggregateRemoteWorkspaces so the test controls the remote workspaces
// deterministically (no live remote servers). The real isRemoteWorkspace /
// tagRemoteWorkspaces are preserved — ReposContext's AC-08 write/restore logic
// relies on the genuine remote marker shape.
const aggregateRemoteWorkspacesMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation')>();
    return { ...actual, aggregateRemoteWorkspaces: aggregateRemoteWorkspacesMock };
});

import { ReposProvider, useRepos } from '../../../../src/server/spa/client/react/contexts/ReposContext';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { tagRemoteWorkspaces, type AggregatedRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import {
    _resetRemoteSelectionForTests,
    loadPersistedRemoteSelection,
    persistRemoteSelection,
} from '../../../../src/server/spa/client/react/repos/remoteSelectionPersistence';
import {
    _resetLocalWorkspaceForTests,
    loadPersistedLocalWorkspaceSelection,
    persistLocalWorkspaceSelection,
} from '../../../../src/server/spa/client/react/repos/lastLocalWorkspacePersistence';
import {
    buildRemoteCloneKey,
    legacyPathOnlyWorkspaceIdForRootPath,
} from '../../../../src/server/spa/client/react/repos/cloneIdentity';

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

function emptyAggregate(): AggregatedRemoteWorkspaces {
    return { sources: [], workspaces: [], gitInfo: {}, warnings: [] };
}

/**
 * Build an aggregate with a single online remote workspace, tagged with the real
 * marker. `baseUrl` is varied across "reloads" to exercise port reassignment.
 */
function remoteAggregate(serverId: string, baseUrl: string, wsId: string, wsName = wsId): AggregatedRemoteWorkspaces {
    const tagged = tagRemoteWorkspaces(
        { id: serverId, label: serverId },
        baseUrl,
        [{ id: wsId, name: wsName, rootPath: `/repos/${wsId}` }],
        false,
        { connection: 'online' },
    );
    return { sources: [], workspaces: tagged, gitInfo: {}, warnings: [] };
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
            <div data-testid="last-workspace">{state.lastWorkspaceRepoId ?? 'none'}</div>
            <div data-testid="repo-loading">{String(loading)}</div>
            {repos.map(r => (
                <div key={r.workspace.id} data-testid={`repo-${r.workspace.id}`}>{r.workspace.name}</div>
            ))}
        </div>
    );
}

describe('ReposContext', () => {
    beforeEach(() => {
        repositoryServiceMocks.listWorkspaces.mockResolvedValue([]);
        repositoryServiceMocks.listProcessSummaries.mockResolvedValue({ summaries: [], total: 0, limit: 5000, offset: 0 });
        repositoryServiceMocks.getWorkspaceSummary.mockResolvedValue({ workflows: [], tasks: null });
        repositoryServiceMocks.getWorkspaceGitInfoBatch.mockResolvedValue({ results: {} });
        repositoryServiceMocks.getWorkspaceGitInfo.mockResolvedValue({ branch: null, dirty: false, isGitRepo: false, remoteUrl: null });
        repositoryServiceMocks.listQueueRepos.mockResolvedValue({ repos: [] });
        // Default: no remote workspaces (classic flow). Overridden per AC-08 test.
        aggregateRemoteWorkspacesMock.mockResolvedValue(emptyAggregate());
        _resetRemoteSelectionForTests();
        _resetLocalWorkspaceForTests();
        window.history.replaceState(null, '', '/');
    });

    afterEach(() => {
        _resetRemoteSelectionForTests();
        _resetLocalWorkspaceForTests();
        window.history.replaceState(null, '', '/');
    });

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
        repositoryServiceMocks.listWorkspaces.mockReturnValue(new Promise(() => {}));
        render(<ProviderWithConsumer />);
        expect(screen.getByTestId('loading')).toBeTruthy();
    });

    it('fetches and provides repo list on mount', async () => {
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('ws-1', 'Repo One')]).workspaces);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-ws-1')).toBeTruthy();
        });
        expect(screen.getByText('Repo One')).toBeTruthy();
    });

    it('fetches a single global /processes/summaries instead of per-workspace calls', async () => {
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('ws-1')]).workspaces);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-ws-1')).toBeTruthy();
        });

        expect(repositoryServiceMocks.listProcessSummaries).toHaveBeenCalledTimes(1);
        expect(repositoryServiceMocks.listProcessSummaries).toHaveBeenCalledWith(5000);
    });

    it('shows empty list when workspaces API returns empty array', async () => {
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([]).workspaces);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('empty')).toBeTruthy();
        });
    });

    it('handles fetch error gracefully (empty repo list)', async () => {
        repositoryServiceMocks.listWorkspaces.mockRejectedValueOnce(new Error('Network fail'));
        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('empty')).toBeTruthy();
        });
    });

    it('excludes virtual workspaces from repo list', async () => {
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('real-ws'),
                { ...makeWorkspace('virtual-ws'), virtual: true },
            ]).workspaces);

        render(<ProviderWithConsumer />);
        await waitFor(() => {
            expect(screen.getByTestId('repo-real-ws')).toBeTruthy();
        });
        expect(screen.queryByTestId('repo-virtual-ws')).toBeNull();
    });

    it('exposes refreshUnseenCounts as a function', async () => {
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('ws-1')]).workspaces);

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
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('real-ws'),
                { ...makeWorkspace('my_work', 'My Work'), virtual: true },
            ]).workspaces);

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
        repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('remaining-ws'),
                // 'removed-ws' is NOT in the response — it was unregistered
            ]).workspaces);

        render(<ProviderWithPreselectedRepo repoId="removed-ws" />);

        await waitFor(() => {
            expect(screen.getByTestId('repo-loading').textContent).toBe('false');
        });

        // Selection should have been cleared because 'removed-ws' is gone
        expect(screen.getByTestId('selected-repo').textContent).toBe('none');
    });

    // ── AC-08: remote-clone selection persistence across reload ──────────────
    describe('remote-clone selection persistence (AC-08)', () => {
        const remoteSelectionId = buildRemoteCloneKey('srv-1', 'remote-ws');

        it('restores the persisted remote clone once aggregation completes (cold reload, no hash)', async () => {
            // Simulate a prior session having selected the remote clone.
            persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            // Reload: local workspaces load first; the remote clone appears only
            // after aggregateRemoteWorkspaces resolves.
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:4000', 'remote-ws'));

            // No pre-selection (nothing set the hash) — restore must drive it.
            render(
                <Wrapper>
                    <ReposProvider>
                        <SelectedRepoConsumer />
                    </ReposProvider>
                </Wrapper>
            );

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe(remoteSelectionId);
            });
            // The remote workspace is present in the merged list.
            expect(screen.getByTestId('repo-remote-ws')).toBeTruthy();
        });

        it('restores via serverId after devtunnel PORT REASSIGNMENT (baseUrl differs on reload)', async () => {
            // Persisted at :4000; on reload the SAME server is forwarded at :9999.
            persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:9999', 'remote-ws'));

            render(
                <Wrapper>
                    <ReposProvider>
                        <SelectedRepoConsumer />
                    </ReposProvider>
                </Wrapper>
            );

            // Resolved purely via the stable serverId — the changed baseUrl/port
            // does not prevent restoration.
            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe(remoteSelectionId);
            });
        });

        it('keeps a hash-restored remote selection (id matches the persisted pair)', async () => {
            // Cold load where the hash DID set the remote id (via Router); restore
            // confirms it via serverId and leaves it selected (idempotent).
            persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:4000', 'remote-ws'));

            render(<ProviderWithPreselectedRepo repoId={remoteSelectionId} />);

            await waitFor(() => {
                expect(screen.getByTestId('repo-loading').textContent).toBe('false');
            });
            expect(screen.getByTestId('selected-repo').textContent).toBe(remoteSelectionId);
        });

        it('does not hijack an unrelated active local selection', async () => {
            // A remote clone is persisted, but on this load the user is on a local
            // repo. Restore must NOT yank them to the remote clone.
            persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:4000', 'remote-ws'));

            render(<ProviderWithPreselectedRepo repoId="local-1" />);

            await waitFor(() => {
                expect(screen.getByTestId('repo-loading').textContent).toBe('false');
            });
            // Stays on the local repo the user is actually viewing.
            expect(screen.getByTestId('selected-repo').textContent).toBe('local-1');
        });

        it('selecting a LOCAL clone clears any persisted remote pair (local unchanged)', async () => {
            // Stale remote pair from before; the active selection is local. The
            // write effect drops the remote pair so a later reload won't resurrect it.
            persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            // No remote workspace this time (server gone) so local-1 is the only repo.
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(emptyAggregate());

            render(<ProviderWithPreselectedRepo repoId="local-1" />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe('local-1');
            });
            await waitFor(() => {
                expect(loadPersistedRemoteSelection()).toBeNull();
            });
        });

        it('persists the { serverId, workspaceId } pair when a remote clone is selected', async () => {
            // Remote clone present and selected → the stable pair is written.
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:4000', 'remote-ws'));

            render(<ProviderWithPreselectedRepo repoId={remoteSelectionId} />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe(remoteSelectionId);
            });
            await waitFor(() => {
                expect(loadPersistedRemoteSelection()).toEqual({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            });
        });
    });

    // ── AC-03: last-active workspace persistence + cold-load seeding ─────────
    // The scope switcher must keep showing (and switch back to) the last-active
    // workspace after a reload that lands on a virtual scope — for LOCAL folders
    // (new here) as well as remote clones (already covered by AC-08 above).
    describe('last-active workspace persistence (AC-03)', () => {
        it('persists a LOCAL workspace id when it is selected', async () => {
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);

            render(<ProviderWithPreselectedRepo repoId="local-1" />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe('local-1');
            });
            await waitFor(() => {
                expect(loadPersistedLocalWorkspaceSelection()).toBe('local-1');
            });
        });

        it('selecting a remote clone clears the stale LOCAL last-active key (mutual exclusivity)', async () => {
            const remoteSelectionId = buildRemoteCloneKey('srv-1', 'remote-ws');
            // A local folder was the last-active workspace before this session.
            persistLocalWorkspaceSelection('local-old');
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([makeWorkspace('local-1')]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:4000', 'remote-ws'));

            render(<ProviderWithPreselectedRepo repoId={remoteSelectionId} />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe(remoteSelectionId);
            });
            // The remote pair is now the last-active hint; the local key is dropped.
            await waitFor(() => {
                expect(loadPersistedLocalWorkspaceSelection()).toBeNull();
            });
        });

        it('seeds lastWorkspaceRepoId from a persisted LOCAL id when reload lands on a virtual scope', async () => {
            // Prior session ended on local-1; reload lands on My Work (virtual).
            persistLocalWorkspaceSelection('local-1');
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('local-1'),
                { ...makeWorkspace('my_work', 'My Work'), virtual: true },
            ]).workspaces);

            render(<ProviderWithPreselectedRepo repoId="my_work" />);

            await waitFor(() => {
                expect(screen.getByTestId('repo-loading').textContent).toBe('false');
            });
            // Active scope stays virtual (display-only restore) …
            expect(screen.getByTestId('selected-repo').textContent).toBe('my_work');
            // … while the remembered workspace is seeded for the switcher.
            await waitFor(() => {
                expect(screen.getByTestId('last-workspace').textContent).toBe('local-1');
            });
        });

        it('seeds lastWorkspaceRepoId from a persisted REMOTE pair when reload lands on a virtual scope', async () => {
            const remoteSelectionId = buildRemoteCloneKey('srv-1', 'remote-ws');
            persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'remote-ws' });
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('local-1'),
                { ...makeWorkspace('my_work', 'My Work'), virtual: true },
            ]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce(remoteAggregate('srv-1', 'http://127.0.0.1:4000', 'remote-ws'));

            render(<ProviderWithPreselectedRepo repoId="my_work" />);

            await waitFor(() => {
                expect(screen.getByTestId('repo-loading').textContent).toBe('false');
            });
            expect(screen.getByTestId('selected-repo').textContent).toBe('my_work');
            await waitFor(() => {
                expect(screen.getByTestId('last-workspace').textContent).toBe(remoteSelectionId);
            });
        });

        it('does not seed a stale workspace over an active concrete selection', async () => {
            // local-old was persisted, but this load is actively on local-1 → the
            // active selection wins and remains the remembered workspace.
            persistLocalWorkspaceSelection('local-old');
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([
                makeWorkspace('local-1'),
                makeWorkspace('local-old'),
            ]).workspaces);

            render(<ProviderWithPreselectedRepo repoId="local-1" />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe('local-1');
            });
            expect(screen.getByTestId('last-workspace').textContent).toBe('local-1');
        });
    });

    describe('legacy path-only repo deep links', () => {
        it('resolves an old path-only hash to the migrated local workspace and preserves the suffix', async () => {
            const rootPath = '/repos/shared-path';
            const legacyId = legacyPathOnlyWorkspaceIdForRootPath(rootPath);
            const migrated = { ...makeWorkspace('ws-v2-local', 'Migrated Local'), rootPath };
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([migrated]).workspaces);
            location.hash = '#repos/' + encodeURIComponent(legacyId) + '/git';

            render(<ProviderWithPreselectedRepo repoId={legacyId} />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe('ws-v2-local');
            });
            expect(location.hash).toBe('#repos/ws-v2-local/git');
        });

        it('resolves an old path-only hash to the single matching remote clone key', async () => {
            const rootPath = '/repos/remote-shared-path';
            const legacyId = legacyPathOnlyWorkspaceIdForRootPath(rootPath);
            const expectedSelectionId = buildRemoteCloneKey('srv-1', 'ws-v2-remote');
            const tagged = tagRemoteWorkspaces(
                { id: 'srv-1', label: 'srv-1' },
                'http://127.0.0.1:4000',
                [{ id: 'ws-v2-remote', name: 'Remote Migrated', rootPath }],
                false,
                { connection: 'online' },
            );
            repositoryServiceMocks.listWorkspaces.mockResolvedValueOnce(makeWorkspacesResponse([]).workspaces);
            aggregateRemoteWorkspacesMock.mockResolvedValueOnce({ sources: [], workspaces: tagged, gitInfo: {}, warnings: [] });
            location.hash = '#repos/' + encodeURIComponent(legacyId) + '/chats';

            render(<ProviderWithPreselectedRepo repoId={legacyId} />);

            await waitFor(() => {
                expect(screen.getByTestId('selected-repo').textContent).toBe(expectedSelectionId);
            });
            expect(location.hash).toBe('#repos/' + encodeURIComponent(expectedSelectionId) + '/chats');
        });
    });
});
