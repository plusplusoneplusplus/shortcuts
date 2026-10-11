/**
 * Behavioral tests for usePrChatBinding — localStorage scoping and queue payload shape.
 */
/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => ({
    mockClient: {
        queue: {
            enqueue: vi.fn(),
        },
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

import { usePrChatBinding } from '../../../../src/server/spa/client/react/features/git/hooks/usePrChatBinding';

describe('usePrChatBinding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'task-pr-popout' } });
    });

    it('preserves composer send options while binding pull request context', async () => {
        const attachments = [{ name: 'risk.txt', mimeType: 'text/plain', size: 4, dataUrl: 'data:text/plain;base64,cmlzaw==' }];
        const { result } = renderHook(() => usePrChatBinding({
            workspaceId: 'ws-1',
            prId: '42',
            filePath: 'src/app.ts',
            repoId: 'repo-1',
            prTitle: 'Improve review chat',
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
                    pullRequestChat: { prId: '42', repoId: 'repo-1', prTitle: 'Improve review chat' },
                },
            },
            config: { effortTier: 'high' },
        });
        expect(localStorage.getItem('coc.prChat.binding.pr.ws-1.repo-1.42.current')).toBe('task-pr-popout');
        expect(localStorage.getItem('coc.prChat.binding.42')).toBeNull();
    });

    it('does not collide for the same PR id across workspaces or repos', async () => {
        const { result, rerender } = renderHook(
            ({ workspaceId, repoId }: { workspaceId: string; repoId: string }) => usePrChatBinding({
                workspaceId,
                prId: '42',
                repoId,
                prTitle: 'Improve review chat',
            }),
            { initialProps: { workspaceId: 'ws-1', repoId: 'repo-1' } },
        );

        mockClient.queue.enqueue.mockResolvedValueOnce({ task: { id: 'task-ws-1-repo-1' } });
        await act(async () => {
            await result.current.createChat('first workspace prompt');
        });

        expect(result.current.taskId).toBe('task-ws-1-repo-1');
        expect(localStorage.getItem('coc.prChat.binding.pr.ws-1.repo-1.42.current')).toBe('task-ws-1-repo-1');

        await act(async () => {
            rerender({ workspaceId: 'ws-2', repoId: 'repo-1' });
        });
        expect(result.current.taskId).toBeNull();

        mockClient.queue.enqueue.mockResolvedValueOnce({ task: { id: 'task-ws-2-repo-1' } });
        await act(async () => {
            await result.current.createChat('second workspace prompt');
        });

        expect(localStorage.getItem('coc.prChat.binding.pr.ws-1.repo-1.42.current')).toBe('task-ws-1-repo-1');
        expect(localStorage.getItem('coc.prChat.binding.pr.ws-2.repo-1.42.current')).toBe('task-ws-2-repo-1');

        await act(async () => {
            rerender({ workspaceId: 'ws-2', repoId: 'repo-2' });
        });
        expect(result.current.taskId).toBeNull();

        mockClient.queue.enqueue.mockResolvedValueOnce({ task: { id: 'task-ws-2-repo-2' } });
        await act(async () => {
            await result.current.createChat('second repo prompt');
        });

        expect(localStorage.getItem('coc.prChat.binding.pr.ws-2.repo-1.42.current')).toBe('task-ws-2-repo-1');
        expect(localStorage.getItem('coc.prChat.binding.pr.ws-2.repo-2.42.current')).toBe('task-ws-2-repo-2');

        await act(async () => {
            rerender({ workspaceId: 'ws-1', repoId: 'repo-1' });
        });
        expect(result.current.taskId).toBe('task-ws-1-repo-1');
    });
});
