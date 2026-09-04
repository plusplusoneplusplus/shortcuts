/**
 * RepoGroupGitTab — the Git tab remembers which member repo you were on (AC-04).
 *
 * The pick is stored per `group-<slug>` id in the AppContext per-workspace
 * memory and mirrored to localStorage, so it survives both a tab switch (the
 * panel unmounting and coming back) and a full page reload (a fresh module
 * registry re-hydrating from storage). It is only ever a *preference*: an id
 * that has since left the group or gone stale falls back to the first healthy
 * member instead of blowing up.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-repo-git-tab" data-workspace={workspaceId} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/repos/repositoryService', () => ({
    getWorkspaceGitInfoBatch: vi.fn().mockResolvedValue({ results: {} }),
    getWorkspaceGitInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => ({ status: 'open' }),
}));

// AppProvider talks to the preferences API on mount; nothing here cares.
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({}),
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
    }),
}));

import type { RepoGroupMember } from '../../../src/server/spa/client/react/repos/repoGroupService';

const GROUP_ID = 'group-frontend';
const OTHER_GROUP_ID = 'group-backend';
const STORAGE_KEY = 'coc-repo-group-git-member-state';

function member(id: string, overrides: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId: id, name: id, rootPath: `/r/${id}`, ...overrides } as RepoGroupMember;
}

/**
 * Import the tab + provider through a fresh module registry, which is what a
 * page reload actually does: `initialState` re-reads localStorage at module
 * evaluation time, so seeding storage first is the whole point.
 */
async function loadFresh() {
    vi.resetModules();
    const [{ RepoGroupGitTab }, { AppProvider }] = await Promise.all([
        import('../../../src/server/spa/client/react/repos/RepoGroupGitTab'),
        import('../../../src/server/spa/client/react/contexts/AppContext'),
    ]);
    return { RepoGroupGitTab, AppProvider };
}

function selectedMember(): string | null {
    return screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace');
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('RepoGroupGitTab member persistence', () => {
    it('keeps the pick when the tab is left and re-entered, and writes it to storage', async () => {
        const { RepoGroupGitTab, AppProvider } = await loadFresh();
        const members = [member('repo-a'), member('repo-b')];

        // One provider for the whole app; the tab mounts and unmounts under it
        // exactly as it does when the user navigates to another workspace.
        const { rerender } = render(
            <AppProvider><RepoGroupGitTab workspaceId={GROUP_ID} members={members} /></AppProvider>
        );
        fireEvent.click(screen.getByTestId('repo-group-git-member-repo-b'));
        expect(selectedMember()).toBe('repo-b');

        rerender(<AppProvider><div data-testid="elsewhere" /></AppProvider>);
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();

        rerender(
            <AppProvider><RepoGroupGitTab workspaceId={GROUP_ID} members={members} /></AppProvider>
        );
        expect(selectedMember()).toBe('repo-b');
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ [GROUP_ID]: 'repo-b' });
    });

    it('restores the persisted member after a reload', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ [GROUP_ID]: 'repo-b' }));
        const { RepoGroupGitTab, AppProvider } = await loadFresh();

        render(
            <AppProvider>
                <RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />
            </AppProvider>
        );
        expect(selectedMember()).toBe('repo-b');
    });

    it('remembers a different member per group', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ [GROUP_ID]: 'repo-b', [OTHER_GROUP_ID]: 'repo-a' }));
        const { RepoGroupGitTab, AppProvider } = await loadFresh();
        const members = [member('repo-a'), member('repo-b')];

        const { rerender } = render(
            <AppProvider><RepoGroupGitTab workspaceId={GROUP_ID} members={members} /></AppProvider>
        );
        expect(selectedMember()).toBe('repo-b');

        rerender(<AppProvider><RepoGroupGitTab workspaceId={OTHER_GROUP_ID} members={members} /></AppProvider>);
        expect(selectedMember()).toBe('repo-a');
    });

    it('falls back to the first healthy member when the persisted id left the group', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ [GROUP_ID]: 'repo-gone' }));
        const { RepoGroupGitTab, AppProvider } = await loadFresh();

        expect(() => render(
            <AppProvider>
                <RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />
            </AppProvider>
        )).not.toThrow();
        expect(selectedMember()).toBe('repo-a');
    });

    it('falls back to the first healthy member when the persisted one went stale', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ [GROUP_ID]: 'repo-b' }));
        const { RepoGroupGitTab, AppProvider } = await loadFresh();

        render(
            <AppProvider>
                <RepoGroupGitTab
                    workspaceId={GROUP_ID}
                    members={[member('repo-a'), member('repo-b', { stale: true, staleReason: 'path-missing' })]}
                />
            </AppProvider>
        );
        expect(selectedMember()).toBe('repo-a');
    });

    it('ignores a corrupt storage payload instead of throwing', async () => {
        localStorage.setItem(STORAGE_KEY, '{not json');
        const { RepoGroupGitTab, AppProvider } = await loadFresh();

        render(
            <AppProvider>
                <RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />
            </AppProvider>
        );
        expect(selectedMember()).toBe('repo-a');
    });
});
