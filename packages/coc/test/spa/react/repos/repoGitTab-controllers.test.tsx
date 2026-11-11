/**
 * Behavioural tests for the Git tab's extracted controller hooks.
 *
 * These cover the lifecycle-sensitive behaviour that was previously unreachable
 * without mounting the whole 2,400-line tab: clone-routed request targeting
 * (AC-07), workspace-switch cleanup, async job polling, auto-pull skip/failure
 * reporting, branch-range base-mode switching, and deep-link commit lookup.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMemo } from 'react';

// A single per-workspace client double, so every assertion can check WHICH
// clone a request was routed to (AC-07).
const clients = new Map<string, any>();

function makeClient(workspaceId: string) {
    return {
        workspaceId,
        request: vi.fn().mockResolvedValue({ skills: [] }),
        git: {
            listCommits: vi.fn().mockResolvedValue({ commits: [], unpushedCount: 0 }),
            getBranchRange: vi.fn().mockResolvedValue({ onDefaultBranch: true, branchName: 'main', baseRef: 'origin/main' }),
            getRepoState: vi.fn().mockResolvedValue(null),
            getCommit: vi.fn(),
            getOperation: vi.fn().mockResolvedValue({ status: 'running' }),
            getLatestOperation: vi.fn().mockResolvedValue(null),
            getWorkingTreeChanges: vi.fn().mockResolvedValue({ changes: [] }),
            getAutoPullStatus: vi.fn().mockResolvedValue({ enabled: false }),
            fetch: vi.fn().mockResolvedValue({ success: true }),
            pull: vi.fn().mockResolvedValue({ success: true }),
            push: vi.fn().mockResolvedValue({ success: true }),
            pushTo: vi.fn().mockResolvedValue({ success: true }),
            reset: vi.fn().mockResolvedValue({ success: true }),
            amend: vi.fn().mockResolvedValue({ hash: 'newhash' }),
            reword: vi.fn().mockResolvedValue({}),
            dropCommit: vi.fn().mockResolvedValue({}),
            cherryPick: vi.fn().mockResolvedValue({ success: true }),
            rebaseAutosquash: vi.fn().mockResolvedValue({ success: true }),
            rebaseReorder: vi.fn().mockResolvedValue({}),
            rebaseContinue: vi.fn().mockResolvedValue({}),
            rebaseAbort: vi.fn().mockResolvedValue({}),
            mergeContinue: vi.fn().mockResolvedValue({}),
            mergeAbort: vi.fn().mockResolvedValue({}),
        },
        preferences: {
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
            recordCommitSkillUsage: vi.fn().mockResolvedValue({}),
        },
        queue: { enqueue: vi.fn().mockResolvedValue({}) },
    };
}

function clientFor(workspaceId: string) {
    if (!clients.has(workspaceId)) clients.set(workspaceId, makeClient(workspaceId));
    return clients.get(workspaceId);
}

vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: (ref?: string) => clientFor(ref ?? 'local'),
    useCloneWsUrl: () => (path: string) => path,
}));

const appDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: appState, dispatch: appDispatch }),
}));
let appState: any = { workspaces: [] };

const queueDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ dispatch: queueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isGitCommitLookupEnabled: () => lookupEnabled,
    isGitCrossCloneCherryPickEnabled: () => false,
}));
let lookupEnabled = true;

import { useRepoGitData } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useRepoGitData';
import { useRepoGitSelection } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useRepoGitSelection';
import { persistGitView } from '../../../../src/server/spa/client/react/features/git/repoGitTab/selectionModel';
import { useGitOperationActions } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitOperationActions';
import { useGitAutoPullController } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitAutoPullController';
import { useGitAutoRefresh, GIT_AUTO_REFRESH_INTERVAL_MS } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitAutoRefresh';
import { useGitSkillActions } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitSkillActions';
import { useGitOperationPoller } from '../../../../src/server/spa/client/react/features/git/hooks/useGitOperationPoller';
import { clearCommitsCache, getCommitsCache } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitsCache';
import { clearBranchRangeCache } from '../../../../src/server/spa/client/react/features/git/hooks/useBranchRangeCache';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { RightPanelView } from '../../../../src/server/spa/client/react/features/git/repoGitTab/types';
import { rememberKnownCommit, resetKnownCommitForTests } from '../../../../src/server/spa/client/react/features/git/repoGitTab/knownCommit';

function commit(hash: string): GitCommitItem {
    return {
        hash, shortHash: hash.slice(0, 7), subject: `subject ${hash.slice(0, 4)}`,
        author: 'Ada', authorEmail: 'ada@example.com',
        date: '2026-01-01T00:00:00Z', parentHashes: [],
    };
}

const WS = 'ws-alpha';
const OTHER_WS = 'ws-beta';

/** A selection bridge backed by a plain object, so tests can read the view. */
function makeBridge() {
    const box: { view: RightPanelView | null } = { view: null };
    return {
        box,
        bridge: { getView: () => box.view, setView: (v: RightPanelView | null) => { box.view = v; } },
    };
}

beforeEach(() => {
    clients.clear();
    appDispatch.mockClear();
    queueDispatch.mockClear();
    appState = { workspaces: [] };
    lookupEnabled = true;
    resetKnownCommitForTests();
    localStorage.clear();
    clearCommitsCache(WS); clearCommitsCache(OTHER_WS);
    clearBranchRangeCache(WS); clearBranchRangeCache(OTHER_WS);
    location.hash = '';
});

describe('useRepoGitData', () => {
    it('hydrates a slow initial read once without a competing empty search', async () => {
        vi.useFakeTimers();
        try {
            let resolve!: (value: any) => void;
            const a = commit('aaaaaaaaaaaa');
            const git = clientFor(WS).git;
            git.listCommits.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
            const onInitialLoad = vi.fn();
            const { bridge } = makeBridge();
            const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge, onInitialLoad }));
            await act(async () => { await vi.advanceTimersByTimeAsync(500); });
            expect(git.listCommits).toHaveBeenCalledTimes(1);
            await act(async () => { resolve({ commits: [a] }); });
            expect(onInitialLoad).toHaveBeenCalledWith([a]);
            expect(result.current.loading).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not cache or select a refresh result after unmount', async () => {
        const a = commit('aaaaaaaaaaaa');
        const git = clientFor(WS).git;
        git.listCommits.mockResolvedValue({ commits: [a] });
        const { box, bridge } = makeBridge();
        const { result, unmount } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        let resolve!: (value: any) => void;
        git.listCommits.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        act(() => result.current.refreshAll());
        unmount();
        await act(async () => { resolve({ commits: [a] }); });
        expect(getCommitsCache(WS)).toBeUndefined();
        expect(box.view).toBeNull();
    });

    it('forces fresh commits, deduplicates refresh, retains selection and retries failures', async () => {
        const a = commit('aaaaaaaaaaaa');
        const b = commit('bbbbbbbbbbbb');
        const git = clientFor(WS).git;
        git.listCommits.mockResolvedValue({ commits: [a] });
        const { box, bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        box.view = { type: 'commit', commit: a };
        let resolve!: (value: any) => void;
        git.listCommits.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const calls = git.listCommits.mock.calls.length;
        act(() => { result.current.refreshAll(); result.current.refreshAll(); });
        expect(git.listCommits).toHaveBeenCalledTimes(calls + 1);
        expect(git.listCommits).toHaveBeenLastCalledWith(WS, expect.objectContaining({ refresh: true, skip: undefined }));
        expect(result.current.refreshing).toBe(true);
        expect(result.current.commits).toEqual([a]);
        await act(async () => { resolve({ commits: [b, a] }); });
        expect(result.current.commits).toEqual([b, a]);
        expect(box.view).toEqual({ type: 'commit', commit: a });
        git.listCommits.mockRejectedValueOnce(new Error('offline'));
        await act(async () => result.current.refreshAll());
        expect(result.current.refreshError).toBe('offline');
        expect(result.current.refreshing).toBe(false);
        expect(result.current.commits).toEqual([b, a]);
        expect(box.view).toEqual({ type: 'commit', commit: a });
        git.listCommits.mockResolvedValue({ commits: [] });
        await act(async () => result.current.refreshAll());
        expect(result.current.refreshError).toBeNull();
        expect(box.view).toBeNull();
    });

    it('ignores an older commit read and preserves navigation during refresh', async () => {
        const a = commit('aaaaaaaaaaaa');
        const b = commit('bbbbbbbbbbbb');
        const git = clientFor(WS).git;
        git.listCommits.mockResolvedValue({ commits: [a] });
        const { box, bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        let older!: (value: any) => void;
        git.listCommits.mockImplementationOnce(() => new Promise(r => { older = r; }));
        act(() => { void result.current.fetchCommits(true); });
        let refresh!: (value: any) => void;
        git.listCommits.mockImplementationOnce(() => new Promise(r => { refresh = r; }));
        box.view = { type: 'commit', commit: a };
        act(() => result.current.refreshAll());
        box.view = { type: 'working-tree-all' };
        await act(async () => { refresh({ commits: [b] }); older({ commits: [a] }); });
        expect(result.current.commits).toEqual([b]);
        expect(box.view).toEqual({ type: 'working-tree-all' });
    });

    it.each(['resolve', 'reject'])('discards a former workspace refresh that settles with %s', async outcome => {
        const a = commit('aaaaaaaaaaaa');
        const b = commit('bbbbbbbbbbbb');
        clientFor(WS).git.listCommits.mockResolvedValue({ commits: [a] });
        clientFor(OTHER_WS).git.listCommits.mockResolvedValue({ commits: [b] });
        const { box, bridge } = makeBridge();
        const { result, rerender } = renderHook(({ ws }) => useRepoGitData({ workspaceId: ws, selection: bridge }), { initialProps: { ws: WS } });
        await waitFor(() => expect(result.current.loading).toBe(false));
        let resolve!: (value: any) => void;
        let reject!: (value: any) => void;
        clientFor(WS).git.listCommits.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
        act(() => result.current.refreshAll());
        rerender({ ws: OTHER_WS });
        await waitFor(() => expect(result.current.commits).toEqual([b]));
        box.view = { type: 'commit', commit: b };
        await act(async () => { if (outcome === 'resolve') resolve({ commits: [a] }); else reject(new Error('old error')); });
        expect(result.current.commits).toEqual([b]);
        expect(result.current.refreshError).toBeNull();
        expect(result.current.refreshing).toBe(false);
        expect(box.view).toEqual({ type: 'commit', commit: b });
        expect(clientFor(OTHER_WS).git.listCommits).toHaveBeenCalledWith(OTHER_WS, expect.anything());
    });

    it('routes every initial read to the selected clone (AC-07)', async () => {
        const { bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const mine = clientFor(WS).git;
        expect(mine.listCommits).toHaveBeenCalledWith(WS, expect.objectContaining({ limit: 50 }));
        expect(mine.getBranchRange).toHaveBeenCalledWith(WS, expect.objectContaining({ refresh: false }));
        expect(mine.getRepoState).toHaveBeenCalledWith(WS);
        // Nothing leaked to a different clone's client.
        expect(clients.has(OTHER_WS)).toBe(false);
    });

    it('surfaces a load failure and retries on demand', async () => {
        clientFor(WS).git.listCommits.mockRejectedValueOnce(new Error('boom'));
        const { bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));

        await waitFor(() => expect(result.current.error).toBe('boom'));

        act(() => result.current.retry());
        await waitFor(() => expect(result.current.error).toBeNull());
        expect(result.current.commits).toEqual([]);
    });

    it('hands the first commit page to onInitialLoad for deep-link hydration', async () => {
        const loaded = [commit('aaaaaaaaaaaa')];
        clientFor(WS).git.listCommits.mockResolvedValue({ commits: loaded, unpushedCount: 1 });
        const onInitialLoad = vi.fn();
        const { bridge } = makeBridge();

        const { result } = renderHook(() =>
            useRepoGitData({ workspaceId: WS, selection: bridge, onInitialLoad }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(onInitialLoad).toHaveBeenCalledWith(loaded);
        expect(result.current.lastRefreshedAt).toBeTypeOf('number');
    });

    it('reconciles the right panel through the selection bridge on refresh', async () => {
        const a = commit('aaaaaaaaaaaa');
        const b = commit('bbbbbbbbbbbb');
        clientFor(WS).git.listCommits.mockResolvedValue({ commits: [a, b], unpushedCount: 0 });
        const { box, bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // A commit that no longer exists falls back to HEAD.
        box.view = { type: 'commit', commit: commit('cccccccccccc') };
        act(() => result.current.refreshAll());
        await waitFor(() => expect(box.view).toEqual({ type: 'commit', commit: a }));
    });

    it('re-reads the range with the new base when the base mode is switched', async () => {
        const { bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const getBranchRange = clientFor(WS).git.getBranchRange;
        getBranchRange.mockClear();

        act(() => result.current.setBaseModeAndRefetch('unpushed'));
        await waitFor(() =>
            expect(getBranchRange).toHaveBeenCalledWith(WS, { refresh: false, base: 'unpushed' }));
        expect(result.current.baseMode).toBe('unpushed');
    });

    it('ignores a base-mode change that is already active', async () => {
        const { bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const current = result.current.baseMode;
        clientFor(WS).git.getBranchRange.mockClear();
        act(() => result.current.setBaseModeAndRefetch(current));
        expect(clientFor(WS).git.getBranchRange).not.toHaveBeenCalled();
    });

    it('reloads commits and range from the server after a branch switch', async () => {
        const { bridge } = makeBridge();
        const { result } = renderHook(() => useRepoGitData({ workspaceId: WS, selection: bridge }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const git = clientFor(WS).git;
        git.listCommits.mockClear();
        git.getBranchRange.mockClear();

        act(() => result.current.reloadAfterBranchSwitch());
        await waitFor(() => {
            expect(git.getBranchRange).toHaveBeenCalledWith(WS, { refresh: true, base: expect.anything() });
            expect(git.listCommits).toHaveBeenCalledWith(WS, expect.objectContaining({ refresh: true }));
        });
    });

    it('re-reads from the new clone when the workspace changes', async () => {
        const { bridge } = makeBridge();
        const { result, rerender } = renderHook(
            ({ ws }) => useRepoGitData({ workspaceId: ws, selection: bridge }),
            { initialProps: { ws: WS } },
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        rerender({ ws: OTHER_WS });
        await waitFor(() => expect(clientFor(OTHER_WS).git.listCommits).toHaveBeenCalledWith(
            OTHER_WS, expect.objectContaining({ limit: 50 })));
    });
});

describe('useRepoGitData + useGitAutoRefresh (timed refresh)', () => {
    afterEach(() => { vi.useRealTimers(); });

    /** The Git tab's composition: the timer drives the data hook's refreshAll. */
    function renderTimedTab(ws = WS) {
        const { bridge } = makeBridge();
        return renderHook(({ id }) => {
            const data = useRepoGitData({ workspaceId: id, selection: bridge });
            useGitAutoRefresh({ workspaceId: id, refreshAll: data.refreshAll });
            return data;
        }, { initialProps: { id: ws } });
    }

    async function flush(ms = 0) {
        await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    }

    it('runs the same full refresh as a manual click, with no remote or mutating git calls', async () => {
        vi.useFakeTimers();
        const { result } = renderTimedTab();
        await flush(1000);
        expect(result.current.loading).toBe(false);
        const stampBefore = result.current.lastRefreshedAt;
        const keyBefore = result.current.workingChangesRefreshKey;

        const git = clientFor(WS).git;
        for (const fn of Object.values(git) as any[]) fn.mockClear();

        await flush(GIT_AUTO_REFRESH_INTERVAL_MS);

        expect(git.listCommits).toHaveBeenCalledTimes(1);
        expect(git.listCommits).toHaveBeenCalledWith(WS, expect.objectContaining({ refresh: true, limit: 50 }));
        expect(git.getBranchRange).toHaveBeenCalledWith(WS, expect.objectContaining({ refresh: true }));
        expect(git.getRepoState).toHaveBeenCalledWith(WS);
        expect(result.current.workingChangesRefreshKey).toBe(keyBefore + 1);
        expect(result.current.lastRefreshedAt).toBeGreaterThan(stampBefore ?? 0);
        expect(result.current.refreshing).toBe(false);

        for (const op of ['fetch', 'pull', 'push', 'pushTo', 'reset', 'amend', 'reword', 'dropCommit',
            'cherryPick', 'rebaseAutosquash', 'rebaseReorder', 'rebaseContinue', 'rebaseAbort',
            'mergeContinue', 'mergeAbort'] as const) {
            expect(git[op], op).not.toHaveBeenCalled();
        }
        // Nothing leaked to another clone.
        expect(clients.has(OTHER_WS)).toBe(false);
    });

    it('does not start an overlapping refresh while one is already running', async () => {
        vi.useFakeTimers();
        const { result } = renderTimedTab();
        await flush(1000);

        const git = clientFor(WS).git;
        let release!: (v: any) => void;
        git.listCommits.mockClear();
        git.listCommits.mockImplementation(() => new Promise(r => { release = r; }));

        // A manual refresh is in flight when the timer fires — twice.
        act(() => result.current.refreshAll());
        expect(result.current.refreshing).toBe(true);
        await flush(GIT_AUTO_REFRESH_INTERVAL_MS * 2);
        expect(git.listCommits).toHaveBeenCalledTimes(1);

        release({ commits: [], unpushedCount: 0 });
        await flush();
        expect(result.current.refreshing).toBe(false);

        // Once idle, the next tick refreshes again.
        git.listCommits.mockResolvedValue({ commits: [], unpushedCount: 0 });
        await flush(GIT_AUTO_REFRESH_INTERVAL_MS);
        expect(git.listCommits).toHaveBeenCalledTimes(2);
    });

    it('surfaces a failed timed refresh through the existing refresh error', async () => {
        vi.useFakeTimers();
        const { result } = renderTimedTab();
        await flush(1000);

        clientFor(WS).git.listCommits.mockRejectedValueOnce(new Error('git broke'));
        await flush(GIT_AUTO_REFRESH_INTERVAL_MS);
        expect(result.current.refreshError).toBe('git broke');
        expect(result.current.refreshing).toBe(false);
    });

    it('stops refreshing the former workspace after a switch and after unmount', async () => {
        vi.useFakeTimers();
        const { rerender, unmount } = renderTimedTab(WS);
        await flush(1000);
        const oldGit = clientFor(WS).git;
        oldGit.listCommits.mockClear();

        rerender({ id: OTHER_WS });
        await flush(1000);
        const newGit = clientFor(OTHER_WS).git;
        newGit.listCommits.mockClear();

        await flush(GIT_AUTO_REFRESH_INTERVAL_MS);
        expect(oldGit.listCommits).not.toHaveBeenCalled();
        expect(newGit.listCommits).toHaveBeenCalledWith(OTHER_WS, expect.objectContaining({ refresh: true }));

        unmount();
        newGit.listCommits.mockClear();
        await flush(GIT_AUTO_REFRESH_INTERVAL_MS * 2);
        expect(newGit.listCommits).not.toHaveBeenCalled();
        expect(oldGit.listCommits).not.toHaveBeenCalled();
    });
});

describe('useRepoGitSelection', () => {
    function setup(commits: GitCommitItem[] = []) {
        return renderHook(() => useRepoGitSelection({ workspaceId: WS, commits }));
    }

    it('selects a commit as local view state only — the host owns the address', () => {
        const a = commit('aaaaaaaaaaaa');
        const { result } = setup([a]);
        act(() => result.current.selectCommit(a));

        expect(result.current.view).toEqual({ type: 'commit', commit: a });
        expect(result.current.selectedCommit).toBe(a);
        expect(location.hash).toBe('');
        expect(appDispatch).not.toHaveBeenCalled();
    });

    it('selects branch-range and commit files', () => {
        const { result } = setup();
        act(() => result.current.selectBranchFile('src/a b.ts'));
        expect(result.current.view).toEqual({ type: 'branch-file', filePath: 'src/a b.ts' });

        act(() => result.current.selectCommitFile('aaaaaaaaaaaa', 'src/a b.ts'));
        expect(result.current.view).toEqual({ type: 'commit-file', hash: 'aaaaaaaaaaaa', filePath: 'src/a b.ts' });
    });

    it('opens all working changes', () => {
        const { result } = setup();
        act(() => result.current.selectWorkingTreeAll());
        expect(result.current.view).toEqual({ type: 'working-tree-all' });
        expect(appDispatch).not.toHaveBeenCalled();
    });

    it('collapses a one-commit multi-select to a normal commit selection', () => {
        const a = commit('aaaaaaaaaaaa');
        const { result } = setup([a]);
        act(() => result.current.selectCommits([a]));
        expect(result.current.view).toEqual({ type: 'commit', commit: a });
    });

    it('clears the panel when a multi-select is emptied', () => {
        const { result } = setup();
        act(() => result.current.selectCommits([]));
        expect(result.current.view).toBeNull();
    });

    it('opens a working-tree file inside the all-working-changes review', () => {
        const { result } = setup();
        act(() => result.current.selectWorkingTreeFile('a.ts', 'staged'));
        expect(result.current.view).toEqual({ type: 'working-tree-all', filePath: 'a.ts', stage: 'staged' });
        expect(result.current.hunkTarget).toBeUndefined();
        act(() => result.current.navigateToWorkingTreeFile('b.ts', 'untracked', 'last'));
        expect(result.current.view).toEqual({ type: 'working-tree-all', filePath: 'b.ts', stage: 'untracked' });
        expect(result.current.hunkTarget).toBe('last');
    });

    describe('restoring the host-persisted view on mount', () => {
        it('shows plain history with nothing to restore', () => {
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([]));
            expect(result.current.view).toBeNull();
            expect(result.current.initialCommitHash).toBeNull();
        });

        it.each([
            [{ type: 'branch-range' }, { type: 'branch-range' }],
            [{ type: 'working-tree-all' }, { type: 'working-tree-all' }],
            [{ type: 'branch-file', filePath: 'src/a.ts' }, { type: 'branch-file', filePath: 'src/a.ts' }],
        ] as const)('restores %j', (restore, expected) => {
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([], restore));
            expect(result.current.view).toEqual(expected);
        });

        it('restores a loaded commit without a lookup', () => {
            const a = commit('aaaaaaaaaaaa');
            const { result } = setup([a]);
            act(() => result.current.hydrateFromInitialLoad([a], { type: 'commit', hash: a.hash }));
            expect(result.current.view).toEqual({ type: 'commit', commit: a });
            expect(result.current.initialCommitHash).toBe(a.hash);
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
        });

        it('fetches a commit outside the loaded page, even with search lookup off', async () => {
            lookupEnabled = false;
            const remote = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockResolvedValue(remote);
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([], { type: 'commit', hash: remote.hash }));
            await waitFor(() => expect(result.current.view).toEqual({ type: 'commit', commit: remote }));
            expect(clientFor(WS).git.getCommit).toHaveBeenCalledWith(WS, remote.hash);
        });

        it('keeps the file and the looked-up commit when a commit file needs a lookup', async () => {
            const remote = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockResolvedValue(remote);
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([], { type: 'commit-file', hash: remote.hash, filePath: 'src/a.ts' }));
            await waitFor(() => expect(result.current.view).toEqual({ type: 'commit-file', hash: remote.hash, filePath: 'src/a.ts', commit: remote }));
            expect(result.current.selectedCommit).toEqual(remote);
            expect(persistGitView(result.current.view!)).toEqual({ type: 'commit-file', hash: remote.hash, filePath: 'src/a.ts' });
        });

        it('keeps a looked-up commit (e.g. opened from blame) when moving to its files', async () => {
            const remote = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockResolvedValue(remote);
            const { result } = setup([commit('aaaaaaaaaaaa')]);
            act(() => result.current.hydrateFromInitialLoad([], { type: 'commit', hash: remote.hash }));
            await waitFor(() => expect(result.current.view).toEqual({ type: 'commit', commit: remote }));

            act(() => result.current.navigateToCommitFile(remote.hash, 'src/a.ts', 'first'));
            expect(result.current.view).toEqual({ type: 'commit-file', hash: remote.hash, filePath: 'src/a.ts', commit: remote });
            act(() => result.current.selectCommitFile(remote.hash, 'src/b.ts'));
            expect(result.current.view).toEqual({ type: 'commit-file', hash: remote.hash, filePath: 'src/b.ts', commit: remote });
            expect(result.current.selectedCommit).toEqual(remote);

            // Another commit's file never inherits it.
            act(() => result.current.selectCommitFile('aaaaaaaaaaaa', 'src/c.ts'));
            expect(result.current.view).toEqual({ type: 'commit-file', hash: 'aaaaaaaaaaaa', filePath: 'src/c.ts' });
        });

        it('says so when a restored commit no longer exists, and any selection clears the notice', async () => {
            clientFor(WS).git.getCommit.mockRejectedValue(new Error('gone'));
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([], { type: 'commit', hash: 'ffffffffffff' }));
            await waitFor(() => expect(result.current.restoreNotFound).toMatch(/Commit fffffff was not found/));
            expect(result.current.view).toBeNull();
            act(() => result.current.selectBranchRange());
            expect(result.current.restoreNotFound).toBeNull();
        });

        it('restores a multi-commit selection from the loaded page', () => {
            const a = commit('aaaaaaaaaaaa');
            const b = commit('bbbbbbbbbbbb');
            const { result } = setup([a, b]);
            act(() => result.current.hydrateFromInitialLoad([a, b], { type: 'multi-commit', hashes: [a.hash, b.hash] }));
            expect(result.current.view).toEqual({ type: 'multi-commit', commits: [a, b] });
        });

        it('discards a restore lookup that lands after the member has changed', async () => {
            const remote = commit('ffffffffffff');
            let settle: (value: unknown) => void = () => {};
            clientFor(WS).git.getCommit.mockReturnValue(new Promise(resolve => { settle = resolve; }));
            const { result, rerender } = renderHook(
                ({ id }: { id: string }) => useRepoGitSelection({ workspaceId: id, commits: [] }),
                { initialProps: { id: WS } },
            );
            act(() => result.current.hydrateFromInitialLoad([], { type: 'commit', hash: remote.hash }));

            // The user switches member before the request comes back.
            act(() => rerender({ id: OTHER_WS }));
            await act(async () => { settle(remote); });

            expect(result.current.view).toBeNull();
        });
    });

    describe('an already-read commit handed over by the opener', () => {
        const a = commit('aaaaaaaaaaaa');

        it.each(['ws-alpha', 'remote:owner:ws-alpha'])('opens an outgoing commit outside the history page without a lookup (%s)', () => {
            lookupEnabled = false;
            const outgoing = commit('ffffffffffff');
            rememberKnownCommit(WS, outgoing);
            const { result } = setup([a]);
            act(() => result.current.hydrateFromInitialLoad([a], { type: 'commit', hash: outgoing.hash }));
            expect(result.current.view).toEqual({ type: 'commit', commit: outgoing });
            expect(result.current.selectedCommit).toEqual(outgoing);
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
        });

        it('reopens it through an external open after the detail was closed', () => {
            const outgoing = commit('ffffffffffff');
            rememberKnownCommit(WS, outgoing);
            const { result } = setup();
            act(() => result.current.switchViewScope({ type: 'commit', hash: outgoing.hash }));
            expect(result.current.view).toEqual({ type: 'commit', commit: outgoing });
            act(() => result.current.clearSelection());
            expect(result.current.view).toBeNull();
            act(() => result.current.switchViewScope({ type: 'commit', hash: outgoing.hash }));
            expect(result.current.view).toEqual({ type: 'commit', commit: outgoing });
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
        });

        it.each(['workspace', 'hash'])('is ignored for a mismatched %s', mismatch => {
            const outgoing = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockReturnValue(new Promise(() => {}));
            rememberKnownCommit(mismatch === 'workspace' ? OTHER_WS : WS, outgoing);
            const { result } = setup();
            const hash = mismatch === 'hash' ? 'eeeeeeeeeeee' : outgoing.hash;
            act(() => result.current.hydrateFromInitialLoad([], { type: 'commit', hash }));
            expect(result.current.view).toBeNull();
            expect(clientFor(WS).git.getCommit).toHaveBeenCalledWith(WS, hash);
        });
    });

    describe('an external open while mounted (switchViewScope)', () => {
        const a = commit('aaaaaaaaaaaa');

        function mounted(restore: Parameters<ReturnType<typeof useRepoGitSelection>['hydrateFromInitialLoad']>[1]) {
            const view = setup([a]);
            act(() => view.result.current.hydrateFromInitialLoad([a], restore));
            return view;
        }

        it('follows a same-SHA file change', () => {
            const { result } = mounted({ type: 'commit-file', hash: a.hash, filePath: 'src/a.ts' });
            expect(result.current.view).toEqual({ type: 'commit-file', hash: a.hash, filePath: 'src/a.ts', commit: a });

            act(() => result.current.switchViewScope({ type: 'commit-file', hash: a.hash, filePath: 'src/b.ts' }));
            expect(result.current.view).toEqual({ type: 'commit-file', hash: a.hash, filePath: 'src/b.ts', commit: a });
        });

        it('follows commit → branch range → branch file', () => {
            const { result } = mounted({ type: 'commit', hash: a.hash });
            act(() => result.current.switchViewScope({ type: 'branch-range' }));
            expect(result.current.view).toEqual({ type: 'branch-range' });

            act(() => result.current.switchViewScope({ type: 'branch-file', filePath: 'src/a.ts' }));
            expect(result.current.view).toEqual({ type: 'branch-file', filePath: 'src/a.ts' });
        });

        it('clears the detail and the lookup state on the way back to history', async () => {
            clientFor(WS).git.getCommit.mockRejectedValue(new Error('nope'));
            const { result } = setup();
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(result.current.commitLookupError).toBe('Commit not found or ambiguous SHA');

            act(() => result.current.switchViewScope(null));
            expect(result.current.view).toBeNull();
            expect(result.current.commitLookupError).toBeNull();
        });

        it('drops a search lookup still in flight from the scope being left', async () => {
            let settle: (value: unknown) => void = () => {};
            clientFor(WS).git.getCommit.mockReturnValue(new Promise(resolve => { settle = resolve; }));
            const { result } = setup();
            let pending!: Promise<void>;
            act(() => { pending = result.current.lookupCommit('ffffffffffff'); });
            expect(result.current.commitLookupLoading).toBe(true);

            act(() => result.current.switchViewScope({ type: 'branch-range' }));
            await act(async () => { settle(commit('ffffffffffff')); await pending; });

            expect(result.current.view).toEqual({ type: 'branch-range' });
            expect(result.current.commitLookupLoading).toBe(false);
        });
    });

    describe('search-box commit lookup', () => {
        it('selects a already-loaded commit without hitting the server', async () => {
            const a = commit('aaaaaaaaaaaa');
            const { result } = setup([a]);
            await act(async () => { await result.current.lookupCommit('AAAAAAA'); });
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
            expect(result.current.view).toEqual({ type: 'commit', commit: a });
        });

        it('fetches an unloaded commit and selects it on success', async () => {
            const remote = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockResolvedValue(remote);
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(result.current.view).toEqual({ type: 'commit', commit: remote });
        });

        it('leaves the view untouched when the lookup fails', async () => {
            clientFor(WS).git.getCommit.mockRejectedValue(new Error('ambiguous'));
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(result.current.commitLookupError).toBe('Commit not found or ambiguous SHA');
            expect(result.current.view).toBeNull();
        });

        it('ignores a query that is not SHA-shaped', async () => {
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('fix typo'); });
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
        });

        it('does not look up when the feature flag is off', async () => {
            lookupEnabled = false;
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
        });

        it('routes a group member lookup to the member client and never to the group', async () => {
            const remote = commit('ffffffffffff');
            clientFor('repo-b').git.getCommit.mockResolvedValue(remote);
            const { result } = renderHook(() => useRepoGitSelection({ workspaceId: 'repo-b', commits: [] }));
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(clientFor('repo-b').git.getCommit).toHaveBeenCalledWith('repo-b', 'ffffffffffff');
            expect(clients.has('group-frontend')).toBe(false);
        });
    });
});

describe('useGitOperationActions', () => {
    function setup(overrides: Partial<Parameters<typeof useGitOperationActions>[0]> = {}) {
        const refreshAll = overrides.refreshAll ?? vi.fn();
        const showToast = overrides.showToast ?? vi.fn();
        const setPendingReorder = overrides.setPendingReorder ?? vi.fn();
        const onManualPull = overrides.onManualPull ?? vi.fn();
        const options = {
            workspaceId: WS, refreshAll, showToast, repoState: null,
            commits: [], unpushedCount: 0, pendingReorder: null,
            setPendingReorder, onManualPull, ...overrides,
        };
        const hook = renderHook((props: any) => useGitOperationActions(props), { initialProps: options });
        return { ...hook, refreshAll, showToast, setPendingReorder, onManualPull };
    }

    it('routes a fetch to the selected clone and refreshes on success', async () => {
        const { result, refreshAll } = setup();
        await act(async () => { await result.current.fetch(); });
        expect(clientFor(WS).git.fetch).toHaveBeenCalledWith(WS, { currentBranchOnly: true });
        expect(refreshAll).toHaveBeenCalled();
        expect(result.current.actionError).toBeNull();
    });

    it('surfaces a failed fetch in the action banner', async () => {
        clientFor(WS).git.fetch.mockResolvedValue({ success: false, error: 'no remote' });
        const { result, refreshAll } = setup();
        await act(async () => { await result.current.fetch(); });
        expect(result.current.actionError).toBe('no remote');
        expect(refreshAll).not.toHaveBeenCalled();
    });

    it('restarts the auto-pull countdown on a manual pull', async () => {
        const { result, onManualPull } = setup();
        await act(async () => { await result.current.pull(); });
        expect(onManualPull).toHaveBeenCalled();
        expect(clientFor(WS).git.pull).toHaveBeenCalledWith(WS, { rebase: true, currentBranchOnly: true });
    });

    it('polls an async pull job until it succeeds, then refreshes', async () => {
        vi.useFakeTimers();
        try {
            clientFor(WS).git.pull.mockResolvedValue({ jobId: 'job-1' });
            clientFor(WS).git.getOperation.mockResolvedValue({ id: 'job-1', status: 'success' });
            const { result, refreshAll } = setup();

            await act(async () => { await result.current.pull(); });
            expect(result.current.pulling).toBe(true);

            await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
            expect(clientFor(WS).git.getOperation).toHaveBeenCalledWith(WS, 'job-1');
            expect(refreshAll).toHaveBeenCalled();
            expect(result.current.pulling).toBe(false);
        } finally { vi.useRealTimers(); }
    });

    it('reports a failed async pull in the action banner', async () => {
        vi.useFakeTimers();
        try {
            clientFor(WS).git.pull.mockResolvedValue({ jobId: 'job-2' });
            clientFor(WS).git.getOperation.mockResolvedValue({ id: 'job-2', status: 'failed', error: 'non-fast-forward' });
            const { result } = setup();

            await act(async () => { await result.current.pull(); });
            await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
            expect(result.current.actionError).toBe('non-fast-forward');
        } finally { vi.useRealTimers(); }
    });

    it('recovers a running pull job on mount', async () => {
        clientFor(WS).git.getLatestOperation.mockResolvedValue({ id: 'job-3', status: 'running' });
        const { result } = setup();
        await waitFor(() => expect(result.current.pulling).toBe(true));
        expect(clientFor(WS).git.getLatestOperation).toHaveBeenCalledWith(WS, { op: 'pull' });
    });

    it('re-surfaces a recently failed pull on mount', async () => {
        clientFor(WS).git.getLatestOperation.mockResolvedValue({
            id: 'job-4', status: 'failed', error: 'conflict', finishedAt: new Date().toISOString(),
        });
        const { result } = setup();
        await waitFor(() => expect(result.current.actionError).toBe('conflict'));
    });

    it('ignores a pull failure older than the recovery TTL', async () => {
        clientFor(WS).git.getLatestOperation.mockResolvedValue({
            id: 'job-5', status: 'failed', error: 'stale',
            finishedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        });
        const { result } = setup();
        // Give the recovery promise a turn; the banner must stay clear.
        await act(async () => { await Promise.resolve(); });
        expect(result.current.actionError).toBeNull();
    });

    it('stops polling when the workspace changes mid-job', async () => {
        vi.useFakeTimers();
        try {
            clientFor(WS).git.pull.mockResolvedValue({ jobId: 'job-6' });
            const refreshAll = vi.fn();
            const base = {
                workspaceId: WS, refreshAll, showToast: vi.fn(), repoState: null,
                commits: [], unpushedCount: 0, pendingReorder: null,
                setPendingReorder: vi.fn(), onManualPull: vi.fn(),
            };
            const { result, rerender } = renderHook((props: any) => useGitOperationActions(props), {
                initialProps: base,
            });
            await act(async () => { await result.current.pull(); });

            rerender({ ...base, workspaceId: OTHER_WS });
            clientFor(WS).git.getOperation.mockClear();
            await act(async () => { await vi.advanceTimersByTimeAsync(9000); });

            // The poll for the old workspace was torn down on the switch.
            expect(clientFor(WS).git.getOperation).not.toHaveBeenCalled();
            expect(refreshAll).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('confirms before a hard reset and skips the reset when declined', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const { result } = setup();
        await act(async () => { await result.current.hardReset(commit('aaaaaaaaaaaa')); });
        expect(clientFor(WS).git.reset).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('hard-resets to the commit once confirmed', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const target = commit('aaaaaaaaaaaa');
        const { result, refreshAll } = setup();
        await act(async () => { await result.current.hardReset(target); });
        expect(clientFor(WS).git.reset).toHaveBeenCalledWith(WS, target.hash, 'hard');
        expect(refreshAll).toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('re-selects the amended commit and rebinds its chat when the hash changed', async () => {
        const target = commit('aaaaaaaaaaaa');
        clientFor(WS).git.amend.mockResolvedValue({ hash: 'newhash1234' });
        const { result, refreshAll, showToast } = setup();
        await act(async () => { await result.current.amend(target, 'title', 'body'); });
        expect(clientFor(WS).git.amend).toHaveBeenCalledWith(WS, 'title', 'body');
        expect(refreshAll).toHaveBeenCalledWith({ selectHash: 'newhash1234', selectFallbackToHead: true });
        expect(showToast).toHaveBeenCalledWith('Commit message amended.');
    });

    it('falls back to HEAD after dropping a commit', async () => {
        const { result, refreshAll } = setup();
        await act(async () => { await result.current.dropCommit(commit('aaaaaaaaaaaa')); });
        expect(refreshAll).toHaveBeenCalledWith({ selectFallbackToHead: true });
    });

    it('reports a cherry-pick conflict and rethrows for the picker dialog', async () => {
        clientFor(WS).git.cherryPick.mockResolvedValue({ conflicts: true, error: 'dirty tree' });
        const { result } = setup();
        // The picker dialog needs the rejection to show its own error state, and
        // the tab needs the banner — so the action does both.
        let thrown: unknown;
        await act(async () => {
            await result.current.cherryPickToBranch([commit('aaaaaaaaaaaa')], 'main').catch(e => { thrown = e; });
        });
        expect((thrown as Error).message).toBe('dirty tree');
        expect(result.current.actionError).toBe('dirty tree');
    });

    it('sorts a selection oldest-first using the loaded list order', () => {
        const a = commit('aaaaaaaaaaaa');
        const b = commit('bbbbbbbbbbbb');
        const c = commit('cccccccccccc');
        const { result } = setup({ commits: [a, b, c] });
        // Newest-first list ⇒ c is the oldest of the three.
        expect(result.current.orderOldestFirst([a, c, b])).toEqual([c, b, a]);
    });

    it('sends the reordered unpushed commits oldest-first', async () => {
        const a = commit('aaaaaaaaaaaa');
        const b = commit('bbbbbbbbbbbb');
        const { result, showToast, setPendingReorder } = setup({
            commits: [a, b], unpushedCount: 2, pendingReorder: [b, a],
        });
        await act(async () => { await result.current.applyReorder(); });
        expect(clientFor(WS).git.rebaseReorder).toHaveBeenCalledWith(WS, [a.hash, b.hash]);
        expect(showToast).toHaveBeenCalledWith('Reorder started');
        expect(setPendingReorder).toHaveBeenCalledWith(null);
    });

    it('picks the merge endpoints for a merge conflict and rebase otherwise', async () => {
        const merge = setup({ repoState: { operation: 'merge', conflictFiles: ['a.ts'] } });
        await act(async () => { await merge.result.current.conflictContinue(); });
        expect(clientFor(WS).git.mergeContinue).toHaveBeenCalledWith(WS);

        const rebase = setup({ repoState: { operation: 'rebase', conflictFiles: ['a.ts'] } });
        await act(async () => { await rebase.result.current.conflictContinue(); });
        expect(clientFor(WS).git.rebaseContinue).toHaveBeenCalledWith(WS);
    });

    it('confirms before aborting an in-progress operation', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const { result } = setup({ repoState: { operation: 'rebase', conflictFiles: [] } });
        await act(async () => { await result.current.conflictAbort(); });
        expect(clientFor(WS).git.rebaseAbort).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});

describe('useGitAutoPullController', () => {
    function setup(overrides: { workspaceId?: string } = {}) {
        return renderHook(() => useGitAutoPullController({ workspaceId: overrides.workspaceId ?? WS }));
    }

    it('reads the persisted per-repo setting from the selected clone', async () => {
        clientFor(WS).preferences.getRepo.mockResolvedValue({
            autoPull: { enabled: true, intervalMinutes: 5 },
        });
        const { result } = setup();
        await waitFor(() => expect(result.current.autoPull).toEqual({ enabled: true, intervalMinutes: 5 }));
        expect(clientFor(WS).preferences.getRepo).toHaveBeenCalledWith(WS);
    });

    it('leaves auto-pull undefined when the repo has no setting', async () => {
        const { result } = setup();
        await act(async () => { await Promise.resolve(); });
        expect(result.current.autoPull).toBeUndefined();
    });

    it('persists an interval change and reflects it immediately', async () => {
        const { result } = setup();
        const next = { enabled: true, intervalMinutes: 10 };
        act(() => result.current.setAutoPull(next as any));
        expect(result.current.autoPull).toEqual(next);
        expect(clientFor(WS).preferences.patchRepo).toHaveBeenCalledWith(WS, { autoPull: next });
    });

    it('swallows a preferences write failure so the UI keeps the new value', async () => {
        clientFor(WS).preferences.patchRepo.mockRejectedValue(new Error('offline'));
        const { result } = setup();
        act(() => result.current.setAutoPull({ enabled: false } as any));
        await act(async () => { await Promise.resolve(); });
        expect(result.current.autoPull).toEqual({ enabled: false });
    });

    it('reads the server-owned schedule and last run (AC-05)', async () => {
        clientFor(WS).git.getAutoPullStatus.mockResolvedValue({
            enabled: true, intervalMinutes: 30,
            nextRunAt: '2026-01-01T00:30:00.000Z',
            lastRunAt: '2026-01-01T00:00:00.000Z',
            outcome: 'skipped-dirty',
            message: 'uncommitted changes',
        });
        const { result } = setup();
        await waitFor(() => expect(result.current.autoPullStatus?.outcome).toBe('skipped-dirty'));
        expect(clientFor(WS).git.getAutoPullStatus).toHaveBeenCalledWith(WS);
        expect(result.current.autoPullStatus?.nextRunAt).toBe('2026-01-01T00:30:00.000Z');
    });

    it('swallows a status read failure and leaves the status undefined', async () => {
        clientFor(WS).git.getAutoPullStatus.mockRejectedValue(new Error('offline'));
        const { result } = setup();
        await act(async () => { await Promise.resolve(); });
        expect(result.current.autoPullStatus).toBeUndefined();
    });

    it('re-reads the status on demand', async () => {
        const { result } = setup();
        await waitFor(() => expect(clientFor(WS).git.getAutoPullStatus).toHaveBeenCalledTimes(1));
        act(() => result.current.refreshStatus());
        expect(clientFor(WS).git.getAutoPullStatus).toHaveBeenCalledTimes(2);
    });

    it('never initiates a pull, however long the interval runs (AC-06)', async () => {
        vi.useFakeTimers();
        try {
            clientFor(WS).preferences.getRepo.mockResolvedValue({
                autoPull: { enabled: true, intervalMinutes: 1 },
            });
            setup();
            await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
            expect(clientFor(WS).git.pull).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });
});

describe('useGitSkillActions', () => {
    const repoState = { operation: 'rebase', conflictFiles: ['src/a.ts'] };

    // Squash matches by object identity, so the hook and the test must share
    // the same commit instances.
    const commits = [commit('aaaaaaa1'), commit('bbbbbbb2')];

    function renderSkillActions(state: any = repoState) {
        const showToast = vi.fn();
        const view = renderHook(() => useGitSkillActions({
            workspaceId: WS,
            workspaceRootPath: '/repo',
            commits,
            unpushedCount: 2,
            branchRangeData: null,
            branchName: 'feature',
            resolvedBaseRef: 'origin/main',
            repoState: state,
            showToast,
        }));
        return { view, showToast, enqueue: clientFor(WS).queue.enqueue };
    }

    // Regression: conflict resolution used to enqueue with no config at all, so
    // the job silently inherited the server's default tier.
    it('enqueues conflict resolution at the medium effort tier', async () => {
        const { view, enqueue } = renderSkillActions();

        await act(async () => { await view.result.current.resolveConflictsWithAI(); });

        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0][0].config).toEqual({ effortTier: 'medium' });
    });

    it('skips the enqueue when no operation is in progress', async () => {
        const { view, enqueue } = renderSkillActions({ ...repoState, operation: 'none' });

        await act(async () => { await view.result.current.resolveConflictsWithAI(); });

        expect(enqueue).not.toHaveBeenCalled();
    });

    it('omits config and context when a job carries no AI selection or skill', async () => {
        const { view, enqueue } = renderSkillActions();

        await act(async () => {
            await view.result.current.squashCommits(commits);
        });

        const task = enqueue.mock.calls[0][0];
        expect(task.config).toBeUndefined();
        expect(task.payload.context).toBeUndefined();
        expect(task.payload.workspaceId).toBe(WS);
    });

    it('passes a confirmed skill run\'s model, tier and skill through to the queue', async () => {
        const { view, enqueue } = renderSkillActions();

        act(() => {
            view.result.current.startSkillRun('code-review', { type: 'commit', commit: commits[0] });
        });
        await act(async () => {
            await view.result.current.confirmSkillRun('extra notes', {
                provider: 'claude', model: 'claude-opus-5', effortTier: 'high',
            });
        });

        const task = enqueue.mock.calls[0][0];
        expect(task.config).toEqual({ model: 'claude-opus-5', effortTier: 'high' });
        expect(task.payload.provider).toBe('claude');
        expect(task.payload.context).toEqual({ skills: ['code-review'] });
        expect(task.payload.prompt).toContain('extra notes');
    });

    it('flags auto provider routing in the payload context', async () => {
        const { view, enqueue } = renderSkillActions();

        act(() => {
            view.result.current.startSkillRun('code-review', { type: 'commit', commit: commits[0] });
        });
        await act(async () => {
            await view.result.current.confirmSkillRun('', { autoProviderRouting: true });
        });

        expect(enqueue.mock.calls[0][0].payload.context).toEqual({
            skills: ['code-review'],
            autoProviderRouting: { requested: true },
        });
    });
});
