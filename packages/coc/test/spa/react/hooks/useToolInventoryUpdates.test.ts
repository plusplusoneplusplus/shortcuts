import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToolInventoryUpdates } from '../../../../src/server/spa/client/react/features/chat/hooks/useToolInventoryUpdates';

const remote = 'https://owner.example.test';
const message = { type: 'tool-inventory-changed', workspaceId: 'ws-owner',
    processId: 'proc-1', turnId: 'new-turn', state: 'pending' };
function emit(name: string, detail: unknown) {
    act(() => { window.dispatchEvent(new CustomEvent(name, { detail })); });
}

describe('owner-scoped tool inventory invalidation', () => {
    it('invalidates at durable local turn start and capture, not optimistic sends or settings/status updates', () => {
        const { result } = renderHook(() => useToolInventoryUpdates(undefined, 'ws-owner', 'proc-1'));
        emit('coc-local-ws-message', { type: 'process-updated', process: { id: 'proc-1', status: 'running' } });
        emit('coc-local-ws-message', { type: 'config-changed' });
        emit('coc-local-ws-message', { ...message, state: 'queued' });
        emit('coc-local-ws-message', { ...message, turnId: undefined });
        emit('coc-local-ws-message', { ...message, workspaceId: 'other' });
        emit('coc-local-ws-message', { ...message, processId: 'other' });
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        expect(result.current).toBe(0);
        emit('coc-local-ws-message', message);
        expect(result.current).toBe(1);
        emit('coc-local-ws-message', { ...message, state: 'captured' });
        expect(result.current).toBe(2);
    });

    it('filters colliding IDs by exact remote endpoint and reconnects only to the owner', () => {
        const { result } = renderHook(() => useToolInventoryUpdates(remote, 'ws-owner', 'proc-1'));
        emit('coc-local-ws-message', message);
        emit('coc-local-ws-connect', {});
        emit('coc-remote-ws-message', { baseUrl: 'https://other.example.test', message });
        emit('coc-remote-ws-connect', { baseUrl: 'https://other.example.test' });
        emit('coc-remote-ws-message', { baseUrl: remote, message: { ...message, workspaceId: 'other' } });
        expect(result.current).toBe(0);
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        emit('coc-remote-ws-message', { baseUrl: remote, message: { ...message, state: 'captured' } });
        emit('coc-remote-ws-connect', { baseUrl: remote });
        expect(result.current).toBe(3);
    });

    it('cleans up on owner/process changes and unmount, and waits for known identity', () => {
        const { result, rerender, unmount } = renderHook(
            ({ owner, processId, workspaceId }) => useToolInventoryUpdates(owner, workspaceId, processId),
            { initialProps: { owner: remote, workspaceId: undefined as string | undefined, processId: undefined as string | undefined } },
        );
        emit('coc-remote-ws-connect', { baseUrl: remote });
        expect(result.current).toBe(0);
        rerender({ owner: remote, workspaceId: 'ws-owner', processId: 'proc-1' });
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        expect(result.current).toBe(1);
        rerender({ owner: 'https://next.example.test', workspaceId: 'ws-owner', processId: 'proc-2' });
        emit('coc-remote-ws-message', { baseUrl: remote, message });
        expect(result.current).toBe(1);
        emit('coc-remote-ws-message', { baseUrl: 'https://next.example.test', message: { ...message, processId: 'proc-2' } });
        expect(result.current).toBe(2);
        unmount();
        emit('coc-remote-ws-message', { baseUrl: 'https://next.example.test', message: { ...message, processId: 'proc-2' } });
        expect(result.current).toBe(2);
    });
});
