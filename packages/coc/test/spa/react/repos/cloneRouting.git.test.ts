/**
 * AC-07 — per-clone routing for the git DIFF-VIEWING layer.
 *
 * The working-tree file list, single-file diffs, and diff-comment fetches must
 * land on a remote clone's OWN server (its baseUrl), and a local clone's on the
 * default origin — with NO local fallthrough for remote clones. We mock the
 * client factory so each clone resolves to a tagged stub and assert the call
 * landed on the right one.
 *
 * Mirrors cloneRouting.tabs.test.ts (explorer/notes/activity) for the git tab.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';

// ── Mock the client factory layer ────────────────────────────────────────────
// getSpaCocClient → the LOCAL stub; getCocClientFor(baseUrl) → a per-baseUrl stub.
// Each stub records which baseUrl handled a call so tests can assert routing.

interface StubClient {
    baseUrl: string;
    git: Record<string, ReturnType<typeof vi.fn>>;
    preferences: Record<string, ReturnType<typeof vi.fn>>;
    queue: Record<string, ReturnType<typeof vi.fn>>;
    request: ReturnType<typeof vi.fn>;
}

const stubsByBaseUrl = new Map<string, StubClient>();

function makeStub(baseUrl: string): StubClient {
    return {
        baseUrl,
        git: {
            getWorkingTreeChanges: vi.fn(async () => ({ changes: [], baseUrl })),
            getWorkingTreeFileDiff: vi.fn(async () => ({ diff: `diff@${baseUrl}`, truncated: false, totalLines: 0 })),
            listDiffComments: vi.fn(async () => ({ comments: [], baseUrl })),
            getDiffCommentCounts: vi.fn(async () => ({ counts: {} })),
            getDiffCommentTotals: vi.fn(async () => ({ totals: {} })),
            // Path builders are pure — return a stable relative path regardless of stub.
            commitFileDiffPath: vi.fn((ws: string, hash: string, fp: string) =>
                `/workspaces/${ws}/git/commits/${hash}/files/${encodeURIComponent(fp)}/diff`),
            commitDiffPath: vi.fn((ws: string, hash: string) =>
                `/workspaces/${ws}/git/commits/${hash}/diff`),
            branchRangeFileDiffPath: vi.fn((ws: string, fp: string) =>
                `/workspaces/${ws}/git/branch-range/files/${encodeURIComponent(fp)}/diff`),
            stageFile: vi.fn(async () => ({ success: true, baseUrl })),
            getCommitChatBinding: vi.fn(async () => ({ taskId: `task@${baseUrl}` })),
            createCommitChatBinding: vi.fn(async () => ({})),
            startFreshCommitChat: vi.fn(async () => ({})),
        },
        preferences: {
            getRepo: vi.fn(async () => ({ filesViewMode: 'flat' })),
            updateRepo: vi.fn(async () => ({})),
        },
        queue: {
            enqueue: vi.fn(async () => ({ task: { id: `queued@${baseUrl}` } })),
        },
        // The generic transport used by requestForWorkspace (diff fetches).
        request: vi.fn(async (path: string) => ({ diff: `body@${baseUrl}:${path}`, truncated: false, totalLines: 0 })),
    };
}

const LOCAL = makeStub('LOCAL');

function clientFor(baseUrl?: string): StubClient {
    if (!baseUrl) return LOCAL;
    let stub = stubsByBaseUrl.get(baseUrl);
    if (!stub) {
        stub = makeStub(baseUrl);
        stubsByBaseUrl.set(baseUrl, stub);
    }
    return stub;
}

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: (baseUrl?: string) => clientFor(baseUrl),
    // cloneRegistry imports these; keep them passthrough so requestForWorkspace's
    // error translation and option mapping behave like production.
    toSpaCocRequestOptions: (opts?: unknown) => opts,
    translateSpaCocClientError: (e: unknown) => { throw e; },
}));

// cloneRegistry reads getApiBase().
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

// Import after mocks.
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
    getCocClientForWorkspace,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { useCocClient } from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { fetchDiffFromSource } from '../../../../src/server/spa/client/react/features/git/diff/diffSource';
import { createElement } from 'react';
import { WorkingTree } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';
import { useCommitChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitChatBinding';
import { usePrChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/usePrChatBinding';
import { useFilesViewMode } from '../../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode';

const REMOTE_WS = 'remote-ws';
const REMOTE_URL = 'http://127.0.0.1:4000';
const LOCAL_WS = 'local-ws';

function clearAllMocks(stub: StubClient): void {
    for (const fn of Object.values(stub.git)) fn.mockClear();
    for (const fn of Object.values(stub.preferences)) fn.mockClear();
    for (const fn of Object.values(stub.queue)) fn.mockClear();
    stub.request.mockClear();
}

beforeEach(() => {
    resetCloneRegistryForTests();
    stubsByBaseUrl.clear();
    clearAllMocks(LOCAL);
    registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

// ── Working-tree file list (WorkingTree.getWorkingTreeChanges) ─────────────────

describe('Working-tree changes routing (useCocClient)', () => {
    it('loads a remote clone working-tree change list from the REMOTE server', async () => {
        const { result } = renderHook(() => useCocClient(REMOTE_WS));
        const client = result.current as unknown as StubClient;

        await client.git.getWorkingTreeChanges(REMOTE_WS);

        expect(clientFor(REMOTE_URL).git.getWorkingTreeChanges).toHaveBeenCalledWith(REMOTE_WS);
        // No local fallthrough for a remote clone.
        expect(LOCAL.git.getWorkingTreeChanges).not.toHaveBeenCalled();
    });

    it('loads a LOCAL clone working-tree change list from the default origin client', async () => {
        const { result } = renderHook(() => useCocClient(LOCAL_WS));
        const client = result.current as unknown as StubClient;

        await client.git.getWorkingTreeChanges(LOCAL_WS);

        expect(LOCAL.git.getWorkingTreeChanges).toHaveBeenCalledWith(LOCAL_WS);
        // The remote server stub must not even be created for a local id.
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── Working-tree comment list (listDiffComments) ──────────────────────────────

describe('Working-tree comment routing (useCocClient)', () => {
    it('reads a remote clone working-tree comments from the REMOTE server', async () => {
        const { result } = renderHook(() => useCocClient(REMOTE_WS));
        const client = result.current as unknown as StubClient;

        await client.git.listDiffComments(REMOTE_WS, { newRef: 'working-tree' });

        expect(clientFor(REMOTE_URL).git.listDiffComments).toHaveBeenCalledWith(REMOTE_WS, { newRef: 'working-tree' });
        expect(LOCAL.git.listDiffComments).not.toHaveBeenCalled();
    });
});

// ── Single-file diff fetch (fetchDiffFromSource → requestForWorkspace) ─────────

describe('Diff fetch routing (fetchDiffFromSource)', () => {
    it('fetches a remote clone diff from the REMOTE server (no local fallthrough)', async () => {
        const url = `/workspaces/${REMOTE_WS}/git/commits/abc123/files/src%2Ffoo.ts/diff`;
        const result = await fetchDiffFromSource(REMOTE_WS, url);

        const remote = clientFor(REMOTE_URL);
        expect(remote.request).toHaveBeenCalledWith(url, undefined);
        expect(result.diff).toBe(`body@${REMOTE_URL}:${url}`);
        // Must NOT hit the default origin client for a remote clone.
        expect(LOCAL.request).not.toHaveBeenCalled();
    });

    it('fetches a LOCAL clone diff from the default origin client', async () => {
        const url = `/workspaces/${LOCAL_WS}/git/commits/abc123/files/src%2Ffoo.ts/diff`;
        const result = await fetchDiffFromSource(LOCAL_WS, url);

        expect(LOCAL.request).toHaveBeenCalledWith(url, undefined);
        expect(result.diff).toBe(`body@LOCAL:${url}`);
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── Non-hook seam used by WorkingTree's siblings (getCocClientForWorkspace) ────

describe('Working-tree action routing (getCocClientForWorkspace)', () => {
    it('routes a remote clone stage-file action to the REMOTE server', async () => {
        await getCocClientForWorkspace(REMOTE_WS).git.stageFile(REMOTE_WS, 'a.ts');
        expect(clientFor(REMOTE_URL).git.stageFile).toHaveBeenCalledWith(REMOTE_WS, 'a.ts');
        expect(LOCAL.git.stageFile).not.toHaveBeenCalled();
    });

    it('routes a LOCAL clone stage-file action to the default origin client', async () => {
        await getCocClientForWorkspace(LOCAL_WS).git.stageFile(LOCAL_WS, 'a.ts');
        expect(LOCAL.git.stageFile).toHaveBeenCalledWith(LOCAL_WS, 'a.ts');
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── Commit chat binding (useCommitChatBinding) ────────────────────────────────
// The commit chat panel was the last git surface still on the local singleton:
// against a remote clone every call 404'd "Workspace not found".

describe('Commit chat routing (useCommitChatBinding)', () => {
    it('reads, creates, and freshens a remote clone commit chat on the REMOTE server', async () => {
        const { result } = renderHook(() => useCommitChatBinding({
            workspaceId: REMOTE_WS,
            commitHash: 'abc123',
            commitMessage: 'fix: bug',
        }));

        const remote = clientFor(REMOTE_URL);
        await waitFor(() => expect(result.current.taskId).toBe(`task@${REMOTE_URL}`));
        expect(remote.git.getCommitChatBinding).toHaveBeenCalledWith(REMOTE_WS, 'abc123');

        await act(async () => {
            await result.current.createChat('review this');
        });
        expect(remote.queue.enqueue).toHaveBeenCalled();
        expect(remote.git.createCommitChatBinding).toHaveBeenCalledWith(REMOTE_WS, 'abc123', `queued@${REMOTE_URL}`);

        await act(async () => {
            await result.current.startFreshChat();
        });
        expect(remote.git.startFreshCommitChat).toHaveBeenCalledWith(REMOTE_WS, 'abc123');

        // No local fallthrough — the local server has no such workspace.
        expect(LOCAL.git.getCommitChatBinding).not.toHaveBeenCalled();
        expect(LOCAL.queue.enqueue).not.toHaveBeenCalled();
        expect(LOCAL.git.createCommitChatBinding).not.toHaveBeenCalled();
        expect(LOCAL.git.startFreshCommitChat).not.toHaveBeenCalled();
        expect(result.current.error).toBeNull();
    });

    it('keeps a LOCAL clone commit chat on the default origin client', async () => {
        const { result } = renderHook(() => useCommitChatBinding({
            workspaceId: LOCAL_WS,
            commitHash: 'abc123',
        }));

        await waitFor(() => expect(result.current.taskId).toBe('task@LOCAL'));
        expect(LOCAL.git.getCommitChatBinding).toHaveBeenCalledWith(LOCAL_WS, 'abc123');

        await act(async () => {
            await result.current.createChat('review this');
        });
        expect(LOCAL.queue.enqueue).toHaveBeenCalled();
        expect(LOCAL.git.createCommitChatBinding).toHaveBeenCalledWith(LOCAL_WS, 'abc123', 'queued@LOCAL');
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── PR chat binding (usePrChatBinding) ────────────────────────────────────────

describe('PR chat routing (usePrChatBinding)', () => {
    it('enqueues a remote clone PR chat on the REMOTE server', async () => {
        const { result } = renderHook(() => usePrChatBinding({ workspaceId: REMOTE_WS, prId: 'pr-1' }));

        await act(async () => {
            await result.current.createChat('review this PR');
        });

        expect(clientFor(REMOTE_URL).queue.enqueue).toHaveBeenCalled();
        expect(LOCAL.queue.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues a LOCAL clone PR chat on the default origin client', async () => {
        const { result } = renderHook(() => usePrChatBinding({ workspaceId: LOCAL_WS, prId: 'pr-1' }));

        await act(async () => {
            await result.current.createChat('review this PR');
        });

        expect(LOCAL.queue.enqueue).toHaveBeenCalled();
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── Files view-mode preference (useFilesViewMode) ─────────────────────────────

describe('Files view-mode preference routing (useFilesViewMode)', () => {
    it('reads and writes a remote clone preference on the REMOTE server', async () => {
        const { result } = renderHook(() => useFilesViewMode(REMOTE_WS));
        const remote = clientFor(REMOTE_URL);

        await waitFor(() => expect(result.current.mode).toBe('flat'));
        expect(remote.preferences.getRepo).toHaveBeenCalledWith(REMOTE_WS);

        await act(async () => {
            result.current.setMode('tree');
        });
        expect(remote.preferences.updateRepo).toHaveBeenCalledWith(REMOTE_WS, { filesViewMode: 'tree' });
        expect(LOCAL.preferences.getRepo).not.toHaveBeenCalled();
        expect(LOCAL.preferences.updateRepo).not.toHaveBeenCalled();
    });

    it('reads and writes a LOCAL clone preference on the default origin client', async () => {
        const { result } = renderHook(() => useFilesViewMode(LOCAL_WS));

        await waitFor(() => expect(LOCAL.preferences.getRepo).toHaveBeenCalledWith(LOCAL_WS));

        await act(async () => {
            result.current.setMode('flat');
        });
        expect(LOCAL.preferences.updateRepo).toHaveBeenCalledWith(LOCAL_WS, { filesViewMode: 'flat' });
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});

// ── End-to-end: the real WorkingTree component wires the clone client ──────────

describe('WorkingTree component routing (end-to-end)', () => {
    it('fetches a remote clone working-tree from the REMOTE server on mount', async () => {
        render(createElement(WorkingTree, { workspaceId: REMOTE_WS }));

        await waitFor(() =>
            expect(clientFor(REMOTE_URL).git.getWorkingTreeChanges).toHaveBeenCalledWith(REMOTE_WS),
        );
        // The comment-count badge fetch also routes to the remote server.
        await waitFor(() =>
            expect(clientFor(REMOTE_URL).git.listDiffComments).toHaveBeenCalledWith(REMOTE_WS, { newRef: 'working-tree' }),
        );
        // No local fallthrough for a remote clone.
        expect(LOCAL.git.getWorkingTreeChanges).not.toHaveBeenCalled();
        expect(LOCAL.git.listDiffComments).not.toHaveBeenCalled();
    });

    it('fetches a LOCAL clone working-tree from the default origin client on mount', async () => {
        render(createElement(WorkingTree, { workspaceId: LOCAL_WS }));

        await waitFor(() =>
            expect(LOCAL.git.getWorkingTreeChanges).toHaveBeenCalledWith(LOCAL_WS),
        );
        // The remote server stub must not be created for a local id.
        expect(stubsByBaseUrl.has(REMOTE_URL)).toBe(false);
    });
});
