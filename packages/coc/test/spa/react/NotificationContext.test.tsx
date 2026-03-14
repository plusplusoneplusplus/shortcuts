/**
 * Tests for NotificationContext — add, unread count, mark-all-read, clear, max cap, ordering, hook guard.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
    NotificationProvider,
    useNotifications,
    notificationReducer,
    type NotificationEntry,
} from '../../../src/server/spa/client/react/context/NotificationContext';

function wrapper({ children }: { children: ReactNode }) {
    return <NotificationProvider>{children}</NotificationProvider>;
}

// ── Reducer unit tests ──────────────────────────────────────────

describe('notificationReducer', () => {
    const makeEntry = (id: string, read = false): NotificationEntry => ({
        id, type: 'success', title: `title-${id}`, detail: '', timestamp: Date.now(), read,
    });

    it('ADD prepends entry', () => {
        const state = { notifications: [makeEntry('a')] };
        const entry = makeEntry('b');
        const result = notificationReducer(state, { type: 'ADD', entry });
        expect(result.notifications[0].id).toBe('b');
        expect(result.notifications).toHaveLength(2);
    });

    it('ADD enforces max 20 entries', () => {
        const existing = Array.from({ length: 20 }, (_, i) => makeEntry(`e${i}`));
        const state = { notifications: existing };
        const entry = makeEntry('new');
        const result = notificationReducer(state, { type: 'ADD', entry });
        expect(result.notifications).toHaveLength(20);
        expect(result.notifications[0].id).toBe('new');
        expect(result.notifications[19].id).toBe('e18');
    });

    it('MARK_ALL_READ sets all entries to read', () => {
        const state = { notifications: [makeEntry('a', false), makeEntry('b', false), makeEntry('c', true)] };
        const result = notificationReducer(state, { type: 'MARK_ALL_READ' });
        expect(result.notifications.every(n => n.read)).toBe(true);
        expect(result.notifications).toHaveLength(3);
    });

    it('CLEAR_ALL empties notifications', () => {
        const state = { notifications: [makeEntry('a'), makeEntry('b')] };
        const result = notificationReducer(state, { type: 'CLEAR_ALL' });
        expect(result.notifications).toHaveLength(0);
    });
});

// ── Provider + hook integration tests ───────────────────────────

describe('NotificationProvider', () => {
    it('addNotification adds entry with auto-generated id and timestamp', () => {
        const { result } = renderHook(() => useNotifications(), { wrapper });

        act(() => {
            result.current.addNotification({ type: 'success', title: 'Test', detail: 'ok' });
        });

        expect(result.current.notifications).toHaveLength(1);
        expect(result.current.notifications[0].read).toBe(false);
        expect(result.current.notifications[0].id).toMatch(/^notif-/);
        expect(result.current.notifications[0].timestamp).toBeGreaterThan(0);
    });

    it('unreadCount reflects unread entries', () => {
        const { result } = renderHook(() => useNotifications(), { wrapper });

        act(() => {
            result.current.addNotification({ type: 'success', title: 'a', detail: '' });
            result.current.addNotification({ type: 'error', title: 'b', detail: '' });
            result.current.addNotification({ type: 'warning', title: 'c', detail: '' });
        });

        expect(result.current.unreadCount).toBe(3);

        act(() => { result.current.markAllRead(); });
        expect(result.current.unreadCount).toBe(0);
    });

    it('markAllRead sets all read: true, entries remain', () => {
        const { result } = renderHook(() => useNotifications(), { wrapper });

        act(() => {
            result.current.addNotification({ type: 'info', title: 'x', detail: '' });
            result.current.addNotification({ type: 'info', title: 'y', detail: '' });
        });

        act(() => { result.current.markAllRead(); });
        expect(result.current.notifications).toHaveLength(2);
        expect(result.current.notifications.every(n => n.read)).toBe(true);
    });

    it('clearAll empties notifications and unreadCount', () => {
        const { result } = renderHook(() => useNotifications(), { wrapper });

        act(() => {
            result.current.addNotification({ type: 'success', title: 'a', detail: '' });
        });

        act(() => { result.current.clearAll(); });
        expect(result.current.notifications).toHaveLength(0);
        expect(result.current.unreadCount).toBe(0);
    });

    it('max 20 entries enforced (oldest dropped)', () => {
        const { result } = renderHook(() => useNotifications(), { wrapper });

        act(() => {
            for (let i = 0; i < 21; i++) {
                result.current.addNotification({ type: 'info', title: `n${i}`, detail: '' });
            }
        });

        expect(result.current.notifications).toHaveLength(20);
        expect(result.current.notifications[0].title).toBe('n20');
    });

    it('entries ordered newest first', () => {
        const { result } = renderHook(() => useNotifications(), { wrapper });

        act(() => {
            result.current.addNotification({ type: 'info', title: 'first', detail: '' });
        });
        act(() => {
            result.current.addNotification({ type: 'info', title: 'second', detail: '' });
        });

        expect(result.current.notifications[0].title).toBe('second');
        expect(result.current.notifications[1].title).toBe('first');
    });

    it('useNotifications throws outside provider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        expect(() => {
            renderHook(() => useNotifications());
        }).toThrow('useNotifications must be used within <NotificationProvider>');
        spy.mockRestore();
    });
});
