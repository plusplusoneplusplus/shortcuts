/**
 * Behavioral tests for usePullRequestChatBinding.
 */
/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('usePullRequestChatBinding', () => {
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

    describe('startFreshChat', () => {
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
});
