/**
 * Validates binding lookup on commitHash change, 404 → empty state,
 * createChat task creation + binding POST, diff inclusion in context blocks,
 * and error handling.
 */
/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitClient, type CocRequestOptions, type RequestAdapter } from '@plusplusoneplusplus/coc-client';

interface RequestCall {
    path: string;
    options?: CocRequestOptions;
}

const { mockClient, mockGit } = vi.hoisted(() => {
    const mockGit = {
        getCommitChatBinding: vi.fn(),
        createCommitChatBinding: vi.fn(),
        startFreshCommitChat: vi.fn(),
    };
    const mockClient: { queue: { enqueue: ReturnType<typeof vi.fn> }; git: unknown } = {
        queue: {
            enqueue: vi.fn(),
        },
        git: mockGit,
    };
    return {
        mockGit,
        mockClient,
    };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

// The hook resolves its client per workspace so remote clones hit their own
// server; every workspace in this file is local, so it resolves to mockClient.
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => mockClient,
}));

import { useCommitChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitChatBinding';

describe('useCommitChatBinding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.git = mockGit;
        mockGit.getCommitChatBinding.mockResolvedValue({ taskId: null });
        mockGit.createCommitChatBinding.mockResolvedValue({});
        mockGit.startFreshCommitChat.mockResolvedValue({ commitHash: 'abc123', archivedTaskId: 'task-existing' });
        mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'task-commit' } });
    });

    describe('createChat', () => {
        it('preserves composer send options while binding commit context', async () => {
            const attachments = [{ name: 'diff.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,abc' }];
            const { result } = renderHook(() => useCommitChatBinding({
                workspaceId: 'ws-1',
                commitHash: 'abc123',
                commitMessage: 'fix: bug',
            }));

            await act(async () => {
                await result.current.createChat('review prompt', {
                    mode: 'autopilot',
                    context: { skills: ['reviewer'] },
                    attachments,
                    provider: 'claude',
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                    config: { effortTier: 'high' },
                    workingDirectory: '/workspace',
                });
            });

            expect(mockClient.queue.enqueue).toHaveBeenCalledWith({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: 'review prompt',
                    workingDirectory: '/workspace',
                    workspaceId: 'ws-1',
                    attachments,
                    provider: 'claude',
                    model: 'claude-sonnet-4.6',
                    reasoningEffort: 'high',
                    context: {
                        skills: ['reviewer'],
                        commitChat: { commitHash: 'abc123', commitMessage: 'fix: bug' },
                    },
                },
                config: { effortTier: 'high' },
            });
            expect(mockGit.createCommitChatBinding).toHaveBeenCalledWith('ws-1', 'abc123', 'task-commit');
        });
    });

    describe('startFreshChat clears the active binding', () => {
        it('calls the fresh commit endpoint and resets taskId to the empty same-context state', async () => {
            mockGit.getCommitChatBinding.mockResolvedValueOnce({ commitHash: 'abc123', taskId: 'task-existing' });
            const { result } = renderHook(() => useCommitChatBinding({
                workspaceId: 'ws-1',
                commitHash: 'abc123',
                commitMessage: 'fix: bug',
            }));

            await act(async () => {
                await Promise.resolve();
            });
            expect(result.current.taskId).toBe('task-existing');

            let freshResult = false;
            await act(async () => {
                freshResult = await result.current.startFreshChat();
            });

            expect(freshResult).toBe(true);
            expect(mockGit.startFreshCommitChat).toHaveBeenCalledWith('ws-1', 'abc123');
            expect(mockClient.queue.enqueue).not.toHaveBeenCalled();
            expect(result.current.taskId).toBeNull();
            expect(result.current.error).toBeNull();
            expect(result.current.startingFresh).toBe(false);
        });

        it('uses the real GitClient fresh-commit method so the action reaches the workspace-scoped fresh endpoint', async () => {
            const calls: RequestCall[] = [];
            const adapter: RequestAdapter = {
                request: async (requestPath, options) => {
                    calls.push({ path: requestPath, options });
                    if (requestPath.endsWith('/fresh')) {
                        return { commitHash: 'abc/123', archivedTaskId: 'task-existing' } as never;
                    }
                    return { commitHash: 'abc/123', taskId: 'task-existing' } as never;
                },
            };
            mockClient.git = new GitClient(adapter);

            const { result } = renderHook(() => useCommitChatBinding({
                workspaceId: 'ws/one',
                commitHash: 'abc/123',
            }));

            await waitFor(() => {
                expect(result.current.taskId).toBe('task-existing');
            });

            await act(async () => {
                await result.current.startFreshChat();
            });

            expect(calls[calls.length - 1]).toEqual({
                path: '/workspaces/ws%2Fone/commit-chat-bindings/abc%2F123/fresh',
                options: { method: 'POST', body: {} },
            });
            expect(result.current.taskId).toBeNull();
        });

        it('keeps the old taskId visible and surfaces an error when fresh reset fails', async () => {
            mockGit.getCommitChatBinding.mockResolvedValueOnce({ commitHash: 'abc123', taskId: 'task-existing' });
            mockGit.startFreshCommitChat.mockRejectedValueOnce(new Error('archive failed'));
            const { result } = renderHook(() => useCommitChatBinding({
                workspaceId: 'ws-1',
                commitHash: 'abc123',
            }));

            await act(async () => {
                await Promise.resolve();
            });

            let freshResult = true;
            await act(async () => {
                freshResult = await result.current.startFreshChat();
            });

            expect(freshResult).toBe(false);
            expect(result.current.taskId).toBe('task-existing');
            expect(result.current.error).toBe('archive failed');
            expect(result.current.startingFresh).toBe(false);
        });
    });

    describe('bindExistingChat rebinds the commit to an existing conversation', () => {
        function deferred<T>() {
            let resolve!: (value: T) => void;
            let reject!: (reason?: unknown) => void;
            const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
        }

        async function renderBound(taskId: string | null = null) {
            mockGit.getCommitChatBinding.mockResolvedValueOnce({ commitHash: 'abc123', taskId });
            const view = renderHook(() => useCommitChatBinding({ workspaceId: 'ws-1', commitHash: 'abc123' }));
            await act(async () => { await Promise.resolve(); });
            expect(view.result.current.taskId).toBe(taskId);
            return view;
        }

        it('accepts a queue process ID and binds the bare task ID', async () => {
            const { result } = await renderBound();

            let ok = false;
            await act(async () => { ok = await result.current.bindExistingChat('queue_abc'); });

            expect(ok).toBe(true);
            expect(mockGit.createCommitChatBinding).toHaveBeenCalledWith('ws-1', 'abc123', 'abc');
            expect(result.current.taskId).toBe('abc');
        });

        it('accepts a bare task ID unchanged', async () => {
            const { result } = await renderBound();

            await act(async () => { await result.current.bindExistingChat('abc'); });

            expect(mockGit.createCommitChatBinding).toHaveBeenCalledWith('ws-1', 'abc123', 'abc');
        });

        it('swaps the lens optimistically before the binding write settles', async () => {
            const pending = deferred<unknown>();
            mockGit.createCommitChatBinding.mockReturnValueOnce(pending.promise);
            const { result } = await renderBound('task-old');

            let bindPromise!: Promise<boolean>;
            await act(async () => {
                bindPromise = result.current.bindExistingChat('queue_task-new');
                await Promise.resolve();
            });

            expect(result.current.taskId).toBe('task-new');

            await act(async () => { pending.resolve({}); await bindPromise; });
            expect(result.current.taskId).toBe('task-new');
        });

        it('rolls back to the previously bound chat and surfaces the error on failure', async () => {
            mockGit.createCommitChatBinding.mockRejectedValueOnce(new Error('binding write failed'));
            const { result } = await renderBound('task-old');

            let ok = true;
            await act(async () => { ok = await result.current.bindExistingChat('queue_task-new'); });

            expect(ok).toBe(false);
            expect(result.current.taskId).toBe('task-old');
            expect(result.current.error).toBe('binding write failed');
        });

        it('rolls back to the empty state when the commit had no chat', async () => {
            mockGit.createCommitChatBinding.mockRejectedValueOnce(new Error('nope'));
            const { result } = await renderBound(null);

            await act(async () => { await result.current.bindExistingChat('queue_task-new'); });

            expect(result.current.taskId).toBeNull();
            expect(result.current.error).toBe('nope');
        });

        it('does not call the API when the dropped chat is already bound', async () => {
            const { result } = await renderBound('task-old');

            let ok = false;
            await act(async () => { ok = await result.current.bindExistingChat('queue_task-old'); });

            expect(ok).toBe(true);
            expect(mockGit.createCommitChatBinding).not.toHaveBeenCalled();
            expect(result.current.taskId).toBe('task-old');
        });

        it('writes nothing when the rebind resolves after the commit changed', async () => {
            const pending = deferred<unknown>();
            mockGit.createCommitChatBinding.mockReturnValueOnce(pending.promise);
            mockGit.getCommitChatBinding.mockResolvedValue({ taskId: null });

            const { result, rerender } = renderHook(
                (props: { workspaceId: string; commitHash: string }) => useCommitChatBinding(props),
                { initialProps: { workspaceId: 'ws-1', commitHash: 'abc123' } },
            );
            await act(async () => { await Promise.resolve(); });

            let bindPromise!: Promise<boolean>;
            await act(async () => {
                bindPromise = result.current.bindExistingChat('queue_task-new');
                await Promise.resolve();
            });
            expect(result.current.taskId).toBe('task-new');

            rerender({ workspaceId: 'ws-1', commitHash: 'def456' });
            await act(async () => { await Promise.resolve(); });

            await act(async () => {
                pending.reject(new Error('too late'));
                await bindPromise;
            });

            expect(result.current.taskId).toBeNull();
            expect(result.current.error).toBeNull();
        });

        it('rolls a failed second rebind back to the first dropped chat, not the pre-drag state', async () => {
            const first = deferred<unknown>();
            const second = deferred<unknown>();
            mockGit.createCommitChatBinding
                .mockReturnValueOnce(first.promise)
                .mockReturnValueOnce(second.promise);
            const { result } = await renderBound(null);

            await act(async () => {
                const a = result.current.bindExistingChat('queue_task-a');
                const b = result.current.bindExistingChat('queue_task-b');
                first.resolve({});
                second.reject(new Error('second failed'));
                await Promise.all([a, b]);
            });

            expect(result.current.taskId).toBe('task-a');
            expect(result.current.error).toBe('second failed');
        });
    });

});
