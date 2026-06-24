/**
 * Tests for ChatPreferencesContext — provider, reducer, actions,
 * edge cases, and hook guard.
 *
 * Pin/archive state is no longer auto-fetched. It is set externally via
 * dispatch({ type: 'SET_ALL', ... }). Mutations call dedicated REST
 * endpoints from pinArchiveApi.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';

vi.mock('../../../src/server/spa/client/react/queue/hooks/pinArchiveApi', () => ({
    pinProcess: vi.fn().mockResolvedValue(undefined),
    unpinProcess: vi.fn().mockResolvedValue(undefined),
    archiveProcess: vi.fn().mockResolvedValue(undefined),
    unarchiveProcess: vi.fn().mockResolvedValue(undefined),
    archiveProcesses: vi.fn().mockResolvedValue(undefined),
    unarchiveProcesses: vi.fn().mockResolvedValue(undefined),
}));

import {
    pinProcess,
    unpinProcess,
    archiveProcess,
    unarchiveProcess,
    archiveProcesses,
    unarchiveProcesses,
} from '../../../src/server/spa/client/react/queue/hooks/pinArchiveApi';
import {
    ChatPreferencesProvider,
    useChatPrefs,
    chatPrefsReducer,
    type ChatPrefsState,
} from '../../../src/server/spa/client/react/contexts/ChatPreferencesContext';

const mockPinProcess = vi.mocked(pinProcess);
const mockUnpinProcess = vi.mocked(unpinProcess);
const mockArchiveProcess = vi.mocked(archiveProcess);
const mockUnarchiveProcess = vi.mocked(unarchiveProcess);
const mockArchiveProcesses = vi.mocked(archiveProcesses);
const mockUnarchiveProcesses = vi.mocked(unarchiveProcesses);

function makeWrapper(workspaceId: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <ChatPreferencesProvider workspaceId={workspaceId}>{children}</ChatPreferencesProvider>;
    };
}

/** Render the hook and dispatch SET_ALL to initialise state. */
function renderWithState(workspaceId: string, pinnedIds: string[] = [], archivedIds: string[] = []) {
    const hook = renderHook(() => useChatPrefs(), { wrapper: makeWrapper(workspaceId) });
    act(() => {
        hook.result.current.dispatch({ type: 'SET_ALL', pinnedIds, archivedIds, workspaceId });
    });
    return hook;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockPinProcess.mockResolvedValue(undefined);
    mockUnpinProcess.mockResolvedValue(undefined);
    mockArchiveProcess.mockResolvedValue(undefined);
    mockUnarchiveProcess.mockResolvedValue(undefined);
    mockArchiveProcesses.mockResolvedValue(undefined);
    mockUnarchiveProcesses.mockResolvedValue(undefined);
});

// ── Reducer unit tests ─────────────────────────────────────────────────────

describe('chatPrefsReducer', () => {
    const initial: ChatPrefsState = { pinnedIds: [], archivedIds: [], loaded: false, workspaceId: '' };

    it('SET_ALL populates all fields and sets loaded=true', () => {
        const result = chatPrefsReducer(initial, {
            type: 'SET_ALL',
            pinnedIds: ['t1'],
            archivedIds: ['t2'],
            workspaceId: 'ws1',
        });
        expect(result.pinnedIds).toEqual(['t1']);
        expect(result.archivedIds).toEqual(['t2']);
        expect(result.workspaceId).toBe('ws1');
        expect(result.loaded).toBe(true);
    });

    it('RESET returns initial state', () => {
        const state: ChatPrefsState = { pinnedIds: ['t1'], archivedIds: ['t2'], loaded: true, workspaceId: 'ws1' };
        const result = chatPrefsReducer(state, { type: 'RESET' });
        expect(result).toEqual({ pinnedIds: [], archivedIds: [], loaded: false, workspaceId: '' });
    });

    it('PIN prepends id', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'b' });
        expect(result.pinnedIds).toEqual(['b', 'a']);
    });

    it('PIN is a no-op when id already present', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'a' });
        expect(result).toBe(state);
    });

    it('PIN removes taskId from archivedIds when archived', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a', 'b'] };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'a' });
        expect(result.pinnedIds).toEqual(['a']);
        expect(result.archivedIds).toEqual(['b']);
    });

    it('PIN does not touch archivedIds when taskId is not archived', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['x'] };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'y' });
        expect(result.pinnedIds).toEqual(['y']);
        expect(result.archivedIds).toEqual(['x']);
        expect(result.archivedIds).toBe(state.archivedIds); // same reference
    });

    it('PIN slices to MAX_PINNED=50', () => {
        const fiftyIds = Array.from({ length: 50 }, (_, i) => `id${i}`);
        const state: ChatPrefsState = { ...initial, pinnedIds: fiftyIds };
        const result = chatPrefsReducer(state, { type: 'PIN', taskId: 'new' });
        expect(result.pinnedIds).toHaveLength(50);
        expect(result.pinnedIds[0]).toBe('new');
        expect(result.pinnedIds.includes('id49')).toBe(false);
    });

    it('UNPIN removes id', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a', 'b'] };
        const result = chatPrefsReducer(state, { type: 'UNPIN', taskId: 'a' });
        expect(result.pinnedIds).toEqual(['b']);
    });

    it('UNPIN is a no-op when id absent', () => {
        const state: ChatPrefsState = { ...initial, pinnedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'UNPIN', taskId: 'x' });
        expect(result).toBe(state);
    });

    it('ARCHIVE prepends id', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'ARCHIVE', taskId: 'b' });
        expect(result.archivedIds).toEqual(['b', 'a']);
    });

    it('ARCHIVE is a no-op when id already present', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'ARCHIVE', taskId: 'a' });
        expect(result).toBe(state);
    });

    it('UNARCHIVE removes id', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a', 'b'] };
        const result = chatPrefsReducer(state, { type: 'UNARCHIVE', taskId: 'a' });
        expect(result.archivedIds).toEqual(['b']);
    });

    it('UNARCHIVE is a no-op when id absent', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'UNARCHIVE', taskId: 'x' });
        expect(result).toBe(state);
    });

    it('ARCHIVE_MANY prepends new ids and deduplicates', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'ARCHIVE_MANY', taskIds: ['b', 'c', 'a'] });
        expect(result.archivedIds).toEqual(['b', 'c', 'a']);
    });

    it('ARCHIVE_MANY is a no-op when all ids already present', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a', 'b'] };
        const result = chatPrefsReducer(state, { type: 'ARCHIVE_MANY', taskIds: ['a', 'b'] });
        expect(result).toBe(state);
    });

    it('UNARCHIVE_MANY removes all specified ids', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a', 'b', 'c'] };
        const result = chatPrefsReducer(state, { type: 'UNARCHIVE_MANY', taskIds: ['a', 'c'] });
        expect(result.archivedIds).toEqual(['b']);
    });

    it('UNARCHIVE_MANY is a no-op when none are present', () => {
        const state: ChatPrefsState = { ...initial, archivedIds: ['a'] };
        const result = chatPrefsReducer(state, { type: 'UNARCHIVE_MANY', taskIds: ['x', 'y'] });
        expect(result).toBe(state);
    });
});

// ── Provider + hook integration tests ─────────────────────────────────────

describe('ChatPreferencesProvider', () => {
    // Test 1: loaded becomes true after SET_ALL dispatch
    it('1. loaded is false initially, becomes true after SET_ALL dispatch', () => {
        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });

        expect(result.current.loaded).toBe(false);

        act(() => {
            result.current.dispatch({
                type: 'SET_ALL',
                pinnedIds: ['t1'],
                archivedIds: ['t2'],
                workspaceId: 'ws1',
            });
        });

        expect(result.current.loaded).toBe(true);
        expect(result.current.pinnedChatIds.has('t1')).toBe(true);
        expect(result.current.archivedChatIds.has('t2')).toBe(true);
    });

    // Test 2: starts with empty state before SET_ALL
    it('2. starts with empty state and loaded=false before SET_ALL', () => {
        const { result } = renderHook(() => useChatPrefs(), { wrapper: makeWrapper('ws1') });

        expect(result.current.loaded).toBe(false);
        expect(result.current.pinnedChatIds.size).toBe(0);
        expect(result.current.archivedChatIds.size).toBe(0);
    });

    // Test 3: PIN action — idempotent
    it('3. PIN action adds id; calling again is a no-op', () => {
        const { result } = renderWithState('ws1');

        act(() => { result.current.pinChat('newId'); });
        expect(result.current.pinnedChatIds.has('newId')).toBe(true);
        const sizeAfterFirst = result.current.pinnedChatIds.size;

        act(() => { result.current.pinChat('newId'); });
        expect(result.current.pinnedChatIds.size).toBe(sizeAfterFirst);
    });

    // Test 4: UNPIN action
    it('4. UNPIN action removes pinned id', () => {
        const { result } = renderWithState('ws1', ['t1']);

        act(() => { result.current.unpinChat('t1'); });
        expect(result.current.pinnedChatIds.has('t1')).toBe(false);
        expect(result.current.pinnedChatIds.size).toBe(0);
    });

    // Test 5: ARCHIVE action
    it('5. ARCHIVE action adds id', () => {
        const { result } = renderWithState('ws1');

        act(() => { result.current.archiveChat('a1'); });
        expect(result.current.archivedChatIds.has('a1')).toBe(true);
    });

    // Test 6: UNARCHIVE action
    it('6. UNARCHIVE action removes archived id', () => {
        const { result } = renderWithState('ws1', [], ['a1']);

        act(() => { result.current.unarchiveChat('a1'); });
        expect(result.current.archivedChatIds.has('a1')).toBe(false);
    });

    // Test 7: MAX_PINNED cap
    it('7. MAX_PINNED cap — 50 pinned ids, adding one more keeps size at 50 (newest first)', () => {
        const fiftyIds = Array.from({ length: 50 }, (_, i) => `id${i}`);
        const { result } = renderWithState('ws1', fiftyIds);

        act(() => { result.current.pinChat('newId'); });

        expect(result.current.pinnedChatIds.size).toBe(50);
        expect(result.current.pinnedChatIds.has('newId')).toBe(true);
        expect(result.current.pinnedChatIds.has('id49')).toBe(false); // oldest dropped
    });

    // Test 8: RESET then SET_ALL simulates workspace switch
    it('8. RESET clears state, then SET_ALL loads new workspace data', () => {
        const { result } = renderWithState('ws1', ['t1']);

        expect(result.current.loaded).toBe(true);
        expect(result.current.pinnedChatIds.has('t1')).toBe(true);

        act(() => { result.current.dispatch({ type: 'RESET' }); });
        expect(result.current.loaded).toBe(false);
        expect(result.current.pinnedChatIds.size).toBe(0);

        act(() => {
            result.current.dispatch({
                type: 'SET_ALL',
                pinnedIds: ['t2'],
                archivedIds: [],
                workspaceId: 'ws2',
            });
        });
        expect(result.current.loaded).toBe(true);
        expect(result.current.pinnedChatIds.has('t2')).toBe(true);
        expect(result.current.pinnedChatIds.has('t1')).toBe(false);
    });

    // Test 9: useChatPrefs throws outside provider
    it('9. useChatPrefs throws when used outside ChatPreferencesProvider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => {
            renderHook(() => useChatPrefs());
        }).toThrow('useChatPrefs must be used within ChatPreferencesProvider');
        spy.mockRestore();
    });

    // Test 10: pinArchiveApi endpoints called on mutating actions
    it('10. pinProcess called with correct id on pinChat', () => {
        const { result } = renderWithState('ws1', ['t0']);

        act(() => { result.current.pinChat('newPin'); });

        expect(mockPinProcess).toHaveBeenCalledWith('newPin', 'ws1');
    });

    it('10b. archiveProcess called with correct id on archiveChat', () => {
        const { result } = renderWithState('ws1', [], ['a0']);

        act(() => { result.current.archiveChat('newArchive'); });

        expect(mockArchiveProcess).toHaveBeenCalledWith('newArchive', 'ws1');
    });

    it('10c. unpinProcess called on unpinChat', () => {
        const { result } = renderWithState('ws1', ['t1']);

        act(() => { result.current.unpinChat('t1'); });

        expect(mockUnpinProcess).toHaveBeenCalledWith('t1', 'ws1');
    });

    it('10d. unarchiveProcess called on unarchiveChat', () => {
        const { result } = renderWithState('ws1', [], ['a1']);

        act(() => { result.current.unarchiveChat('a1'); });

        expect(mockUnarchiveProcess).toHaveBeenCalledWith('a1', 'ws1');
    });

    it('10e. archiveProcesses called on archiveChats', () => {
        const { result } = renderWithState('ws1');

        act(() => { result.current.archiveChats(['a1', 'a2']); });

        expect(mockArchiveProcesses).toHaveBeenCalledWith(['a1', 'a2'], 'ws1');
    });

    it('11. pinChat on archived chat removes from archivedChatIds and no separate unarchive API call', () => {
        const { result } = renderWithState('ws1', [], ['archivedTask']);

        expect(result.current.archivedChatIds.has('archivedTask')).toBe(true);

        act(() => { result.current.pinChat('archivedTask'); });

        // Should be pinned
        expect(result.current.pinnedChatIds.has('archivedTask')).toBe(true);
        // Should no longer be archived
        expect(result.current.archivedChatIds.has('archivedTask')).toBe(false);
        // Only pinProcess should be called (server auto-unarchives)
        expect(mockPinProcess).toHaveBeenCalledWith('archivedTask', 'ws1');
        expect(mockUnarchiveProcess).not.toHaveBeenCalled();
    });

    it('11b. pinChat on non-archived chat does not touch archivedChatIds', () => {
        const { result } = renderWithState('ws1', [], ['otherArchived']);

        act(() => { result.current.pinChat('freshTask'); });

        expect(result.current.pinnedChatIds.has('freshTask')).toBe(true);
        expect(result.current.archivedChatIds.has('otherArchived')).toBe(true);
        expect(result.current.archivedChatIds.size).toBe(1);
    });

    it('11c. unpinChat does NOT re-archive the chat', () => {
        // Start with a pinned-and-not-archived chat
        const { result } = renderWithState('ws1', ['t1'], []);

        act(() => { result.current.unpinChat('t1'); });

        expect(result.current.pinnedChatIds.has('t1')).toBe(false);
        // Must NOT appear in archived
        expect(result.current.archivedChatIds.has('t1')).toBe(false);
        expect(mockArchiveProcess).not.toHaveBeenCalled();
    });

    it('10f. unarchiveProcesses called on unarchiveChats', () => {
        const { result } = renderWithState('ws1', [], ['a1', 'a2']);

        act(() => { result.current.unarchiveChats(['a1', 'a2']); });

        expect(mockUnarchiveProcesses).toHaveBeenCalledWith(['a1', 'a2'], 'ws1');
    });
});
