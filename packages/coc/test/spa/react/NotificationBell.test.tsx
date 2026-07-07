/**
 * Tests for NotificationBell — badge, panel open/close, empty state, entry rendering, navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NotificationBell } from '../../../src/server/spa/client/react/shared/NotificationBell';
import type { NotificationContextValue } from '../../../src/server/spa/client/react/contexts/NotificationContext';

// ── Mocks ───────────────────────────────────────────────────────

const mockDispatch = vi.fn();
const mockFloatChat = vi.fn();

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { activeTab: 'repos' }, dispatch: mockDispatch }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/FloatingChatsContext', () => ({
    useFloatingChats: () => ({ floatChat: mockFloatChat }),
}));

const mockCtx: NotificationContextValue = {
    notifications: [],
    unreadCount: 0,
    addNotification: vi.fn(),
    markAllRead: vi.fn(),
    markReadByProcessId: vi.fn(),
    clearAll: vi.fn(),
};

vi.mock('../../../src/server/spa/client/react/contexts/NotificationContext', () => ({
    useNotifications: () => mockCtx,
}));

function setMockCtx(overrides: Partial<NotificationContextValue>) {
    Object.assign(mockCtx, {
        notifications: [],
        unreadCount: 0,
        addNotification: vi.fn(),
        markAllRead: vi.fn(),
        markReadByProcessId: vi.fn(),
        clearAll: vi.fn(),
        ...overrides,
    });
}

beforeEach(() => {
    setMockCtx({});
    mockDispatch.mockClear();
    mockFloatChat.mockClear();
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

    it('opens downward and right-aligns by default', () => {
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        const panel = screen.getByTestId('notification-panel');
        expect(panel.getAttribute('data-placement')).toBe('down');
        expect(panel.className).toContain('top-full');
        expect(panel.className).not.toContain('bottom-full');
        expect(panel.className).toContain('right-0');
        expect(panel.className).not.toContain('left-0');
    });

    it('opens upward and left-aligns with placement="up" (bottom-docked sidebar footer)', () => {
        render(<NotificationBell placement="up" />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        const panel = screen.getByTestId('notification-panel');
        expect(panel.getAttribute('data-placement')).toBe('up');
        expect(panel.className).toContain('bottom-full');
        expect(panel.className).not.toContain('top-full');
        expect(panel.className).toContain('left-0');
        expect(panel.className).not.toContain('right-0');
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

    it('→ arrow without workspaceId dispatches processes-tab navigation actions', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'x', detail: '', timestamp: Date.now(), read: false, processId: 'proc-42' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-navigate')); });

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SELECT_PROCESS', id: 'proc-42' });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
    });

    it('→ arrow with workspaceId navigates to repo activity hash URL', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'x', detail: '', timestamp: Date.now(), read: false, processId: 'proc-99', workspaceId: 'repo-abc' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-navigate')); });

        expect(window.location.hash).toBe('#repos/repo-abc/activity/proc-99');
        // Should not dispatch process-tab actions
        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SELECT_PROCESS', id: 'proc-99' });
        expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
    });

    it('→ arrow with workspaceId closes the notification panel', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'x', detail: '', timestamp: Date.now(), read: false, processId: 'proc-99', workspaceId: 'repo-abc' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('notification-panel')).toBeTruthy();
        act(() => { fireEvent.click(screen.getByTestId('notification-navigate')); });
        expect(screen.queryByTestId('notification-panel')).toBeNull();
    });

    it('→ arrow with workspaceId containing special chars encodes the URL correctly', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'x', detail: '', timestamp: Date.now(), read: false, processId: 'proc/special', workspaceId: 'repo/with spaces' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-navigate')); });

        expect(window.location.hash).toBe('#repos/repo%2Fwith%20spaces/activity/proc%2Fspecial');
    });
});

// ── Float button ─────────────────────────────────────────────────

describe('NotificationBell — float button', () => {
    it('⧉ float button is rendered for entries with processId', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'foo completed', detail: '', timestamp: Date.now(), read: false, processId: 'p1' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('notification-float')).toBeTruthy();
    });

    it('⧉ float button is NOT rendered for entries without processId', () => {
        const entries = [
            { id: 'n2', type: 'error' as const, title: 'bar failed', detail: '', timestamp: Date.now(), read: true },
        ];
        setMockCtx({ notifications: entries });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.queryByTestId('notification-float')).toBeNull();
    });

    it('clicking ⧉ calls floatChat with correct args for success type', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: '[my-repo] task done', detail: '', timestamp: Date.now(), read: false, processId: 'proc-42', workspaceId: 'ws-1' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-float')); });

        expect(mockFloatChat).toHaveBeenCalledWith({
            taskId: 'proc-42',
            workspaceId: 'ws-1',
            title: 'task done',
            status: 'completed',
        });
    });

    it('clicking ⧉ maps error type to failed status', () => {
        const entries = [
            { id: 'n1', type: 'error' as const, title: 'something failed', detail: '', timestamp: Date.now(), read: false, processId: 'proc-5' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-float')); });

        expect(mockFloatChat).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });

    it('clicking ⧉ maps info type to running status', () => {
        const entries = [
            { id: 'n1', type: 'info' as const, title: 'in progress', detail: '', timestamp: Date.now(), read: false, processId: 'proc-6' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-float')); });

        expect(mockFloatChat).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    });

    it('clicking ⧉ closes the notification panel', () => {
        const entries = [
            { id: 'n1', type: 'success' as const, title: 'done', detail: '', timestamp: Date.now(), read: false, processId: 'proc-7' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        expect(screen.getByTestId('notification-panel')).toBeTruthy();
        act(() => { fireEvent.click(screen.getByTestId('notification-float')); });
        expect(screen.queryByTestId('notification-panel')).toBeNull();
    });

    it('title without repo tag is used as-is (truncated to 60 chars)', () => {
        const longTitle = 'a'.repeat(80);
        const entries = [
            { id: 'n1', type: 'success' as const, title: longTitle, detail: '', timestamp: Date.now(), read: false, processId: 'proc-8' },
        ];
        setMockCtx({ notifications: entries, unreadCount: 1 });
        render(<NotificationBell />);
        act(() => { fireEvent.click(screen.getByTestId('notification-bell')); });
        act(() => { fireEvent.click(screen.getByTestId('notification-float')); });

        expect(mockFloatChat).toHaveBeenCalledWith(expect.objectContaining({ title: 'a'.repeat(60) }));
    });
});
