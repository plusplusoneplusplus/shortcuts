/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueuedTaskPoll } from '../../../../src/server/spa/client/react/queue/hooks/useQueuedTaskPoll';

const client = vi.hoisted(() => ({
    queue: { getTask: vi.fn() },
    processes: { get: vi.fn() },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => client }));
vi.mock('../../../../src/server/spa/client/react/repos/workspaceOwnerContext', () => ({ useWorkspaceOwner: () => null }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('queued chat bounded hydration seam', () => {
    function options(overrides = {}) {
        return {
            taskId: 'queue_chat', task: { status: 'queued' }, workspaceId: 'workspace',
            setTask: vi.fn(), setProcessDetails: vi.fn(), setTurnsAndRef: vi.fn(),
            ...overrides,
        };
    }
    it('uses the shared owner reader when the queued chat completes', async () => {
        client.queue.getTask.mockResolvedValue({ task: { status: 'completed', processId: 'queue_chat' } });
        const turns = [{ role: 'user', turnIndex: 170, content: 'latest', timeline: [] }];
        const readProcess = vi.fn().mockResolvedValue({
            process: { conversationTurns: turns },
            history: { oldestTurnIndex: 170, hasMore: true, totalTurns: 200, historyRevision: 0 },
        });
        const opts = options({ readProcess });
        renderHook(() => useQueuedTaskPoll(opts));
        await act(async () => vi.advanceTimersByTime(2000));
        expect(readProcess).toHaveBeenCalledWith('queue_chat');
        expect(client.processes.get).not.toHaveBeenCalled();
        expect(opts.setTurnsAndRef).toHaveBeenCalledWith(turns);
    });
    it('keeps streaming placeholders on a paged transition to running', async () => {
        client.queue.getTask.mockResolvedValue({ task: { status: 'running', processId: 'queue_chat' } });
        const readProcess = vi.fn().mockResolvedValue({
            process: { conversationTurns: [{ role: 'assistant', turnIndex: 199, content: 'partial', timeline: [] }] },
            history: { oldestTurnIndex: 170, hasMore: true, totalTurns: 200, historyRevision: 0 },
        });
        const opts = options({ readProcess });
        renderHook(() => useQueuedTaskPoll(opts));
        await act(async () => vi.advanceTimersByTime(2000));
        expect(opts.setTurnsAndRef).toHaveBeenCalledWith([expect.objectContaining({ turnIndex: 199, streaming: true })]);
    });
    it('drops delayed hydration after switching chats', async () => {
        client.queue.getTask.mockResolvedValue({ task: { status: 'completed', processId: 'queue_chat' } });
        let resolve!: (value: unknown) => void;
        const readProcess = vi.fn().mockReturnValue(new Promise(r => { resolve = r; }));
        const opts = options({ readProcess });
        const view = renderHook(({ id }) => useQueuedTaskPoll({ ...opts, taskId: id }), { initialProps: { id: 'queue_chat' } });
        await act(async () => vi.advanceTimersByTime(2000));
        view.rerender({ id: 'queue_other' });
        await act(async () => resolve({ process: { conversationTurns: [{ role: 'user', content: 'late', timeline: [] }] } }));
        expect(opts.setTurnsAndRef).not.toHaveBeenCalled();
        expect(opts.setProcessDetails).not.toHaveBeenCalled();
    });
    it('preserves the unparameterized default reader for other callers', async () => {
        client.queue.getTask.mockResolvedValue({ task: { status: 'completed', processId: 'queue_chat' } });
        client.processes.get.mockResolvedValue({ process: { conversationTurns: [] } });
        const opts = options();
        renderHook(() => useQueuedTaskPoll(opts));
        await act(async () => vi.advanceTimersByTime(2000));
        expect(client.processes.get).toHaveBeenCalledWith('queue_chat', undefined);
    });
});
