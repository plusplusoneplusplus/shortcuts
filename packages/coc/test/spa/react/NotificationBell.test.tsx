/**
 * Tests for NotificationBell — badge, panel open/close, empty state, entry rendering, navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NotificationBell } from '../../../src/server/spa/client/react/shared/NotificationBell';
import type { NotificationContextValue } from '../../../src/server/spa/client/react/context/NotificationContext';

// ── Mocks ───────────────────────────────────────────────────────

const mockDispatch = vi.fn();

vi.mock('../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: { activeTab: 'repos' }, dispatch: mockDispatch }),
}));

const mockCtx: NotificationContextValue = {
    notifications: [],
    unreadCount: 0,
    addNotification: vi.fn(),
    markAllRead: vi.fn(),
    clearAll: vi.fn(),
};

vi.mock('../../../src/server/spa/client/react/context/NotificationContext', () => ({
    useNotifications: () => mockCtx,
}));

function setMockCtx(overrides: Partial<NotificationContextValue>) {
    Object.assign(mockCtx, {
        notifications: [],
        unreadCount: 0,
        addNotification: vi.fn(),
        markAllRead: vi.fn(),
        clearAll: vi.fn(),
        ...overrides,
    });
}

beforeEach(() => {
    setMockCtx({});
    mockDispatch.mockClear();
});

// ── Badge tests ─────────────────────────────────────────────────

describe('NotificationBell — badge', () => {
    it('no badge when unreadCount is 0', () => {
        setMockCtx({ unreadCount: 0 });
        render(<NotificationBell />);
        expect(screen.queryByTestId('notification-badge')).toBeNull();
    });

    it('badge shows count when unread > 0', () => {
        setMockCtx({ unreadCount: 3 });
        render(<NotificationBell />);
        const badge = screen.getByTestId('notification-badge');
        expect(badge.textContent).toBe('3');
    });

    it('badge shows 9+ when unread > 9', () => {
        setMockCtx({ unreadCount: 15 });
        render(<NotificationBell />);
        const badge = screen.getByTestId('notification-badge');
        expect(badge.textContent).toBe('9+');
    });
});

// ── Panel open / close ──────────────────────────────────────────

describe('NotificationBell — panel', () => {
    it('clicking bell opens panel', () => {
        render(<NotificationBell />);
        expect(screen.queryByTestId('notification-panel')).toBeNull();

        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('notification-panel')).toBeTruthy();
    });

    it('clicking bell again closes panel', () => {
        render(<NotificationBell />);
        const bell = screen.getByTestId('notification-bell');

        act(() => { fireEvent.click(bell); });
        expect(screen.getByTestId('notification-panel')).toBeTruthy();

        act(() => { fireEvent.click(bell); });
        expect(screen.queryByTestId('notification-panel')).toBeNull();
    });

    it('Escape key closes panel', () => {
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('notification-panel')).toBeTruthy();

        act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
        expect(screen.queryByTestId('notification-panel')).toBeNull();
    });

    it('outside click closes panel', () => {
        const { container } = render(<div><NotificationBell /><div data-testid="outside" /></div>);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('notification-panel')).toBeTruthy();

        act(() => { fireEvent.mouseDown(container); });
        expect(screen.queryByTestId('notification-panel')).toBeNull();
    });
});

// ── Empty state ─────────────────────────────────────────────────

describe('NotificationBell — empty state', () => {
    it('shows "No notifications yet" when no notifications', () => {
        setMockCtx({ notifications: [] });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('empty-state').textContent).toBe('No notifications yet');
    });
});

// ── Entry rendering ─────────────────────────────────────────────

describe('NotificationBell — entries', () => {
    const entries = [
        { id: 'n1', type: 'success' as const, title: 'foo completed', detail: '42s', timestamp: Date.now(), read: false, processId: 'p1' },
        { id: 'n2', type: 'error' as const, title: 'bar failed', detail: '10s', timestamp: Date.now() - 60000, read: true },
    ];

    it('renders title and detail', () => {
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });

        expect(screen.getByText('foo completed')).toBeTruthy();
        expect(screen.getByText('42s')).toBeTruthy();
        expect(screen.getByText('bar failed')).toBeTruthy();
    });

    it('unread entries have highlight class', () => {
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });

        const entryEls = screen.getAllByTestId('notification-entry');
        const unread = entryEls.find(el => el.getAttribute('data-read') === 'false');
        expect(unread?.className).toContain('bg-[#e8f0fe]');
    });

    it('read entries do not have highlight class', () => {
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });

        const entryEls = screen.getAllByTestId('notification-entry');
        const readEntry = entryEls.find(el => el.getAttribute('data-read') === 'true');
        expect(readEntry?.className).not.toContain('bg-[#e8f0fe]');
    });
});

// ── Actions ─────────────────────────────────────────────────────

describe('NotificationBell — actions', () => {
    it('markAllRead called on "Mark all read" click', () => {
        const markAllRead = vi.fn();
        setMockCtx({ markAllRead });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('mark-all-read')); });
        expect(markAllRead).toHaveBeenCalledOnce();
    });

    it('clearAll called on "Clear all" click', () => {
        const clearAll = vi.fn();
        const entries = [{ id: 'n1', type: 'info' as const, title: 't', detail: '', timestamp: Date.now(), read: true }];
        setMockCtx({ clearAll, notifications: entries });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('clear-all')); });
        expect(clearAll).toHaveBeenCalledOnce();
    });

    it('→ arrow dispatches navigation actions', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'x', detail: '', timestamp: Date.now(), read: false, processId: 'proc-42' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-navigate')); });

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_ID', id: 'proc-42' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
    });
});
