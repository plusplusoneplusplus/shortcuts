/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RailUnreadChats, NativeRailUnreadChats } from '../../../../src/server/spa/client/react/features/chat/RailUnreadChats';
import { RailControlsContext } from '../../../../src/server/spa/client/react/features/repo-detail/RailHoverPreview';
import { ChatPreferencesContext } from '../../../../src/server/spa/client/react/contexts/chatPrefsConsumer';

let excludedTypes: string[] = [];
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { myWorkExcludedTypes: excludedTypes } }),
}));
const expand = vi.fn();
const preview = vi.fn();
const open = vi.fn();
const rows = [{ key: 'a', title: 'Unread answer', href: '#repos/a/chats/queue_a', open }];
function panel(props: Partial<React.ComponentProps<typeof RailUnreadChats>> = {}, hoverEnabled = true) {
    return <RailControlsContext.Provider value={{ hoverEnabled, onExpand: expand, onPreview: preview }}>
        <RailUnreadChats scopeKey="local:a" scopeLabel="Alpha" rows={rows} {...props} />
    </RailControlsContext.Provider>;
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
