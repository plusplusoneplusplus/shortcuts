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
        },
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
}));

import { useWorkItemChatBinding } from '../../../../src/server/spa/client/react/features/work-items/hooks/useWorkItemChatBinding';

describe('useWorkItemChatBinding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.workItems.getChatBinding.mockResolvedValue({ taskId: null });
        mockClient.workItems.createChatBinding.mockResolvedValue({});
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

    it('creates a normal chat task with pointer-only Work Item context, then saves the binding', async () => {
        const attachments = [{ name: 'image.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,abc' }];
        const { result } = renderHook(() => useWorkItemChatBinding({
            workspaceId: 'ws-1',
            workItemId: 'wi-123',
            workItemNumber: 123,
            title: 'Fix saved title',
            status: 'planning',
            type: 'bug',
        }));

        await act(async () => {
            await result.current.createChat('What should I do next?', {
                mode: 'ask',
                context: { source: 'work-item-detail' },
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
        expect(enqueueArg.payload.prompt).toContain('<title>Fix saved title</title>');
        expect(enqueueArg.payload.prompt).toContain('What should I do next?');
        expect(enqueueArg.payload.prompt).not.toContain('description');
        expect(enqueueArg.payload.prompt).not.toContain('raw plan content');
        expect(enqueueArg.payload.prompt).not.toContain('provider details');
        expect(enqueueArg.payload.context.workItemChat.title).toBeUndefined();
        expect(mockClient.workItems.createChatBinding).toHaveBeenCalledWith('ws-1', 'wi-123', 'task-work-item');
        expect(result.current.taskId).toBe('task-work-item');
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
