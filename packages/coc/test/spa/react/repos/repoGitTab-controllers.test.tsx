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
let appState: any = { workspaces: [], selectedGitCommitHash: null, selectedGitFilePath: null };

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isGitCommitLookupEnabled: () => lookupEnabled,
    isGitCrossCloneCherryPickEnabled: () => false,
}));
let lookupEnabled = true;

import { useRepoGitData } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useRepoGitData';
import { useRepoGitSelection } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useRepoGitSelection';
import { useGitOperationActions } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitOperationActions';
import { useGitAutoPullController } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitAutoPullController';
import { useGitOperationPoller } from '../../../../src/server/spa/client/react/features/git/hooks/useGitOperationPoller';
import { clearCommitsCache } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitsCache';
import { clearBranchRangeCache } from '../../../../src/server/spa/client/react/features/git/hooks/useBranchRangeCache';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { RightPanelView } from '../../../../src/server/spa/client/react/features/git/repoGitTab/types';

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
    appState = { workspaces: [], selectedGitCommitHash: null, selectedGitFilePath: null };
    lookupEnabled = true;
    localStorage.clear();
    clearCommitsCache(WS); clearCommitsCache(OTHER_WS);
    clearBranchRangeCache(WS); clearBranchRangeCache(OTHER_WS);
    location.hash = '';
});

describe('useRepoGitData', () => {
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

describe('useRepoGitSelection', () => {
    function setup(commits: GitCommitItem[] = [], loading = false) {
        return renderHook(() => useRepoGitSelection({ workspaceId: WS, commits, loading }));
    }

    it('writes the URL hash and the AppContext fields when a commit is selected', () => {
        const a = commit('aaaaaaaaaaaa');
        const { result } = setup([a]);
        act(() => result.current.selectCommit(a));

        expect(result.current.view).toEqual({ type: 'commit', commit: a });
        expect(location.hash).toBe(`#repos/${WS}/git/${a.hash}`);
        expect(appDispatch).toHaveBeenCalledWith({ type: 'SET_GIT_COMMIT_HASH', hash: a.hash });
        expect(appDispatch).toHaveBeenCalledWith({ type: 'CLEAR_GIT_FILE_PATH' });
    });

    it('encodes the file path in branch-range and commit file links', () => {
        const { result } = setup();
        act(() => result.current.selectBranchFile('src/a b.ts'));
        expect(location.hash).toBe(`#repos/${WS}/git/branch-range/${encodeURIComponent('src/a b.ts')}`);

        act(() => result.current.selectCommitFile('aaaaaaaaaaaa', 'src/a b.ts'));
        expect(location.hash).toBe(`#repos/${WS}/git/aaaaaaaaaaaa/${encodeURIComponent('src/a b.ts')}`);
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

    it('keeps the current stage when navigating within the working tree', () => {
        const { result } = setup();
        act(() => result.current.selectWorkingTreeFile('a.ts', 'staged'));
        act(() => result.current.navigateToWorkingTreeFile('b.ts', 'last'));
        expect(result.current.view).toEqual({ type: 'working-tree-file', filePath: 'b.ts', stage: 'staged' });
        expect(result.current.hunkTarget).toBe('last');
    });

    describe('deep links', () => {
        it('opens the branch range for the branch-range sentinel', () => {
            appState = { ...appState, selectedGitCommitHash: 'branch-range' };
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([]));
            expect(result.current.view).toEqual({ type: 'branch-range' });
        });

        it('opens a branch-range file when the link carries a path', () => {
            appState = { ...appState, selectedGitCommitHash: 'branch-range', selectedGitFilePath: 'src/a.ts' };
            const { result } = setup();
            act(() => result.current.hydrateFromInitialLoad([]));
            expect(result.current.view).toEqual({ type: 'branch-file', filePath: 'src/a.ts' });
        });

        it('opens a loaded commit by hash prefix', () => {
            const a = commit('aaaaaaaaaaaa');
            appState = { ...appState, selectedGitCommitHash: 'aaaaaaa' };
            const { result } = setup([a]);
            act(() => result.current.hydrateFromInitialLoad([a]));
            expect(result.current.view).toEqual({ type: 'commit', commit: a });
        });

        it('falls back to a direct lookup when the SHA is not in the loaded page', async () => {
            const remote = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockResolvedValue(remote);
            appState = { ...appState, selectedGitCommitHash: 'ffffffffffff' };
            const { result } = setup([]);

            act(() => result.current.hydrateFromInitialLoad([]));
            await waitFor(() => expect(result.current.openedCommit).toEqual(remote));
            expect(clientFor(WS).git.getCommit).toHaveBeenCalledWith(WS, 'ffffffffffff');
            expect(result.current.view).toEqual({ type: 'commit', commit: remote });
        });

        it('reports a lookup miss instead of changing the view', async () => {
            clientFor(WS).git.getCommit.mockRejectedValue(new Error('not found'));
            appState = { ...appState, selectedGitCommitHash: 'ffffffffffff' };
            const { result } = setup([]);

            act(() => result.current.hydrateFromInitialLoad([]));
            await waitFor(() => expect(result.current.commitLookupError).toBe('Commit not found'));
            expect(result.current.view).toBeNull();
        });

        it('does not look up a non-SHA deep link', () => {
            appState = { ...appState, selectedGitCommitHash: 'not-a-sha' };
            const { result } = setup([]);
            act(() => result.current.hydrateFromInitialLoad([]));
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
            expect(result.current.view).toBeNull();
        });

        it('does not look up when the feature flag is off', () => {
            lookupEnabled = false;
            appState = { ...appState, selectedGitCommitHash: 'ffffffffffff' };
            const { result } = setup([]);
            act(() => result.current.hydrateFromInitialLoad([]));
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
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

        it('fetches an unloaded commit and updates the URL on success', async () => {
            const remote = commit('ffffffffffff');
            clientFor(WS).git.getCommit.mockResolvedValue(remote);
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(result.current.openedCommit).toEqual(remote);
            expect(location.hash).toBe(`#repos/${WS}/git/${remote.hash}`);
        });

        it('leaves the URL untouched when the lookup fails', async () => {
            clientFor(WS).git.getCommit.mockRejectedValue(new Error('ambiguous'));
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('ffffffffffff'); });
            expect(result.current.commitLookupError).toBe('Commit not found or ambiguous SHA');
            expect(location.hash).toBe('');
        });

        it('ignores a query that is not SHA-shaped', async () => {
            const { result } = setup([]);
            await act(async () => { await result.current.lookupCommit('fix typo'); });
            expect(clientFor(WS).git.getCommit).not.toHaveBeenCalled();
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
    function setup(overrides: Partial<Parameters<typeof useGitAutoPullController>[0]> = {}) {
        const refreshAll = overrides.refreshAll ?? vi.fn();
        const showToast = overrides.showToast ?? vi.fn();
        const setPulling = overrides.setPulling ?? vi.fn();
        const hook = renderHook(() => {
            const { start, stop, isPolling, activeJobId } = useGitOperationPoller(WS);
            const pullPoller = useMemo(
                () => ({ start, stop, isPolling, activeJobId }),
                [start, stop, isPolling, activeJobId],
            );
            const options = useMemo(() => ({
                workspaceId: WS, pulling: false, setPulling, refreshAll, showToast,
                ...overrides, pullPoller,
            }), [pullPoller]);
            return useGitAutoPullController(options as any);
        });
        return { ...hook, refreshAll, showToast, setPulling };
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

    it('exposes a countdown reset for manual pulls', () => {
        const { result } = setup();
        expect(() => act(() => result.current.resetCountdown())).not.toThrow();
    });

    it('reports an auto-pull skip through the toast, not the action banner', async () => {
        vi.useFakeTimers();
        try {
            // A dirty working tree makes the tick skip instead of pulling.
            clientFor(WS).git.getWorkingTreeChanges.mockResolvedValue({
                changes: [{ path: 'a.ts', stage: 'unstaged' }],
            });
            clientFor(WS).preferences.getRepo.mockResolvedValue({
                autoPull: { enabled: true, intervalMinutes: 1 },
            });
            const showToast = vi.fn();
            const { result } = setup({ showToast });
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(result.current.autoPull?.enabled).toBe(true);

            await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
            expect(showToast).toHaveBeenCalled();
            // Advisory toasts linger longer than success toasts.
            expect(showToast.mock.calls[0][1]).toBe(5000);
            expect(clientFor(WS).git.pull).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('reports an auto-pull job failure through the toast and still refreshes', async () => {
        vi.useFakeTimers();
        try {
            clientFor(WS).git.pull.mockResolvedValue({ jobId: 'auto-1' });
            clientFor(WS).git.getOperation.mockResolvedValue({
                id: 'auto-1', status: 'failed', error: 'non-fast-forward',
            });
            clientFor(WS).preferences.getRepo.mockResolvedValue({
                autoPull: { enabled: true, intervalMinutes: 1 },
            });
            const showToast = vi.fn();
            const refreshAll = vi.fn();
            const { result } = setup({ showToast, refreshAll });
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(result.current.autoPull?.enabled).toBe(true);

            await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
            expect(clientFor(WS).git.pull).toHaveBeenCalled();

            await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
            expect(showToast).toHaveBeenCalled();
            expect(refreshAll).toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('never arms a timer while auto-pull is disabled', async () => {
        vi.useFakeTimers();
        try {
            clientFor(WS).preferences.getRepo.mockResolvedValue({
                autoPull: { enabled: false, intervalMinutes: 1 },
            });
            setup();
            await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
            expect(clientFor(WS).git.pull).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });
});
