/**
 * Unit tests for FloatingChatsContext — float/unfloat/isFloating logic.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FloatingChatsProvider, useFloatingChats, type FloatingChatEntry } from '../../../../src/server/spa/client/react/context/FloatingChatsContext';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
    return <FloatingChatsProvider>{children}</FloatingChatsProvider>;
}

const makeEntry = (overrides: Partial<FloatingChatEntry> = {}): FloatingChatEntry => ({
    taskId: 'task-1',
    workspaceId: 'ws-1',
    title: 'My Chat',
    status: 'running',
    ...overrides,
});

describe('FloatingChatsContext', () => {
    it('starts with empty floatingChats', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        expect(result.current.floatingChats.size).toBe(0);
    });

    it('floatChat adds entry to the map', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        act(() => {
            result.current.floatChat(makeEntry());
        });
        expect(result.current.floatingChats.size).toBe(1);
        expect(result.current.floatingChats.get('task-1')).toBeDefined();
    });

    it('isFloating returns true after floatChat', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        act(() => {
            result.current.floatChat(makeEntry());
        });
        expect(result.current.isFloating('task-1')).toBe(true);
    });

    it('isFloating returns false for unknown taskId', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        expect(result.current.isFloating('unknown')).toBe(false);
    });

    it('unfloatChat removes entry from map', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        act(() => {
            result.current.floatChat(makeEntry());
        });
        act(() => {
            result.current.unfloatChat('task-1');
        });
        expect(result.current.floatingChats.size).toBe(0);
        expect(result.current.isFloating('task-1')).toBe(false);
    });

    it('unfloatChat is a no-op for unknown taskId', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        act(() => {
            result.current.floatChat(makeEntry());
        });
        act(() => {
            result.current.unfloatChat('does-not-exist');
        });
        expect(result.current.floatingChats.size).toBe(1);
    });

    it('supports multiple simultaneous floated chats', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        act(() => {
            result.current.floatChat(makeEntry({ taskId: 'task-1' }));
            result.current.floatChat(makeEntry({ taskId: 'task-2' }));
            result.current.floatChat(makeEntry({ taskId: 'task-3' }));
        });
        expect(result.current.floatingChats.size).toBe(3);
        expect(result.current.isFloating('task-1')).toBe(true);
        expect(result.current.isFloating('task-2')).toBe(true);
        expect(result.current.isFloating('task-3')).toBe(true);
    });

    it('floatChat updates an existing entry', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        act(() => {
            result.current.floatChat(makeEntry({ title: 'Old title', status: 'running' }));
        });
        act(() => {
            result.current.floatChat(makeEntry({ title: 'New title', status: 'completed' }));
        });
        expect(result.current.floatingChats.size).toBe(1);
        expect(result.current.floatingChats.get('task-1')?.title).toBe('New title');
        expect(result.current.floatingChats.get('task-1')?.status).toBe('completed');
    });

    it('preserves entry data', () => {
        const { result } = renderHook(() => useFloatingChats(), { wrapper });
        const entry = makeEntry({ taskId: 'task-abc', workspaceId: 'ws-xyz', title: 'Hello World', status: 'completed' });
        act(() => {
            result.current.floatChat(entry);
        });
        const stored = result.current.floatingChats.get('task-abc');
        expect(stored?.taskId).toBe('task-abc');
        expect(stored?.workspaceId).toBe('ws-xyz');
        expect(stored?.title).toBe('Hello World');
        expect(stored?.status).toBe('completed');
    });
});
