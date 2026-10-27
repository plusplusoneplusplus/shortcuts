/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastContext } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import { MARK_ALL_READ_TIMEOUT_MS, RailUnreadChats, NativeRailUnreadChats } from '../../../../src/server/spa/client/react/features/chat/RailUnreadChats';
import { RailControlsContext } from '../../../../src/server/spa/client/react/features/repo-detail/RailHoverPreview';
import { ChatPreferencesContext } from '../../../../src/server/spa/client/react/contexts/chatPrefsConsumer';

let excludedTypes: string[] = [];
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { myWorkExcludedTypes: excludedTypes } }),
}));
const expand = vi.fn();
const preview = vi.fn();
const open = vi.fn();
const addToast = vi.fn();
const rows = [{ key: 'a', title: 'Unread answer', href: '#repos/a/chats/queue_a', open }];
function panel(props: Partial<React.ComponentProps<typeof RailUnreadChats>> = {}, hoverEnabled = true) {
    return <ToastContext.Provider value={{ addToast, removeToast: vi.fn(), toasts: [] }}>
        <RailControlsContext.Provider value={{ hoverEnabled, onExpand: expand, onPreview: preview }}>
            <RailUnreadChats scopeKey="local:a" scopeLabel="Alpha" rows={rows} {...props} />
        </RailControlsContext.Provider>
    </ToastContext.Provider>;
}
const trigger = () => screen.getByTestId('split-workspace-left-unread');
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    excludedTypes = [];
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
        readonly pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerType = init.pointerType ?? 'mouse';
        }
    });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Unread rail preview', () => {
    it('offers Mark all read in the header without mutating on hover, and prevents duplicate busy clicks', async () => {
        let finish!: () => void;
        const onMarkAllRead = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const { rerender } = render(panel({ onMarkAllRead }));
        fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
        tick(200);
        const action = screen.getByRole('button', { name: 'Mark all read' });
        expect(action.closest('header')).toBeTruthy();
        expect(onMarkAllRead).not.toHaveBeenCalled();
        fireEvent.pointerLeave(trigger());
        fireEvent.pointerEnter(action);
        tick(300);
        expect(screen.getByRole('dialog')).toBeTruthy();
        act(() => action.focus());
        expect(onMarkAllRead).not.toHaveBeenCalled();
        fireEvent.click(action);
        expect(screen.getByRole('button', { name: 'Marking…' })).toBeDisabled();
        fireEvent.click(action);
        expect(onMarkAllRead).toHaveBeenCalledTimes(1);
        await act(async () => { finish(); });
        expect(screen.getByRole('button', { name: 'Mark all read' })).toBeEnabled();
        rerender(panel({ rows: [], onMarkAllRead }));
        expect(trigger()).toHaveAccessibleName('0 unread conversations');
        expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close unread preview' }));
        expect(open).not.toHaveBeenCalled();
        expect(expand).not.toHaveBeenCalled();
    });

    it.each(['keyboard', 'touch'])('activates the header action with %s and preserves the preview', async input => {
        vi.useRealTimers();
        const onMarkAllRead = vi.fn().mockResolvedValue(undefined);
        render(panel({ onMarkAllRead }));
        if (input === 'keyboard') {
            const user = userEvent.setup();
            act(() => trigger().focus());
            await user.keyboard('{ArrowRight}');
            expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveFocus();
            expect(onMarkAllRead).not.toHaveBeenCalled();
            await user.keyboard('{Enter}');
        } else {
            fireEvent.pointerDown(trigger(), { pointerType: 'touch' });
            fireEvent.click(trigger());
            const action = screen.getByRole('button', { name: 'Mark all read' });
            fireEvent.pointerDown(action, { pointerType: 'touch' });
            await act(async () => { fireEvent.click(action); });
        }
        expect(onMarkAllRead).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(open).not.toHaveBeenCalled();
        expect(expand).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Close unread preview' }), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(trigger()).toHaveFocus();
    });

    it('keeps unread rows visible after failure and disables unavailable partial scopes', async () => {
        const onMarkAllRead = vi.fn().mockRejectedValue(new Error('Some repositories failed; unread conversations remain.'));
        const { rerender } = render(panel({ onMarkAllRead }));
        fireEvent.click(trigger());
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); });
        expect(screen.getByRole('alert')).toHaveTextContent('unread conversations remain');
        expect(addToast).toHaveBeenCalledWith('Some repositories failed; unread conversations remain.', 'error');
        expect(screen.getByRole('link', { name: 'Unread answer' })).toBeTruthy();
        expect(trigger()).toHaveAccessibleName('1 unread conversation');
        rerender(panel({ onMarkAllRead, partial: true, markAllReadDisabledReason: 'Some repos are offline.' }));
        const action = screen.getByRole('button', { name: 'Mark all read' });
        expect(action).toBeDisabled();
        expect(action).toHaveAttribute('title', 'Some repos are offline.');
        fireEvent.click(action);
        expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    });

    it('releases a request that ignores its signal at the deadline with a retryable error', async () => {
        const stalled = vi.fn((_signal: AbortSignal) => new Promise<void>(() => {}));
        render(panel({ onMarkAllRead: stalled }));
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(MARK_ALL_READ_TIMEOUT_MS - 1); });
        expect(screen.getByRole('button', { name: 'Marking…' })).toBeDisabled();
        expect(stalled.mock.calls[0][0].aborted).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(stalled.mock.calls[0][0].aborted).toBe(true);
        expect(screen.getByRole('alert')).toHaveTextContent('timed out');
        expect(addToast).toHaveBeenCalledWith(expect.stringContaining('try again'), 'error');
        expect(screen.getByRole('link', { name: 'Unread answer' })).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); });
        expect(stalled).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('drops the deadline when the scope unmounts mid-run', async () => {
        const stalled = vi.fn((_signal: AbortSignal) => new Promise<void>(() => {}));
        const { unmount } = render(panel({ onMarkAllRead: stalled }));
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        unmount();
        expect(stalled.mock.calls[0][0].aborted).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(MARK_ALL_READ_TIMEOUT_MS); });
        expect(addToast).not.toHaveBeenCalled();
    });

    it('aborts old-scope work and ignores its late failure without blocking a new owner', async () => {
        let reject!: (error: Error) => void;
        const oldAction = vi.fn((_signal: AbortSignal) => new Promise<void>((_resolve, fail) => { reject = fail; }));
        const nextAction = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(panel({ onMarkAllRead: oldAction }));
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        rerender(panel({ scopeKey: 'remote:other:a', onMarkAllRead: nextAction }));
        expect(oldAction.mock.calls[0][0].aborted).toBe(true);
        await act(async () => { reject(new Error('Old owner failure')); });
        fireEvent.click(trigger());
        expect(screen.queryByRole('alert')).toBeNull();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark all read' })); });
        expect(nextAction).toHaveBeenCalledTimes(1);
    });

    it('clears an aborted busy state when returning to a prior scope before its response arrives', async () => {
        const oldAction = vi.fn(() => new Promise<void>(() => {}));
        const nextAction = vi.fn().mockResolvedValue(undefined);
        const { rerender } = render(panel({ onMarkAllRead: oldAction }));
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        rerender(panel({ scopeKey: 'remote:other:a', onMarkAllRead: nextAction }));
        rerender(panel({ onMarkAllRead: nextAction }));
        fireEvent.click(trigger());
        const action = screen.getByRole('button', { name: 'Mark all read' });
        expect(action).toBeEnabled();
        await act(async () => { fireEvent.click(action); });
        expect(nextAction).toHaveBeenCalledTimes(1);
    });

    it('opens after hover delay, bridges to the scrollable preview and dismisses after leave', () => {
        render(panel());
        fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
        tick(199);
        expect(screen.queryByRole('dialog')).toBeNull();
        tick(1);
        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('overflow-auto');
        expect(dialog.style.maxHeight).not.toBe('');
        expect(dialog.className).toContain('dark:bg-');
        fireEvent.pointerLeave(trigger());
        tick(100);
        fireEvent.pointerEnter(screen.getByTestId('rail-job-preview-bridge'));
        tick(300);
        expect(screen.getByRole('dialog')).toBe(dialog);
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
        fireEvent(dialog, wheel);
        expect(wheel.defaultPrevented).toBe(false);
        expect(open).not.toHaveBeenCalled();
        expect(expand).not.toHaveBeenCalled();
        expect(preview).toHaveBeenCalled();
        fireEvent.pointerLeave(dialog);
        tick(249);
        expect(screen.getByRole('dialog')).toBeTruthy();
        tick(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('supports focus, keyboard entry, Escape focus return and outside dismissal', () => {
        render(panel());
        act(() => trigger().focus());
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close unread preview' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
        fireEvent.click(trigger());
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(open).not.toHaveBeenCalled();
    });

    it('supports touch/click preview entry and only selects a conversation on its link', () => {
        render(panel({}, false));
        fireEvent.pointerEnter(trigger(), { pointerType: 'touch' });
        tick(300);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.pointerDown(trigger(), { pointerType: 'touch' });
        fireEvent.click(trigger());
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(open).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('link', { name: 'Unread answer' }));
        expect(open).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(expand).not.toHaveBeenCalled();
    });

    it('updates the count and rows live, retains a zero-count empty preview, and resets by owner', () => {
        const { rerender } = render(panel());
        fireEvent.click(trigger());
        expect(trigger()).toHaveAccessibleName('1 unread conversation');
        rerender(panel({ rows: [] }));
        expect(trigger()).toHaveAccessibleName('0 unread conversations');
        expect(screen.getByText('No unread conversations.')).toBeTruthy();
        rerender(panel({ scopeKey: 'remote:b:a', rows: [] }));
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(trigger());
        expect(screen.getByText('No unread conversations.')).toBeTruthy();
        rerender(panel({ scopeKey: 'remote:b:a', rows, count: 12, partial: true }));
        expect(trigger()).toHaveAccessibleName('12 unread conversations, partial');
        expect(screen.getByRole('status')).toHaveTextContent('Partial unread list');
    });

    it.each(['ws-a', 'remote:server-a:ws-a', 'group-a', 'remote:server-a:group-a'])(
        'uses native unread ids, visibility and %s selection routes without a second reader', routeId => {
            excludedTypes = ['autopilot'];
            const history = [
                { id: 'queue_a', type: 'chat', customTitle: 'Unread answer', completedAt: '2026-10-21', mode: 'ask' },
                { id: 'queue_seen', type: 'chat', customTitle: 'Seen' },
                { id: 'queue_archived', type: 'chat', customTitle: 'Archived' },
                { id: 'queue_hidden', type: 'chat', mode: 'autopilot', customTitle: 'Hidden type' },
                { id: 'queue_task', type: 'run-workflow', customTitle: 'Task' },
            ];
            const prefs = { workspaceId: 'ws-a', dispatch: vi.fn(), state: {
                workspaceId: 'ws-a', pinnedIds: [], archivedIds: ['queue_archived'], loaded: true,
            } };
            const unseen = new Set(['queue_a', 'queue_archived', 'queue_hidden', 'queue_task']);
            render(<RailControlsContext.Provider value={{ hoverEnabled: true, onExpand: expand, onPreview: preview }}>
                <ChatPreferencesContext.Provider value={prefs}>
                    <NativeRailUnreadChats history={history} unseenProcessIds={unseen} routeId={routeId} tab="chats"
                        workspaceId="ws-a" client={{ options: {} } as any}
                        onOpen={open} scopeKey={routeId} scopeLabel="Alpha" />
                </ChatPreferencesContext.Provider>
            </RailControlsContext.Provider>);
            expect(trigger()).toHaveAccessibleName('1 unread conversation');
            fireEvent.click(trigger());
            const link = screen.getByRole('link', { name: 'Unread answer' });
            expect(link.getAttribute('href')).toBe(`#repos/${encodeURIComponent(routeId)}/chats/queue_a`);
            expect(open).not.toHaveBeenCalled();
            expect(screen.queryByRole('link', { name: 'Archived' })).toBeNull();
            fireEvent.click(link);
            expect(open).toHaveBeenCalledWith(history[0]);
        },
    );
});
