import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBotControlUpdates } from '../../../../src/server/spa/client/react/features/chat/hooks/useBotControlUpdates';

const control = { state: 'active', source: 'teams', controllerLabel: 'Teams bridge' };
const process = { id: 'queue_chat', workspaceId: 'ws-example', botControl: control };
const message = { type: 'process-updated', process };
const remote = 'https://clone.example.test';

function emit(name: string, detail: unknown) {
    act(() => window.dispatchEvent(new CustomEvent(name, { detail })));
}

describe('owning-server bot control updates', () => {
    it('forwards compaction lifecycle only from the owning workspace and remote server', () => {
        const update = vi.fn();
        renderHook(() => useBotControlUpdates(remote, 'ws-example', update));
        const compaction = { state: 'queued', taskId: 'compact', customInstructions: 'keep decisions' };
        const compactMessage = { ...message, process: { ...process, compaction } };
        emit('coc-local-ws-message', compactMessage);
        emit('coc-remote-ws-message', { baseUrl: 'https://other.example.test', message: compactMessage });
        expect(update).not.toHaveBeenCalled();
        emit('coc-remote-ws-message', { baseUrl: remote, message: compactMessage });
        expect(update).toHaveBeenCalledWith({ processId: process.id, workspaceId: process.workspaceId, control, compaction });
    });

    it('forwards Sentinel auto-compact state from the owning remote server only', () => {
        const update = vi.fn();
        renderHook(() => useBotControlUpdates(remote, 'ws-example', update));
        const autoCompact = { enabled: true, thresholdPercent: 85, taskId: 'auto' };
        const autoMessage = { ...message, process: { ...process, autoCompact } };
        emit('coc-remote-ws-message', { baseUrl: 'https://other.example.test', message: autoMessage });
        expect(update).not.toHaveBeenCalled();
        emit('coc-remote-ws-message', { baseUrl: remote, message: autoMessage });
        expect(update).toHaveBeenCalledWith({ processId: process.id, workspaceId: process.workspaceId, control, autoCompact });
    });

    it('observes local authoritative claims and omission releases, not automation messages', () => {
        const update = vi.fn();
        renderHook(() => useBotControlUpdates(undefined, 'ws-example', update));
        emit('coc-local-ws-message', message);
        expect(update).toHaveBeenLastCalledWith({ processId: process.id, workspaceId: process.workspaceId, control });
        emit('coc-local-ws-message', { type: 'cron-updated', process });
        emit('coc-local-ws-message', { ...message, process: { ...process, workspaceId: 'ws-other' } });
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        expect(update).toHaveBeenCalledTimes(1);
        emit('coc-local-ws-message', { ...message, process: { id: process.id, workspaceId: process.workspaceId } });
        expect(update).toHaveBeenLastCalledWith({ processId: process.id, workspaceId: process.workspaceId, control: undefined });
    });

    it('accepts only the exact remote owner even with colliding workspace/process IDs', () => {
        const update = vi.fn();
        renderHook(() => useBotControlUpdates(remote, 'ws-example', update));
        emit('coc-local-ws-message', message);
        emit('coc-remote-ws-message', { baseUrl: 'https://other.example.test', message });
        emit('coc-remote-ws-message', { baseUrl: remote, message: { ...message, process: { ...process, workspaceId: 'ws-other' } } });
        expect(update).not.toHaveBeenCalled();
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        expect(update).toHaveBeenCalledOnce();
    });

    it('switches owners, keeps the latest callback, and unsubscribes on unmount', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender, unmount } = renderHook(
            ({ owner, callback }) => useBotControlUpdates(owner, 'ws-example', callback),
            { initialProps: { owner: remote, callback: first } },
        );
        rerender({ owner: 'https://other.example.test', callback: second });
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
        emit('coc-remote-ws-message', { baseUrl: 'https://other.example.test', message });
        expect(second).toHaveBeenCalledOnce();
        unmount();
        emit('coc-remote-ws-message', { baseUrl: 'https://other.example.test', message });
        expect(second).toHaveBeenCalledOnce();
    });

    it('clears invalid public values rather than reading private metadata', () => {
        const update = vi.fn();
        renderHook(() => useBotControlUpdates(undefined, undefined, update));
        emit('coc-local-ws-message', { type: 'process-added', process: { ...process, botControl: { ...control, controllerKey: 'teams-bridge' } } });
        expect(update.mock.calls[0][0].control).toBeUndefined();
        emit('coc-local-ws-message', { type: 'process-added', process: { id: process.id, metadata: { botControl: control } } });
        expect(update.mock.calls[1][0].control).toBeUndefined();
    });
});
