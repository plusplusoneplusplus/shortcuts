/**
 * Tests for useConversationPin — the chat header's Pin / Unpin conversation
 * action. Covers persisted initial state, sharing the chat list's pin state
 * (ChatPreferencesContext), owner-workspace routing with and without a list
 * provider, and rollback + error surfacing when the owning server rejects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

vi.mock('../../../../src/server/spa/client/react/queue/hooks/pinArchiveApi', () => ({
    pinProcess: vi.fn().mockResolvedValue(undefined),
    unpinProcess: vi.fn().mockResolvedValue(undefined),
    archiveProcess: vi.fn().mockResolvedValue(undefined),
    unarchiveProcess: vi.fn().mockResolvedValue(undefined),
    archiveProcesses: vi.fn().mockResolvedValue(undefined),
    unarchiveProcesses: vi.fn().mockResolvedValue(undefined),
}));

import { pinProcess, unpinProcess } from '../../../../src/server/spa/client/react/queue/hooks/pinArchiveApi';
import { ChatPreferencesProvider, useChatPrefs } from '../../../../src/server/spa/client/react/contexts/ChatPreferencesContext';
import { useConversationPin, type UseConversationPinOptions } from '../../../../src/server/spa/client/react/features/chat/hooks/useConversationPin';

const mockPin = vi.mocked(pinProcess);
const mockUnpin = vi.mocked(unpinProcess);

function withList(workspaceId: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <ChatPreferencesProvider workspaceId={workspaceId}>{children}</ChatPreferencesProvider>;
    };
}

/** Header hook + the chat list's view of the same provider. */
function renderWithList(workspaceId: string, options: UseConversationPinOptions, listPinned: string[] | null) {
    const hook = renderHook(
        (props: UseConversationPinOptions) => ({ pin: useConversationPin(props), list: useChatPrefs() }),
        { wrapper: withList(workspaceId), initialProps: options },
    );
    if (listPinned) {
        act(() => {
            hook.result.current.list.dispatch({ type: 'SET_ALL', pinnedIds: listPinned, archivedIds: [], workspaceId });
        });
    }
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockPin.mockResolvedValue(undefined);
    mockUnpin.mockResolvedValue(undefined);
});

describe('useConversationPin — initial state', () => {
    it('is unavailable until the process is known', () => {
        const { result } = renderHook(() => useConversationPin({ processId: null, persistedPinned: undefined }));
        expect(result.current.available).toBe(false);
        expect(result.current.isPinned).toBe(false);
    });

    it('reads the persisted pin state when no list provider is mounted', () => {
        const { result } = renderHook(() => useConversationPin({ processId: 'queue_a', persistedPinned: true }));
        expect(result.current.available).toBe(true);
        expect(result.current.isPinned).toBe(true);
    });

    it('treats a chat outside the loaded list page as pinned when persisted pinned', () => {
        const { result } = renderWithList('ws-1', { processId: 'queue_old', persistedPinned: true }, ['queue_other']);
        expect(result.current.pin.isPinned).toBe(true);
    });

    it('treats a chat the list shows pinned as pinned before process details settle', () => {
        const { result } = renderWithList('ws-1', { processId: 'queue_a', persistedPinned: false }, ['queue_a']);
        expect(result.current.pin.isPinned).toBe(true);
    });
});

describe('useConversationPin — shared state with the chat list', () => {
    it('pinning from the header adds the chat to the list Pinned set and persists via the list workspace', async () => {
        const { result } = renderWithList('ws-1', { processId: 'queue_a', persistedPinned: false }, []);
        act(() => { result.current.pin.togglePin(); });
        expect(result.current.pin.isPinned).toBe(true);
        expect(result.current.list.pinnedChatIds.has('queue_a')).toBe(true);
        expect(mockPin).toHaveBeenCalledWith('queue_a', 'ws-1');
        await waitFor(() => expect(result.current.pin.pending).toBe(false));
    });

    it('unpinning from the header removes the chat from the list Pinned set', async () => {
        const { result } = renderWithList('ws-1', { processId: 'queue_a', persistedPinned: true }, ['queue_a']);
        act(() => { result.current.pin.togglePin(); });
        expect(result.current.pin.isPinned).toBe(false);
        expect(result.current.list.pinnedChatIds.has('queue_a')).toBe(false);
        expect(mockUnpin).toHaveBeenCalledWith('queue_a', 'ws-1');
        await waitFor(() => expect(result.current.pin.pending).toBe(false));
    });

    it('follows a pin/unpin made from the chat list row', () => {
        const { result } = renderWithList('ws-1', { processId: 'queue_a', persistedPinned: true }, ['queue_a']);
        expect(result.current.pin.isPinned).toBe(true);
        act(() => { result.current.list.unpinChat('queue_a'); });
        // Persisted pinnedAt is stale now; the list action wins.
        expect(result.current.pin.isPinned).toBe(false);
        act(() => { result.current.list.pinChat('queue_a'); });
        expect(result.current.pin.isPinned).toBe(true);
    });

    it('does not carry a toggled value over to another conversation', async () => {
        const { result, rerender } = renderWithList('ws-1', { processId: 'queue_a', persistedPinned: false }, []);
        act(() => { result.current.pin.togglePin(); });
        await waitFor(() => expect(result.current.pin.pending).toBe(false));
        rerender({ processId: 'queue_b', persistedPinned: false });
        expect(result.current.pin.isPinned).toBe(false);
    });

    it('routes a repo-group / remote clone list through its own workspace key', async () => {
        const groupKey = 'remote:srv-1:group-xyz';
        const { result } = renderWithList(groupKey, { processId: 'queue_a', workspaceId: 'ignored-when-list', persistedPinned: false }, []);
        act(() => { result.current.pin.togglePin(); });
        expect(mockPin).toHaveBeenCalledWith('queue_a', groupKey);
        await waitFor(() => expect(result.current.pin.pending).toBe(false));
    });
});

describe('useConversationPin — without a chat list provider', () => {
    it('persists through the clone-routed helper using the chat workspace', async () => {
        const { result } = renderHook(() => useConversationPin({ processId: 'queue_a', workspaceId: 'remote:srv-2:ws-9', persistedPinned: false }));
        act(() => { result.current.togglePin(); });
        expect(result.current.isPinned).toBe(true);
        expect(mockPin).toHaveBeenCalledWith('queue_a', 'remote:srv-2:ws-9');
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(result.current.isPinned).toBe(true);
    });

    it('ignores toggles while a request is pending', () => {
        mockPin.mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useConversationPin({ processId: 'queue_a', persistedPinned: false }));
        act(() => { result.current.togglePin(); });
        expect(result.current.pending).toBe(true);
        act(() => { result.current.togglePin(); });
        expect(mockPin).toHaveBeenCalledTimes(1);
        expect(mockUnpin).not.toHaveBeenCalled();
    });
});

describe('useConversationPin — failures', () => {
    it('rolls back header and list state and reports the error', async () => {
        const err = new Error('forbidden');
        mockPin.mockRejectedValueOnce(err);
        const onError = vi.fn();
        const { result } = renderWithList('ws-1', { processId: 'queue_a', persistedPinned: false, onError }, []);
        act(() => { result.current.pin.togglePin(); });
        expect(result.current.pin.isPinned).toBe(true);
        await waitFor(() => expect(onError).toHaveBeenCalledWith(err, true));
        expect(result.current.pin.isPinned).toBe(false);
        expect(result.current.list.pinnedChatIds.has('queue_a')).toBe(false);
        expect(result.current.pin.pending).toBe(false);
    });

    it('rolls back an unpin without a list provider', async () => {
        mockUnpin.mockRejectedValueOnce(new Error('offline'));
        const onError = vi.fn();
        const { result } = renderHook(() => useConversationPin({ processId: 'queue_a', persistedPinned: true, onError }));
        act(() => { result.current.togglePin(); });
        expect(result.current.isPinned).toBe(false);
        await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        expect(onError.mock.calls[0][1]).toBe(false);
        expect(result.current.isPinned).toBe(true);
    });
});
