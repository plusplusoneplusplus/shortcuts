/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SentinelRailShortcut } from '../../../../src/server/spa/client/react/features/chat/SentinelRailShortcut';
import { ChatPreferencesContext } from '../../../../src/server/spa/client/react/contexts/chatPrefsConsumer';

const sentinel = (id: string, completedAt: string) => ({
    id, type: 'chat', mode: 'sentinel', customTitle: id, completedAt,
});

describe('SentinelRailShortcut', () => {
    it('supports Tab, Enter and Space with an accessible title and selection state', async () => {
        const user = userEvent.setup();
        const task = sentinel('Night watch', '2026-03-01');
        const onOpen = vi.fn();
        render(<SentinelRailShortcut running={[]} history={[task]} selectedTaskId={null} onOpen={onOpen} />);
        const button = screen.getByRole('button', { name: 'Open latest Sentinel chat: Night watch' });
        expect(button.title).toContain('Night watch');
        await user.tab();
        expect(document.activeElement).toBe(button);
        await user.keyboard('{Enter}');
        await user.keyboard(' ');
        expect(onOpen).toHaveBeenCalledTimes(2);
        expect(onOpen).toHaveBeenLastCalledWith(task);
    });

    it('retargets after recency changes and deletion, then hides when empty', () => {
        const older = sentinel('older', '2026-03-01');
        const newer = sentinel('newer', '2026-03-02');
        const onOpen = vi.fn();
        const props = { running: [], selectedTaskId: 'queue_newer', onOpen };
        const { rerender } = render(<SentinelRailShortcut {...props} history={[older, newer]} />);
        expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true');
        expect(screen.getByRole('button').className).toContain('ring-teal');
        rerender(<SentinelRailShortcut {...props} history={[{ ...older, completedAt: '2026-03-03' }, newer]} />);
        expect(screen.getByRole('button').title).toContain('older');
        expect(screen.getByRole('button').hasAttribute('aria-current')).toBe(false);
        rerender(<SentinelRailShortcut {...props} history={[newer]} />);
        expect(screen.getByRole('button').title).toContain('newer');
        rerender(<SentinelRailShortcut {...props} history={[]} />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('reacts to archive preferences from its owning chat provider', () => {
        const task = sentinel('watch', '2026-03-01');
        const props = { running: [], history: [task], selectedTaskId: null, onOpen: vi.fn() };
        const context = {
            workspaceId: 'ws-a', dispatch: vi.fn(),
            state: { workspaceId: 'ws-a', pinnedIds: [], archivedIds: [] as string[], loaded: true },
        };
        const { rerender } = render(
            <ChatPreferencesContext.Provider value={context}><SentinelRailShortcut {...props} /></ChatPreferencesContext.Provider>,
        );
        expect(screen.getByRole('button')).toBeTruthy();
        rerender(
            <ChatPreferencesContext.Provider value={{ ...context, state: { ...context.state, archivedIds: ['watch'] } }}>
                <SentinelRailShortcut {...props} />
            </ChatPreferencesContext.Provider>,
        );
        expect(screen.queryByRole('button')).toBeNull();
    });
});
