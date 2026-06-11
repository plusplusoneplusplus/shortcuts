/**
 * Tests for useWorkItemChatBinding hook.
 */
/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => ({
    mockClient: {
        queue: {
            enqueue: vi.fn(),
        },
        workItems: {
            getChatBinding: vi.fn(),
            createChatBinding: vi.fn(),
            startFreshChat: vi.fn(),
        },
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

import { useWorkItemChatBinding } from '../../../../src/server/spa/client/react/features/work-items/hooks/useWorkItemChatBinding';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('useWorkItemChatBinding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.workItems.getChatBinding.mockResolvedValue({ taskId: null });
        mockClient.workItems.createChatBinding.mockResolvedValue({});
        mockClient.workItems.startFreshChat.mockResolvedValue({ workItemId: 'wi-1', archivedTaskId: 'task-existing' });
        mockClient.queue.enqueue.mockResolvedValue({ task: { id: 'task-work-item' } });
    });

    it('fetches and restores existing binding for workspace + work item', async () => {
        mockClient.workItems.getChatBinding.mockResolvedValueOnce({ workItemId: 'wi-1', taskId: 'task-existing' });

        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-1',
            title: 'Fix login',
        }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(mockClient.workItems.getChatBinding).toHaveBeenCalledWith('ws-1', 'wi-1');
        expect(result.current.taskId).toBe('task-existing');
    });

    it('treats 404 as no binding', async () => {
        mockClient.workItems.getChatBinding.mockRejectedValueOnce({ status: 404 });

        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-missing',
        }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('resets and refetches when selection changes between work items', async () => {
        const { rerender } = renderHook(
            ({ workItemId }) => useWorkItemChatBinding({ workspaceId: 'ws-1', workItemId }),
            { initialProps: { workItemId: 'wi-1' } },
        );

        rerender({ workItemId: 'wi-2' });

        await act(async () => {
            await Promise.resolve();
        });

        expect(mockClient.workItems.getChatBinding).toHaveBeenCalledWith('ws-1', 'wi-1');
        expect(mockClient.workItems.getChatBinding).toHaveBeenCalledWith('ws-1', 'wi-2');
    });

    it('ignores stale binding results after changing workspace selection', async () => {
        const firstWorkspaceLookup = deferred<{ workItemId: string; taskId: string }>();
        const secondWorkspaceLookup = deferred<{ workItemId: string; taskId: string }>();
        mockClient.workItems.getChatBinding.mockImplementation((workspaceId: string, workItemId: string) => {
            if (workspaceId === 'ws-1' && workItemId === 'same-id') return firstWorkspaceLookup.promise;
            if (workspaceId === 'ws-2' && workItemId === 'same-id') return secondWorkspaceLookup.promise;
            return Promise.resolve({ taskId: null });
        });

        const { result, rerender } = renderHook(
            ({ workspaceId, workItemId }) => useWorkItemChatBinding({ workspaceId, workItemId }),
            { initialProps: { workspaceId: 'ws-1', workItemId: 'same-id' } },
        );

        rerender({ workspaceId: 'ws-2', workItemId: 'same-id' });

        await act(async () => {
            secondWorkspaceLookup.resolve({ workItemId: 'same-id', taskId: 'task-ws-2' });
            await secondWorkspaceLookup.promise;
        });

        expect(result.current.taskId).toBe('task-ws-2');

        await act(async () => {
            firstWorkspaceLookup.resolve({ workItemId: 'same-id', taskId: 'task-ws-1' });
            await firstWorkspaceLookup.promise;
            await Promise.resolve();
        });

        expect(result.current.taskId).toBe('task-ws-2');
        expect(mockClient.workItems.getChatBinding).toHaveBeenCalledWith('ws-1', 'same-id');
        expect(mockClient.workItems.getChatBinding).toHaveBeenCalledWith('ws-2', 'same-id');
    });

    it('does not apply a completed chat create after the selected Work Item changes', async () => {
        const createRequest = deferred<{ task: { id: string } }>();
        mockClient.queue.enqueue.mockReturnValueOnce(createRequest.promise);

        const { result, rerender } = renderHook(
            ({ workItemId }) => useWorkItemChatBinding({
                workspaceId: 'ws-1',
                workItemId,
                title: workItemId === 'wi-1' ? 'Saved title one' : 'Saved title two',
            }),
            { initialProps: { workItemId: 'wi-1' } },
        );

        await act(async () => {
            await Promise.resolve();
        });

        const createPromise = result.current.createChat('Start from saved state');
        rerender({ workItemId: 'wi-2' });

        await act(async () => {
            createRequest.resolve({ task: { id: 'task-wi-1' } });
            await createPromise;
            await Promise.resolve();
        });

        expect(await createPromise).toBe('task-wi-1');
        expect(mockClient.workItems.createChatBinding).toHaveBeenCalledWith('ws-1', 'wi-1', 'task-wi-1');
        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('creates a normal chat task with pointer-only Work Item context, then saves the binding', async () => {
        const attachments = [{ name: 'image.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,abc' }];
        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-123',
            workItemNumber: 123,
            title: 'UI-only saved title',
            status: 'planning',
            type: 'bug',
        }));

        await act(async () => {
            await result.current.createChat('What should I do next?', {
                mode: 'ask',
                context: {
                    source: 'work-item-detail',
                    workItemChat: {
                        workspaceId: 'spoofed-ws',
                        workItemId: 'spoofed-wi',
                        title: 'Unsafe caller-supplied title',
                    },
                },
                attachments,
                provider: 'codex',
                model: 'gpt-5.4',
                reasoningEffort: 'medium',
                config: { effortTier: 'medium' },
                workingDirectory: '/workspace',
            });
        });

        const enqueueArg = mockClient.queue.enqueue.mock.calls[0][0];
        expect(enqueueArg).toMatchObject({
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'ask',
                workspaceId: 'ws-1',
                workingDirectory: '/workspace',
                attachments,
                provider: 'codex',
                model: 'gpt-5.4',
                reasoningEffort: 'medium',
                context: {
                    source: 'work-item-detail',
                    workItemChat: {
                        workspaceId: 'ws-1',
                        workItemId: 'wi-123',
                        status: 'planning',
                        type: 'bug',
                        workItemNumber: 123,
                    },
                },
            },
            config: { effortTier: 'medium' },
        });
        expect(enqueueArg.payload.prompt).toContain('<attached_pointer_context version="1">');
        expect(enqueueArg.payload.prompt).toContain('kind="work-item"');
        expect(enqueueArg.payload.prompt).toContain('workspace_id="ws-1"');
        expect(enqueueArg.payload.prompt).toContain('work_item_id="wi-123"');
        expect(enqueueArg.payload.prompt).toContain('work_item_number="123"');
        expect(enqueueArg.payload.prompt).toContain('status="planning"');
        expect(enqueueArg.payload.prompt).toContain('type="bug"');
        expect(enqueueArg.payload.prompt).toContain('<title>Work Item #123</title>');
        expect(enqueueArg.payload.prompt).not.toContain('UI-only saved title');
        expect(enqueueArg.payload.prompt).toContain('What should I do next?');
        expect(enqueueArg.payload.prompt).not.toContain('description');
        expect(enqueueArg.payload.prompt).not.toContain('raw plan content');
        expect(enqueueArg.payload.prompt).not.toContain('provider details');
        expect(enqueueArg.payload.context.workItemChat.workspaceId).toBe('ws-1');
        expect(enqueueArg.payload.context.workItemChat.workItemId).toBe('wi-123');
        expect(enqueueArg.payload.context.workItemChat.title).toBeUndefined();
        expect(mockClient.workItems.createChatBinding).toHaveBeenCalledWith('ws-1', 'wi-123', 'task-work-item');
        expect(result.current.taskId).toBe('task-work-item');
    });

    it('clears a failed create error when retrying and restoring the created chat', async () => {
        mockClient.queue.enqueue
            .mockRejectedValueOnce(new Error('temporary queue outage'))
            .mockResolvedValueOnce({ task: { id: 'task-retry' } });

        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-1',
            status: 'planning',
            type: 'bug',
        }));

        await act(async () => {
            await result.current.createChat('First try');
        });

        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBe('temporary queue outage');

        await act(async () => {
            await result.current.createChat('Retry');
        });

        expect(result.current.taskId).toBe('task-retry');
        expect(result.current.error).toBeNull();
        expect(mockClient.workItems.createChatBinding).toHaveBeenCalledWith('ws-1', 'wi-1', 'task-retry');
    });

    it('calls the fresh Work Item endpoint and resets taskId to the empty same-context state', async () => {
        mockClient.workItems.getChatBinding.mockResolvedValueOnce({ workItemId: 'wi-1', taskId: 'task-existing' });

        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-1',
            workItemNumber: 7,
            type: 'bug',
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
        expect(mockClient.workItems.startFreshChat).toHaveBeenCalledWith('ws-1', 'wi-1');
        expect(mockClient.queue.enqueue).not.toHaveBeenCalled();
        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.startingFresh).toBe(false);
    });

    it('keeps the old taskId visible and surfaces an error when Work Item fresh reset fails', async () => {
        mockClient.workItems.getChatBinding.mockResolvedValueOnce({ workItemId: 'wi-1', taskId: 'task-existing' });
        mockClient.workItems.startFreshChat.mockRejectedValueOnce(new Error('archive failed'));

        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-1',
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

    it('returns null without creating chat when no work item is selected', async () => {
        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: undefined,
        }));

        let created: string | null = 'unexpected';
        await act(async () => {
            created = await result.current.createChat('Hello');
        });

        expect(created).toBeNull();
        expect(mockClient.queue.enqueue).not.toHaveBeenCalled();
        expect(mockClient.workItems.createChatBinding).not.toHaveBeenCalled();
    });
});
