/**
 * Tests for usePullRequestChatBinding hook — binding fetch, createChat, state.
 *
 * Validates binding lookup on prId change, 404 → empty state, createChat
 * task creation + binding POST with pullRequestChat context blocks, and
 * error handling. Mirrors the useCommitChatBinding test contract.
 */
/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const { mockClient } = vi.hoisted(() => ({
    mockClient: {
        queue: {
            enqueue: vi.fn(),
        },
        pullRequests: {
            getChatBinding: vi.fn(),
            createChatBinding: vi.fn(),
            startFreshChat: vi.fn(),
            getChatBindingForOrigin: vi.fn(),
            createChatBindingForOrigin: vi.fn(),
            startFreshChatForOrigin: vi.fn(),
        },
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

import { usePullRequestChatBinding } from '../../../../src/server/spa/client/react/features/pull-requests/hooks/usePullRequestChatBinding';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'pull-requests', 'hooks', 'usePullRequestChatBinding.ts',
);

describe('usePullRequestChatBinding', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.pullRequests.getChatBinding.mockResolvedValue({ taskId: null });
        mockClient.pullRequests.createChatBinding.mockResolvedValue({});
        mockClient.pullRequests.startFreshChat.mockResolvedValue({ prId: '142', archivedTaskId: 'task-existing' });
        mockClient.pullRequests.getChatBindingForOrigin.mockResolvedValue({ taskId: null });
        mockClient.pullRequests.createChatBindingForOrigin.mockResolvedValue({});
        mockClient.pullRequests.startFreshChatForOrigin.mockResolvedValue({ prId: '142', archivedTaskId: 'task-existing' });
        mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'task-pr' } });
    });

    it('exports UsePullRequestChatBindingOptions interface', () => {
        expect(source).toContain('export interface UsePullRequestChatBindingOptions');
    });

    it('exports UsePullRequestChatBindingReturn interface', () => {
        expect(source).toContain('export interface UsePullRequestChatBindingReturn');
    });

    it('exports usePullRequestChatBinding function', () => {
        expect(source).toContain('export function usePullRequestChatBinding');
    });

    describe('binding fetch on mount', () => {
        it('fetches binding via GET when prId changes', () => {
            expect(source).toContain('pullRequests.getChatBindingForOrigin(originId, prId)');
        });

        it('sets taskId from binding response', () => {
            expect(source).toContain('setTaskId(data.taskId)');
        });

        it('resets state when prId changes', () => {
            expect(source).toContain('setLoading(true)');
            expect(source).toContain('setError(null)');
            expect(source).toContain('setTaskId(null)');
        });

        it('uses useEffect with workspaceId+prId dependency', () => {
            expect(source).toContain('[workspaceId, originId, prId, cloneClient]');
        });
    });

    describe('binding 404 → empty state', () => {
        it('treats 404 as no binding (not an error)', () => {
            expect(source).toContain("err?.status === 404 || err?.message?.includes('404')");
            expect(source).toMatch(/includes\('404'\)\)\s*setTaskId\(null\)/);
        });

        it('sets error for non-404 failures', () => {
            expect(source).toContain("setError('Failed to load pull request chat')");
        });
    });

    describe('pr switch resets state', () => {
        it('resets taskId to null on prId change', () => {
            const effectBlock = source.substring(
                source.indexOf('useEffect(() => {'),
                source.indexOf('[workspaceId, originId, prId, cloneClient]') + 60,
            );
            expect(effectBlock).toContain('setTaskId(null)');
            expect(effectBlock).toContain('setLoading(true)');
            expect(effectBlock).toContain('setError(null)');
        });

        it('cancels in-flight request on cleanup', () => {
            expect(source).toContain('let cancelled = false');
            expect(source).toContain('cancelled = true');
            expect(source).toContain('if (cancelled) return');
        });
    });

    describe('createChat creates task + binding', () => {
        it('POSTs to /queue with chat payload', () => {
            expect(source).toContain('queue.enqueue');
            expect(source).toContain("kind: 'chat'");
            expect(source).toContain("mode: options.mode ?? 'ask'");
        });

        it('includes pullRequestChat in context', () => {
            expect(source).toContain('pullRequestChat: { prId, prNumber, prTitle, repoId, originId }');
        });

        it('forwards composer AI selection and attachments into the queue payload', () => {
            expect(source).toContain('options.attachments');
            expect(source).toContain('provider: options.provider');
            expect(source).toContain('model: options.model');
            expect(source).toContain('reasoningEffort: options.reasoningEffort');
            expect(source).toContain('config: options.config');
        });

        it('extracts taskId from nested task object (server returns { task: { id } })', () => {
            expect(source).toContain("res.task?.id ?? (res as { id?: string }).id");
        });

        it('POSTs binding after task creation', () => {
            expect(source).toContain('pullRequests.createChatBindingForOrigin(originId, prId, newTaskId)');
        });

        it('uses canonical origin binding APIs so same-origin clones share PR chats', async () => {
            const { result } = renderHook(() => usePullRequestChatBinding({
                workspaceId: 'clone-a',
                remoteUrl: 'https://github.com/Octo/Repo.git',
                prId: '142',
                prNumber: 142,
                prTitle: 'Add retry logic',
                repoId: 'repo-1',
            }));

            await act(async () => {
                await Promise.resolve();
            });
            expect(mockClient.pullRequests.getChatBindingForOrigin).toHaveBeenCalledWith('gh_octo_repo', '142');

            await act(async () => {
                await result.current.createChat('review prompt');
            });

            expect(mockClient.pullRequests.createChatBindingForOrigin).toHaveBeenCalledWith('gh_octo_repo', '142', 'task-pr');
            expect(mockClient.pullRequests.createChatBinding).not.toHaveBeenCalled();
        });

        it('sets taskId on success', () => {
            expect(source).toContain('setTaskId(newTaskId)');
            expect(source).toContain('return newTaskId');
        });

        it('preserves composer send options while binding pull request context', async () => {
            const attachments = [{ name: 'risk.txt', mimeType: 'text/plain', size: 4, dataUrl: 'data:text/plain;base64,cmlzaw==' }];
            const { result } = renderHook(() => usePullRequestChatBinding({
                workspaceId: 'ws-1',
                prId: '142',
                prNumber: 142,
                prTitle: 'Add retry logic',
                repoId: 'repo-1',
            }));

            await act(async () => {
                await result.current.createChat('review prompt', {
                    mode: 'autopilot',
                    context: { skills: ['reviewer'] },
                    attachments,
                    provider: 'codex',
                    model: 'gpt-5.4',
                    reasoningEffort: 'medium',
                    config: { effortTier: 'medium' },
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
                    provider: 'codex',
                    model: 'gpt-5.4',
                    reasoningEffort: 'medium',
                    context: {
                        skills: ['reviewer'],
                        pullRequestChat: { prId: '142', prNumber: 142, prTitle: 'Add retry logic', repoId: 'repo-1', originId: 'local_ws-1' },
                    },
                },
                config: { effortTier: 'medium' },
            });
            expect(mockClient.pullRequests.createChatBindingForOrigin).toHaveBeenCalledWith('local_ws-1', '142', 'task-pr');
        });
    });

    describe('createChat failure sets error', () => {
        it('sets error message on failure', () => {
            expect(source).toContain("setError(err?.message ?? 'Failed to create pull request chat')");
        });

        it('returns null on failure', () => {
            expect(source).toContain('return null');
        });
    });

    describe('startFreshChat clears the active binding', () => {
        it('calls the fresh PR endpoint and resets taskId to the empty same-context state', async () => {
            mockClient.pullRequests.getChatBindingForOrigin.mockResolvedValueOnce({ prId: '142', taskId: 'task-existing' });
            const { result } = renderHook(() => usePullRequestChatBinding({
                workspaceId: 'ws-1',
                prId: '142',
                prNumber: 142,
                prTitle: 'Add retry logic',
                repoId: 'repo-1',
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
            expect(mockClient.pullRequests.startFreshChatForOrigin).toHaveBeenCalledWith('local_ws-1', '142', 'ws-1');
            expect(mockClient.pullRequests.startFreshChat).not.toHaveBeenCalled();
            expect(mockClient.queue.enqueue).not.toHaveBeenCalled();
            expect(result.current.taskId).toBeNull();
            expect(result.current.error).toBeNull();
            expect(result.current.startingFresh).toBe(false);
        });

        it('keeps the old taskId visible and surfaces an error when fresh reset fails', async () => {
            mockClient.pullRequests.getChatBindingForOrigin.mockResolvedValueOnce({ prId: '142', taskId: 'task-existing' });
            mockClient.pullRequests.startFreshChatForOrigin.mockRejectedValueOnce(new Error('archive failed'));
            const { result } = renderHook(() => usePullRequestChatBinding({
                workspaceId: 'ws-1',
                prId: '142',
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

    it('returns taskId, loading, error, createChat, and startFreshChat state', () => {
        expect(source).toContain('return { taskId, loading, error, createChat, startFreshChat, startingFresh }');
    });

    it('exits early when prId is empty', () => {
        expect(source).toContain('if (!prId) { setTaskId(null); setStartingFresh(false); return; }');
    });
});
