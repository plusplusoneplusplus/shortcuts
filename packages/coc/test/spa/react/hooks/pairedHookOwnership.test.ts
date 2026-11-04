/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
    const makeClient = () => ({
        preferences: { getRepo: vi.fn(), getGlobal: vi.fn(), patchRepo: vi.fn(), patchGlobal: vi.fn() },
        queue: { enqueue: vi.fn(), getTask: vi.fn() },
        pullRequests: {
            getChatBindingForOrigin: vi.fn(),
            createChatBindingForOrigin: vi.fn(),
            startFreshChatForOrigin: vi.fn(),
        },
        git: { listDiffComments: vi.fn(), createDiffComment: vi.fn(), askDiffCommentAI: vi.fn() },
        tasks: {
            listComments: vi.fn(), getCommentCounts: vi.fn(), createComment: vi.fn(),
            updateComment: vi.fn(), deleteComment: vi.fn(), askCommentAI: vi.fn(),
        },
    });
    const local = makeClient();
    const remote = makeClient();
    return { local, remote, active: local, patch: vi.fn(), remove: vi.fn() };
});

vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => state.active,
    useCloneBaseUrl: () => state.active === state.remote ? 'https://remote.example' : undefined,
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => state.local,
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));
vi.mock('../../../../src/server/spa/client/react/api/repoPreferences', () => ({
    getRepoPreferences: (client: typeof state.local, wsId: string) => client.preferences.getRepo(wsId),
    patchRepoPreferences: (client: typeof state.local, wsId: string, patch: unknown) => client.preferences.patchRepo(wsId, patch),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffSource', () => ({
    getGitReviewClient: () => state.active,
}));
vi.mock('../../../../src/server/spa/client/react/utils/diffCommentApi', () => ({
    computeStorageKey: async () => 'storage-key',
    patchDiffComment: (...args: unknown[]) => state.patch(...args),
    deleteDiffCommentById: (...args: unknown[]) => state.remove(...args),
}));

import { useScriptTemplates } from '../../../../src/server/spa/client/react/features/templates/hooks/useScriptTemplates';
import { useSkillTemplates } from '../../../../src/server/spa/client/react/features/templates/hooks/useSkillTemplates';
import { usePrChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/usePrChatBinding';
import { usePullRequestChatBinding } from '../../../../src/server/spa/client/react/features/pull-requests/hooks/usePullRequestChatBinding';
import { useDiffComments } from '../../../../src/server/spa/client/react/features/git/hooks/useDiffComments';
import { useTaskComments } from '../../../../src/server/spa/client/react/tasks/hooks/useTaskComments';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

class Socket {
    static instances: Socket[] = [];
    readonly sent: string[] = [];
    closed = false;
    private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
    constructor(readonly url: string) { Socket.instances.push(this); }
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    send(value: string) { this.sent.push(value); }
    close() { this.closed = true; }
    emit(type: string, value?: unknown) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(new MessageEvent(type, { data: typeof value === 'string' ? value : JSON.stringify(value) }));
        }
    }
}

const context = { repositoryId: 'repo', oldRef: 'base', newRef: 'head', filePath: 'file.ts' };
const selection = { diffLineStart: 1, diffLineEnd: 1, side: 'added' as const, startColumn: 0, endColumn: 4 };
const comment = {
    id: 'comment', context, selection, selectedText: 'text', comment: 'review', status: 'open' as const,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const taskComment = {
    id: 'comment', taskId: 'task',
    selection: { startLine: 1, endLine: 1, startColumn: 0, endColumn: 4 },
    selectedText: 'text', comment: 'review', status: 'open' as const,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
    vi.clearAllMocks();
    state.active = state.local;
    localStorage.clear();
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
    for (const client of [state.local, state.remote]) {
        client.preferences.getRepo.mockResolvedValue({});
        client.preferences.getGlobal.mockResolvedValue({});
        client.preferences.patchRepo.mockResolvedValue({});
        client.preferences.patchGlobal.mockResolvedValue({});
        client.queue.enqueue.mockResolvedValue({ task: { id: 'chat' } });
        client.pullRequests.getChatBindingForOrigin.mockResolvedValue({ taskId: null });
        client.pullRequests.createChatBindingForOrigin.mockResolvedValue({});
        client.pullRequests.startFreshChatForOrigin.mockResolvedValue({});
        client.git.listDiffComments.mockResolvedValue({ comments: [] });
        client.tasks.listComments.mockResolvedValue([]);
        client.tasks.getCommentCounts.mockResolvedValue({});
    }
});

afterEach(() => vi.unstubAllGlobals());

describe('paired template mechanics', () => {
    it('keeps script update semantics, optional script fields, and skill post-actions distinct', async () => {
        const script = { id: 'script', name: 'Run', scriptPath: './run.sh', pauseOnFailure: false, args: '--check' };
        const skill = { id: 'skill', model: '', mode: 'task', skills: ['impl'], postActions: [{ type: 'skill', skillName: 'review', prompt: 'inspect' }] };
        state.local.preferences.getRepo.mockResolvedValue({ scriptTemplates: [script], skillTemplates: [skill] });
        const scripts = renderHook(() => useScriptTemplates('workspace'));
        const skills = renderHook(() => useSkillTemplates('workspace'));
        await waitFor(() => expect(scripts.result.current.loaded && skills.result.current.loaded).toBe(true));
        expect(scripts.result.current.templates).toEqual([script]);
        expect(skills.result.current.templates).toEqual([skill]);
        expect(skills.result.current).not.toHaveProperty('updateTemplate');
        act(() => scripts.result.current.updateTemplate('script', { args: '--new' }));
        expect(state.local.preferences.patchRepo).toHaveBeenLastCalledWith('workspace', {
            scriptTemplates: [{ ...script, args: '--new' }],
        });
        act(() => skills.result.current.deleteTemplate('skill'));
        expect(state.local.preferences.patchRepo).toHaveBeenLastCalledWith('workspace', { skillTemplates: [] });
    });

    it('clears on owner change and ignores stale loads and stale persistence failures', async () => {
        const load = deferred<Record<string, unknown>>();
        state.local.preferences.getRepo.mockReturnValue(load.promise);
        const { result, rerender } = renderHook(() => useScriptTemplates('workspace'));
        state.active = state.remote;
        rerender();
        await waitFor(() => expect(result.current.loaded).toBe(true));
        await act(async () => load.resolve({ scriptTemplates: [{ id: 'old', name: 'Old', scriptPath: './old.sh' }] }));
        expect(result.current.templates).toEqual([]);
        const save = deferred<Record<string, unknown>>();
        state.remote.preferences.patchRepo.mockReturnValue(save.promise);
        act(() => result.current.saveTemplate({ name: 'Remote', scriptPath: './remote.sh' }));
        state.active = state.local;
        state.local.preferences.getRepo.mockResolvedValue({});
        rerender();
        await waitFor(() => expect(result.current.loaded).toBe(true));
        await act(async () => save.reject(new Error('old owner save')));
        expect(result.current.error).toBeNull();
        expect(result.current.templates).toEqual([]);
    });

    it('uses global preferences without a workspace and reports load and save errors', async () => {
        state.local.preferences.getGlobal.mockRejectedValueOnce(new Error('load failed'));
        const { result } = renderHook(() => useSkillTemplates());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.error).toBe('load failed');
        state.local.preferences.patchGlobal.mockRejectedValueOnce(new Error('save failed'));
        act(() => result.current.saveTemplate({ model: '', mode: 'ask', skills: [] }));
        await waitFor(() => expect(result.current.error).toBe('save failed'));
        expect(result.current.templates).toHaveLength(1);
        expect(state.local.preferences.patchRepo).not.toHaveBeenCalled();
    });

    it('ignores malformed preference entries without changing valid template fields', async () => {
        const valid = { id: 'valid', model: '', mode: 'ask', skills: [] };
        state.local.preferences.getGlobal.mockResolvedValue({
            skillTemplates: [null, { id: 'bad', mode: 'task', skills: [2] }, valid],
        });
        const { result } = renderHook(() => useSkillTemplates());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.templates).toEqual([valid]);
    });
});

describe('PR binding ownership', () => {
    it('accepts top-level queue IDs while preserving distinct binding failure behavior', async () => {
        state.local.queue.enqueue.mockResolvedValueOnce({ id: 'legacy-id' });
        const popout = renderHook(() => usePrChatBinding({ workspaceId: 'workspace', prId: '1' }));
        await act(async () => { expect(await popout.result.current.createChat('review')).toBe('legacy-id'); });
        state.local.pullRequests.createChatBindingForOrigin.mockRejectedValueOnce(new Error('binding failed'));
        const server = renderHook(() => usePullRequestChatBinding({ workspaceId: 'workspace', prId: '1' }));
        await act(async () => {});
        await act(async () => { expect(await server.result.current.createChat('review')).toBeNull(); });
        expect(server.result.current.taskId).toBeNull();
        expect(server.result.current.error).toBe('binding failed');
        expect(popout.result.current.taskId).toBe('legacy-id');
    });

    it('persists popout binding for the original target without overwriting a new target', async () => {
        const queued = deferred<{ task: { id: string } }>();
        state.local.queue.enqueue.mockReturnValueOnce(queued.promise);
        const { result, rerender } = renderHook(({ prId }) => usePrChatBinding({
            workspaceId: 'workspace', prId, repoId: 'repo',
        }), { initialProps: { prId: '1' } });
        let pending!: Promise<string | null>;
        act(() => { pending = result.current.createChat('review'); });
        rerender({ prId: '2' });
        await act(async () => { queued.resolve({ task: { id: 'old-chat' } }); await pending; });
        expect(result.current.taskId).toBeNull();
        expect(result.current.loading).toBe(false);
        expect(localStorage.getItem('coc.prChat.binding.pr.workspace.repo.1.current')).toBe('old-chat');
        expect(state.local.pullRequests.createChatBindingForOrigin).not.toHaveBeenCalled();
    });

    it('keeps origin binding server-owned and rejects stale state on endpoint changes', async () => {
        const queued = deferred<{ task: { id: string } }>();
        state.local.queue.enqueue.mockReturnValueOnce(queued.promise);
        state.remote.pullRequests.getChatBindingForOrigin.mockResolvedValue({ taskId: 'remote-chat' });
        const { result, rerender } = renderHook(() => usePullRequestChatBinding({
            workspaceId: 'workspace', prId: '1', remoteUrl: 'https://github.com/example/repo.git',
        }));
        await act(async () => {});
        let pending!: Promise<string | null>;
        act(() => { pending = result.current.createChat('review'); });
        state.active = state.remote;
        rerender();
        await waitFor(() => expect(result.current.taskId).toBe('remote-chat'));
        await act(async () => { queued.resolve({ task: { id: 'old-chat' } }); await pending; });
        expect(state.local.pullRequests.createChatBindingForOrigin).toHaveBeenCalledWith('gh_example_repo', '1', 'old-chat');
        expect(result.current.taskId).toBe('remote-chat');
        expect(localStorage.length).toBe(0);
    });

    it('clears pending loading when the PR disappears and ignores the cancelled read error', async () => {
        const load = deferred<{ taskId: string | null }>();
        state.local.pullRequests.getChatBindingForOrigin.mockReturnValueOnce(load.promise);
        const { result, rerender } = renderHook(({ prId }: { prId: string | undefined }) =>
            usePullRequestChatBinding({ workspaceId: 'workspace', prId }),
        { initialProps: { prId: '1' as string | undefined } });
        rerender({ prId: undefined });
        expect(result.current.loading).toBe(false);
        await act(async () => load.reject(new Error('old read')));
        expect(result.current.error).toBeNull();
    });

    it('does not revive an abandoned request after leaving and returning to the same PR', async () => {
        const queued = deferred<{ task: { id: string } }>();
        state.local.queue.enqueue.mockReturnValueOnce(queued.promise);
        const { result, rerender } = renderHook(({ prId }) =>
            usePullRequestChatBinding({ workspaceId: 'workspace', prId }),
        { initialProps: { prId: '1' } });
        await act(async () => {});
        let pending!: Promise<string | null>;
        act(() => { pending = result.current.createChat('old request'); });
        rerender({ prId: '2' });
        rerender({ prId: '1' });
        await act(async () => {});
        await act(async () => { queued.resolve({ task: { id: 'abandoned' } }); await pending; });
        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBeNull();
    });
});

describe('comment domain contracts and cancellation', () => {
    it('reports malformed polled AI results without changing comment status', async () => {
        state.local.git.listDiffComments.mockResolvedValue({ comments: [comment] });
        state.local.git.askDiffCommentAI.mockResolvedValueOnce({ taskId: 'ai-task' });
        state.local.queue.getTask.mockResolvedValueOnce({ task: { status: 'completed', result: { unexpected: true } } });
        const { result } = renderHook(() => useDiffComments('workspace', context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        vi.useFakeTimers();
        try {
            let pending!: Promise<void>;
            await act(async () => { pending = result.current.askAI('comment'); });
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); await pending; });
            expect(result.current.aiErrors.get('comment')).toBe('Invalid diff comment AI response');
            expect(result.current.comments).toEqual([comment]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('ignores a superseded refresh failure without replacing the latest comments', async () => {
        const { result } = renderHook(() => useDiffComments('workspace', context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const old = deferred<{ comments: typeof comment[] }>();
        state.local.git.listDiffComments.mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce({ comments: [comment] });
        let pending!: Promise<void>;
        act(() => { pending = result.current.refresh(); });
        await act(async () => { await result.current.refresh(); });
        await act(async () => { old.reject(new Error('superseded')); await pending; });
        expect(result.current.comments).toEqual([comment]);
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('stops diff AI polling before another request after the owner changes', async () => {
        state.local.git.askDiffCommentAI.mockResolvedValueOnce({ taskId: 'ai-task' });
        const { result, rerender } = renderHook(() => useDiffComments('workspace', context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        vi.useFakeTimers();
        try {
            let pending!: Promise<void>;
            await act(async () => { pending = result.current.askAI('comment'); });
            state.active = state.remote;
            rerender();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
                await pending;
            });
            expect(state.local.queue.getTask).not.toHaveBeenCalled();
            expect(state.remote.queue.getTask).not.toHaveBeenCalled();
            expect(result.current.aiLoadingIds.size).toBe(0);
            expect(result.current.aiErrors.size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('isolates diff reads and mutations across owner changes and closes stale subscriptions', async () => {
        const read = deferred<{ comments: typeof comment[] }>();
        const create = deferred<{ comment: typeof comment }>();
        state.local.git.listDiffComments.mockReturnValueOnce(read.promise);
        state.local.git.createDiffComment.mockReturnValueOnce(create.promise);
        state.remote.git.listDiffComments.mockResolvedValue({ comments: [{ ...comment, id: 'remote' }] });
        const { result, rerender, unmount } = renderHook(() => useDiffComments('workspace', context));
        const oldSocket = Socket.instances[0];
        let pending!: Promise<unknown>;
        act(() => { pending = result.current.addComment(selection, 'text', 'review'); });
        state.active = state.remote;
        rerender();
        await waitFor(() => expect(result.current.comments[0]?.id).toBe('remote'));
        expect(oldSocket.closed).toBe(true);
        expect(Socket.instances.at(-1)?.url).toContain('remote.example');
        await act(async () => {
            read.resolve({ comments: [comment] });
            create.resolve({ comment });
            await pending;
        });
        expect(result.current.comments.map(item => item.id)).toEqual(['remote']);
        const calls = state.remote.git.listDiffComments.mock.calls.length;
        act(() => oldSocket.emit('message', { type: 'diff-comment-updated', context }));
        expect(state.remote.git.listDiffComments).toHaveBeenCalledTimes(calls);
        unmount();
        expect(Socket.instances.every(socket => socket.closed)).toBe(true);
    });

    it('keeps diff context filtering and event matching separate from task file events', async () => {
        state.local.git.listDiffComments.mockResolvedValue({
            comments: [comment, { ...comment, id: 'other', context: { ...context, filePath: 'other.ts' } }],
        });
        const { result } = renderHook(() => useDiffComments('workspace', context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.comments).toEqual([comment]);
        const socket = Socket.instances[0];
        act(() => socket.emit('open'));
        expect(JSON.parse(socket.sent[0])).toEqual({ type: 'subscribe-diff', context });
        act(() => {
            socket.emit('message', 'not json');
            socket.emit('message', { type: 'comment-resolved', filePath: context.filePath });
            socket.emit('message', { type: 'diff-comment-updated', context: { ...context, newRef: 'other' } });
        });
        expect(state.local.git.listDiffComments).toHaveBeenCalledTimes(1);
        await act(async () => socket.emit('message', { type: 'diff-comment-updated', context }));
        expect(state.local.git.listDiffComments).toHaveBeenCalledTimes(2);
    });

    it('task comments retain page-origin routing, task status updates, counts, and file event contracts', async () => {
        state.active = state.remote;
        state.local.tasks.getCommentCounts.mockResolvedValue({ 'task.md': 2 });
        state.local.tasks.updateComment.mockResolvedValue({ ...taskComment, status: 'resolved' });
        const { result } = renderHook(() => useTaskComments('workspace', 'task.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.commentCounts).toEqual({ 'task.md': 2 });
        expect(state.local.tasks.listComments).toHaveBeenCalledWith('workspace', 'task.md');
        expect(state.remote.tasks.listComments).not.toHaveBeenCalled();
        await act(async () => { await result.current.resolveComment('comment'); });
        expect(state.local.tasks.updateComment).toHaveBeenCalledWith('workspace', 'task.md', 'comment', { status: 'resolved' });
        const socket = Socket.instances[0];
        act(() => socket.emit('open'));
        expect(JSON.parse(socket.sent[0])).toEqual({ type: 'subscribe-file', filePath: 'task.md' });
        act(() => socket.emit('message', { type: 'diff-comment-updated', context }));
        expect(state.local.tasks.listComments).toHaveBeenCalledTimes(1);
        await act(async () => socket.emit('message', { type: 'comment-resolved', filePath: 'task.md' }));
        expect(state.local.tasks.listComments).toHaveBeenCalledTimes(2);
        expect(state.local.tasks.getCommentCounts).toHaveBeenCalledTimes(2);
    });

    it('task owner changes suppress late read, AI errors, and count results', async () => {
        const read = deferred<typeof taskComment[]>();
        const counts = deferred<Record<string, number>>();
        const ai = deferred<{ aiResponse: string }>();
        state.local.tasks.listComments.mockReturnValueOnce(read.promise);
        state.local.tasks.getCommentCounts.mockReturnValueOnce(counts.promise);
        state.local.tasks.askCommentAI.mockReturnValueOnce(ai.promise);
        const { result, rerender } = renderHook(({ wsId }) => useTaskComments(wsId, 'task.md'),
            { initialProps: { wsId: 'first' } });
        let pending!: Promise<void>;
        act(() => { pending = result.current.askAI('comment'); });
        rerender({ wsId: 'second' });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            read.resolve([taskComment]);
            counts.resolve({ 'old.md': 4 });
            ai.reject(new Error('old AI'));
            await pending;
        });
        expect(result.current.comments).toEqual([]);
        expect(result.current.commentCounts).toEqual({});
        expect(result.current.aiErrors.size).toBe(0);
        expect(result.current.aiLoadingIds.size).toBe(0);
    });

    it('does not apply an old task status response to a new file with the same comment id', async () => {
        state.local.tasks.listComments.mockResolvedValue([taskComment]);
        const update = deferred<typeof taskComment>();
        state.local.tasks.updateComment.mockReturnValueOnce(update.promise);
        const { result, rerender } = renderHook(({ path }) => useTaskComments('workspace', path),
            { initialProps: { path: 'first.md' } });
        await waitFor(() => expect(result.current.loading).toBe(false));
        let pending!: Promise<unknown>;
        act(() => { pending = result.current.resolveComment('comment'); });
        rerender({ path: 'second.md' });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { update.resolve({ ...taskComment, comment: 'old response' }); await pending; });
        expect(result.current.comments).toEqual([taskComment]);
        expect(result.current.resolvingIds.size).toBe(0);
    });

    it('finishes duplicate status calls immediately and clears tracking on errors', async () => {
        state.local.git.listDiffComments.mockResolvedValue({ comments: [comment] });
        const update = deferred<typeof comment>();
        state.patch.mockReturnValueOnce(update.promise);
        const { result } = renderHook(() => useDiffComments('workspace', context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        let first!: Promise<unknown>;
        let second!: Promise<unknown>;
        act(() => {
            first = result.current.resolveComment('comment');
            second = result.current.resolveComment('comment');
        });
        await act(async () => { expect(await second).toBeUndefined(); });
        await act(async () => { expect(await result.current.unresolveComment('comment')).toBeUndefined(); });
        expect(result.current.resolvingIds.has('comment')).toBe(true);
        await act(async () => { update.resolve(comment); expect(await first).toEqual(comment); });
        expect(state.patch).toHaveBeenCalledTimes(1);
        expect(result.current.resolvingIds.size).toBe(0);
        expect(result.current.comments[0].status).toBe('open'); // Never silently resolve a server response.
        state.remove.mockRejectedValueOnce(new Error('delete failed'));
        await act(async () => {
            await expect(result.current.deleteComment('comment')).rejects.toThrow('delete failed');
        });
        expect(result.current.comments).toEqual([comment]);
        expect(result.current.deletingIds.size).toBe(0);
    });

    it('finishes duplicate deletes immediately while retaining the first request tracking', async () => {
        state.local.git.listDiffComments.mockResolvedValue({ comments: [comment] });
        const deletion = deferred<void>();
        state.remove.mockReturnValueOnce(deletion.promise);
        const { result } = renderHook(() => useDiffComments('workspace', context));
        await waitFor(() => expect(result.current.loading).toBe(false));
        let first!: Promise<void>;
        act(() => { first = result.current.deleteComment('comment'); });
        await act(async () => { await result.current.deleteComment('comment'); });
        expect(state.remove).toHaveBeenCalledTimes(1);
        expect(result.current.deletingIds.has('comment')).toBe(true);
        await act(async () => { deletion.resolve(); await first; });
        expect(result.current.deletingIds.size).toBe(0);
        expect(result.current.comments).toEqual([]);
    });
});
