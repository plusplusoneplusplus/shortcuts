/**
 * RepoGroupGitTab — the group owns the page, a member owns the git data.
 *
 * Opening a member's commit used to write `#repos/{memberId}/git/{sha}`, which
 * silently swapped the selected workspace from the GROUP to the member. These
 * tests drive the host through the REAL route registry (`resolveDashboardRoute`
 * + `applyRouteEffects`, the exact pair `Router` uses) so the URL contract, the
 * member/preference precedence and the unavailable-member behaviour are all
 * exercised end to end, with only the git panel itself stubbed.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

// The panel itself is covered by the RepoGitTab family; what matters here is
// which ids it is handed and whether it is mounted at all.
const panelProps: Record<string, unknown>[] = [];
vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: (props: { workspaceId: string; routeWorkspaceId?: string; repositorySelector?: ReactNode }) => {
        panelProps.push(props);
        return (
            <div
                data-testid="stub-repo-git-tab"
                data-workspace={props.workspaceId}
                data-route-workspace={props.routeWorkspaceId ?? ''}
            >
                {props.repositorySelector}
            </div>
        );
    },
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

import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { RepoGroupGitTab } from '../../../src/server/spa/client/react/repos/RepoGroupGitTab';
import {
    applyRouteEffects,
    resolveDashboardRoute,
    type RouteContext,
} from '../../../src/server/spa/client/react/layout/dashboardRoutes';
import type { RepoGroupMember } from '../../../src/server/spa/client/react/repos/repoGroupService';

const GROUP = 'group-frontend';
const OTHER_GROUP = 'group-backend';
const MEMBER_STATE_KEY = 'coc-repo-group-git-member-state';

function member(id: string, overrides: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId: id, name: id, rootPath: `/r/${id}`, ...overrides } as RepoGroupMember;
}

/**
 * The routing half of `Router`, without its view tree: resolve `location.hash`
 * through the real registry and apply the effects to the real reducer.
 */
function RouteSync() {
    const { state, dispatch } = useApp();
    const stateRef = useRef(state);
    stateRef.current = state;
    useLayoutEffect(() => {
        const handle = () => {
            const ctx: RouteContext = {
                queueState: { selectedTaskIdByRepo: {} } as RouteContext['queueState'],
                selectedRepoId: stateRef.current.selectedRepoId,
                repoRouteState: stateRef.current.repoRouteState,
                repoTabState: stateRef.current.repoTabState,
                getUiLayoutMode: () => 'classic',
                isSchedulesInSlide: () => false,
            };
            applyRouteEffects(resolveDashboardRoute(location.hash, ctx).effects, {
                dispatch,
                queueDispatch: () => {},
            });
        };
        handle();
        window.addEventListener('hashchange', handle);
        return () => window.removeEventListener('hashchange', handle);
    }, [dispatch]);
    return null;
}

/** Every (member, commit) pairing the app state has ever shown. */
const routeLog: string[] = [];

/** Everything the router publishes, readable from a test. */
function RouteProbe() {
    const { state } = useApp();
    routeLog.push(`${state.gitRouteScope?.workspaceId ?? ''}|${state.selectedGitCommitHash ?? ''}`);
    return (
        <div
            data-testid="route-probe"
            data-selected-repo={state.selectedRepoId ?? ''}
            data-scope-page={state.gitRouteScope?.routeWorkspaceId ?? ''}
            data-scope-member={state.gitRouteScope?.workspaceId ?? ''}
            data-commit={state.selectedGitCommitHash ?? ''}
            data-file={state.selectedGitFilePath ?? ''}
            data-route-suffix={state.repoRouteState[GROUP] ?? ''}
        />
    );
}

/**
 * `RepoGroupView` only mounts the group's Git tab once the Git sub-tab is the
 * active one, which the route decides. Mirroring that here keeps the host from
 * seeing a render before the route it belongs to has been resolved.
 */
function GroupGitHost({ groupId, members }: {
    groupId: string;
    members: readonly RepoGroupMember[] | undefined;
}) {
    const { state } = useApp();
    if (state.selectedRepoId !== groupId || state.activeRepoSubTab !== 'git') return null;
    return <RepoGroupGitTab workspaceId={groupId} members={members} />;
}

function tree(groupId: string, members: readonly RepoGroupMember[] | undefined) {
    return (
        <AppProvider>
            <RouteSync />
            <RouteProbe />
            <GroupGitHost groupId={groupId} members={members} />
        </AppProvider>
    );
}

function renderGroup(
    members: readonly RepoGroupMember[] | undefined,
    groupId: string = GROUP,
    initialHash?: string,
) {
    if (initialHash !== undefined) location.hash = initialHash;
    return render(tree(groupId, members));
}

function probe(attribute: string): string {
    return screen.getByTestId('route-probe').getAttribute(attribute) ?? '';
}

function mountedMember(): string | null {
    return screen.queryByTestId('stub-repo-git-tab')?.getAttribute('data-workspace') ?? null;
}

/** Re-run the route registry the way a real hash change would. */
async function syncRoute() {
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

async function navigate(hash: string) {
    location.hash = hash;
    await syncRoute();
}

beforeEach(() => {
    localStorage.clear();
    panelProps.length = 0;
    routeLog.length = 0;
    location.hash = '';
});
afterEach(() => cleanup());

describe('group Git routes keep the group as the selected page', () => {
    it('hands the group as routeWorkspaceId and the member as workspaceId', async () => {
        renderGroup([member('repo-a'), member('repo-b')]);
        await navigate(`#repos/${GROUP}/git/member/repo-b/abc1234`);

        expect(mountedMember()).toBe('repo-b');
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-route-workspace')).toBe(GROUP);
        expect(probe('data-selected-repo')).toBe(GROUP);
        expect(probe('data-scope-page')).toBe(GROUP);
        expect(probe('data-scope-member')).toBe('repo-b');
        expect(probe('data-commit')).toBe('abc1234');
    });

    it('records the full member path against the GROUP, not the member', async () => {
        renderGroup([member('repo-a'), member('repo-b')]);
        await navigate(`#repos/${GROUP}/git/member/repo-b/abc1234/src%2Fa.ts`);

        expect(probe('data-route-suffix')).toBe('/git/member/repo-b/abc1234/src%2Fa.ts');
        expect(probe('data-file')).toBe('src/a.ts');
    });
});

describe('member resolution', () => {
    it('lets the URL member win over a conflicting remembered preference', async () => {
        renderGroup([member('repo-a'), member('repo-b')], GROUP, `#repos/${GROUP}/git/member/repo-a`);
        await act(async () => {});
        await navigate(`#repos/${GROUP}/git/member/repo-b`);

        expect(mountedMember()).toBe('repo-b');
        // …and the validated choice becomes the new preference.
        expect(JSON.parse(localStorage.getItem(MEMBER_STATE_KEY) ?? '{}')[GROUP]).toBe('repo-b');
    });

    it('canonicalizes a bare group entry to the remembered member in place', async () => {
        renderGroup([member('repo-a'), member('repo-b')], GROUP, `#repos/${GROUP}/git/member/repo-b`);
        await act(async () => {});
        const replaceSpy = vi.spyOn(history, 'replaceState');
        const pushSpy = vi.spyOn(history, 'pushState');
        await navigate(`#repos/${GROUP}/git`);

        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-b`);
        expect(probe('data-scope-member')).toBe('repo-b');
        expect(mountedMember()).toBe('repo-b');
        // `replaceState`, so Back still leaves the Git tab in one step.
        expect(replaceSpy).toHaveBeenCalledWith(null, '', `#repos/${GROUP}/git/member/repo-b`);
        // The canonical form is what the group remembers, so re-entry replays it.
        expect(probe('data-route-suffix')).toBe('/git/member/repo-b');
        expect(pushSpy).not.toHaveBeenCalled();
        replaceSpy.mockRestore();
        pushSpy.mockRestore();
    });

    it('upgrades an older /git/{sha} group link to the explicit member form', async () => {
        renderGroup([member('repo-a'), member('repo-b')], GROUP, `#repos/${GROUP}/git/member/repo-b`);
        await act(async () => {});
        await navigate(`#repos/${GROUP}/git/abc1234/src%2Fa.ts`);

        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-b/abc1234/src%2Fa.ts`);
        expect(probe('data-scope-member')).toBe('repo-b');
        expect(probe('data-commit')).toBe('abc1234');
        expect(probe('data-file')).toBe('src/a.ts');
    });

    it('waits for membership before selecting, canonicalizing or persisting', async () => {
        const { rerender } = renderGroup(undefined);
        await navigate(`#repos/${GROUP}/git`);

        expect(screen.getByTestId('repo-group-git-loading')).toBeTruthy();
        expect(location.hash).toBe(`#repos/${GROUP}/git`);
        expect(localStorage.getItem(MEMBER_STATE_KEY)).toBeNull();

        rerender(
            <AppProvider>
                <RouteSync />
                <RouteProbe />
                <RepoGroupGitTab workspaceId={GROUP} members={[member('repo-a')]} />
            </AppProvider>
        );
        await act(async () => {});
        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-a`);
    });
});

describe('changing member', () => {
    it('navigates to the new member’s history and drops the old selection', async () => {
        renderGroup([member('repo-a'), member('repo-b')]);
        await navigate(`#repos/${GROUP}/git/member/repo-a/abc1234/src%2Fa.ts`);
        expect(probe('data-commit')).toBe('abc1234');

        fireEvent.change(screen.getByRole('combobox', { name: 'Member repository' }), {
            target: { value: 'repo-b' },
        });
        await syncRoute();

        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-b`);
        expect(mountedMember()).toBe('repo-b');
        expect(probe('data-commit')).toBe('');
        expect(probe('data-file')).toBe('');
        expect(probe('data-selected-repo')).toBe(GROUP);
    });

    it('never pairs the new member with the previous member’s commit', async () => {
        renderGroup([member('repo-a'), member('repo-b')]);
        await navigate(`#repos/${GROUP}/git/member/repo-a/abc1234`);
        expect(routeLog).toContain('repo-a|abc1234');

        fireEvent.change(screen.getByRole('combobox', { name: 'Member repository' }), {
            target: { value: 'repo-b' },
        });
        await syncRoute();

        // Scope + revision move together, so this pairing never exists.
        expect(routeLog).not.toContain('repo-b|abc1234');
        expect(routeLog.at(-1)).toBe('repo-b|');
        // And the hosted panel is always the group's, never the member's page.
        for (const props of panelProps) expect(props.routeWorkspaceId).toBe(GROUP);
    });

    it('is a no-op when the already selected member is chosen again', async () => {
        renderGroup([member('repo-a'), member('repo-b')]);
        await navigate(`#repos/${GROUP}/git/member/repo-a/abc1234`);

        fireEvent.change(screen.getByRole('combobox', { name: 'Member repository' }), {
            target: { value: 'repo-a' },
        });
        await syncRoute();

        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-a/abc1234`);
        expect(probe('data-commit')).toBe('abc1234');
    });
});

describe('an explicit member the group cannot show', () => {
    it('keeps the group open with a usable picker and mounts no git panel', async () => {
        renderGroup([member('repo-a'), member('repo-b')], GROUP, `#repos/${GROUP}/git/member/repo-gone/abc1234`);
        await act(async () => {});

        expect(screen.getByTestId('repo-group-git-unavailable-member')).toBeTruthy();
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();
        expect(probe('data-selected-repo')).toBe(GROUP);
        // No git panel was mounted, so no request can target the wrong repo.
        expect(panelProps).toHaveLength(0);
    });

    it('does the same for a member that has gone stale', async () => {
        renderGroup([member('repo-a'), member('repo-b', { stale: true, staleReason: 'path-missing' })]);
        await navigate(`#repos/${GROUP}/git/member/repo-b`);

        expect(screen.getByTestId('repo-group-git-unavailable-member')).toBeTruthy();
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();
    });

    it('opens the picked repository’s history when the user recovers', async () => {
        renderGroup([member('repo-a'), member('repo-b')]);
        await navigate(`#repos/${GROUP}/git/member/repo-gone/abc1234`);

        fireEvent.change(screen.getByRole('combobox', { name: 'Member repository' }), {
            target: { value: 'repo-a' },
        });
        await syncRoute();

        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-a`);
        expect(mountedMember()).toBe('repo-a');
    });

    it('keeps the ordinary empty state when the group has no healthy member', async () => {
        renderGroup([member('gone', { stale: true, staleReason: 'workspace-removed' })]);
        await navigate(`#repos/${GROUP}/git/member/gone/abc1234`);

        expect(screen.getByTestId('repo-group-git-empty')).toBeTruthy();
        expect(screen.queryByTestId('repo-group-git-unavailable-member')).toBeNull();
    });
});

describe('groups stay independent', () => {
    it('remembers a different member per group, sharing the same repos', async () => {
        const members = [member('repo-a'), member('repo-b')];
        // One app, two groups — exactly how a user moves between them.
        const { rerender } = renderGroup(members, GROUP, `#repos/${GROUP}/git/member/repo-b`);
        await act(async () => {});

        rerender(tree(OTHER_GROUP, members));
        await navigate(`#repos/${OTHER_GROUP}/git/member/repo-a`);
        expect(mountedMember()).toBe('repo-a');

        // Back to the first group with no member in the URL: its own pick returns.
        rerender(tree(GROUP, members));
        await navigate(`#repos/${GROUP}/git`);
        expect(location.hash).toBe(`#repos/${GROUP}/git/member/repo-b`);
        expect(JSON.parse(localStorage.getItem(MEMBER_STATE_KEY) ?? '{}')).toEqual({
            [GROUP]: 'repo-b', [OTHER_GROUP]: 'repo-a',
        });
    });

    it('restores the explicit member from the URL even with a conflicting store', async () => {
        const members = [member('repo-a'), member('repo-b')];
        renderGroup(members, GROUP, `#repos/${GROUP}/git/member/repo-a`);
        await act(async () => {});
        await navigate(`#repos/${GROUP}/git/member/repo-b/abc1234`);

        expect(mountedMember()).toBe('repo-b');
        expect(probe('data-commit')).toBe('abc1234');
    });
});
