// @vitest-environment jsdom
/**
 * Tests for NotesChatHeader — the single compact Notes Chat header.
 *
 * Covers header composition (identity + context label + scope control),
 * scope switching, the no-selected-note context label fallback, active-chat
 * behavior (New chat routed to the overflow menu), and window action routing
 * for the three presentation modes (lens, side-panel, embedded).
 */
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotesChatHeader, NotesChatScopeToggle } from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesChatHeader';

describe('NotesChatHeader', () => {
    function renderHeader(overrides: Partial<ComponentProps<typeof NotesChatHeader>> = {}) {
        const props: ComponentProps<typeof NotesChatHeader> = {
            contextLabel: 'My Note',
            scope: 'per-note',
            onScopeChange: vi.fn(),
            windowMode: 'embedded',
            onClose: vi.fn(),
            ...overrides,
        };
        const utils = render(<NotesChatHeader {...props} />);
        return { ...utils, props };
    }

    describe('header composition', () => {
        it('renders exactly one header row with identity, label, and context', () => {
            renderHeader({ contextLabel: 'roadmap' });
            expect(screen.getAllByTestId('notes-chat-header')).toHaveLength(1);
            expect(screen.getByText('Notes Chat')).toBeTruthy();
            expect(screen.getByTestId('notes-chat-header-context')).toHaveTextContent('roadmap');
        });

        it('truncates the context label visually but exposes the full value via title attribute', () => {
            renderHeader({ contextLabel: 'a-very-long-note-title-that-should-truncate' });
            const contextEl = screen.getByTestId('notes-chat-header-context');
            expect(contextEl.getAttribute('title')).toBe('a-very-long-note-title-that-should-truncate');
            expect(contextEl.className).toContain('truncate');
        });

        it('renders the scope segmented control', () => {
            renderHeader();
            expect(screen.getByTestId('chat-scope-toggle')).toBeTruthy();
            expect(screen.getByTestId('chat-scope-per-note')).toBeTruthy();
            expect(screen.getByTestId('chat-scope-per-workspace')).toBeTruthy();
        });

        it('always renders a close button', () => {
            renderHeader();
            expect(screen.getByTestId('note-chat-close-btn')).toBeTruthy();
        });

        it('calls onClose when the close button is clicked', () => {
            const onClose = vi.fn();
            renderHeader({ onClose });
            fireEvent.click(screen.getByTestId('note-chat-close-btn'));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('no-selected-note behavior', () => {
        it('renders whatever fallback context label the host supplies (e.g. "No note selected")', () => {
            renderHeader({ contextLabel: 'No note selected' });
            expect(screen.getByTestId('notes-chat-header-context')).toHaveTextContent('No note selected');
        });

        it('still allows switching to workspace scope and closing when no note is selected', () => {
            const onScopeChange = vi.fn();
            const onClose = vi.fn();
            renderHeader({ contextLabel: 'No note selected', onScopeChange, onClose });
            fireEvent.click(screen.getByTestId('chat-scope-per-workspace'));
            expect(onScopeChange).toHaveBeenCalledWith('per-workspace');
            fireEvent.click(screen.getByTestId('note-chat-close-btn'));
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('scope switching', () => {
        it('calls onScopeChange with per-note when the This note button is clicked', () => {
            const onScopeChange = vi.fn();
            renderHeader({ scope: 'per-workspace', onScopeChange });
            fireEvent.click(screen.getByTestId('chat-scope-per-note'));
            expect(onScopeChange).toHaveBeenCalledWith('per-note');
        });

        it('calls onScopeChange with per-workspace when the Workspace button is clicked', () => {
            const onScopeChange = vi.fn();
            renderHeader({ scope: 'per-note', onScopeChange });
            fireEvent.click(screen.getByTestId('chat-scope-per-workspace'));
            expect(onScopeChange).toHaveBeenCalledWith('per-workspace');
        });

        it('marks the active scope option with aria-pressed', () => {
            renderHeader({ scope: 'per-note' });
            expect(screen.getByTestId('chat-scope-per-note').getAttribute('aria-pressed')).toBe('true');
            expect(screen.getByTestId('chat-scope-per-workspace').getAttribute('aria-pressed')).toBe('false');
        });

        it('does not discard conversation state itself — it only forwards the requested scope', () => {
            // NotesChatHeader is a pure presentation control; persistence of each
            // scope's conversation/draft/binding is owned by useNotesChat and
            // exercised in useNotesChat.test.ts. Here we only assert the toggle
            // reports intent without any side channel.
            const onScopeChange = vi.fn();
            renderHeader({ scope: 'per-note', onScopeChange });
            fireEvent.click(screen.getByTestId('chat-scope-per-workspace'));
            expect(onScopeChange).toHaveBeenCalledTimes(1);
        });
    });

    describe('active-chat behavior — New chat via overflow', () => {
        it('does not render an overflow menu when onNewChat is not provided (no active chat)', () => {
            renderHeader({ onNewChat: undefined });
            expect(screen.queryByTestId('chat-header-overflow-btn')).toBeNull();
        });

        it('surfaces New chat inside the overflow menu when onNewChat is provided', () => {
            const onNewChat = vi.fn();
            renderHeader({ onNewChat });
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            expect(screen.getByTestId('overflow-item-new-chat')).toBeTruthy();
            expect(screen.getByText('New chat')).toBeTruthy();
        });

        it('calls onNewChat when the overflow New chat item is clicked', () => {
            const onNewChat = vi.fn();
            renderHeader({ onNewChat });
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            fireEvent.click(screen.getByTestId('overflow-item-new-chat'));
            expect(onNewChat).toHaveBeenCalledTimes(1);
        });

        it('does not render a standalone "New Chat" text button in the header (moved to overflow)', () => {
            renderHeader({ onNewChat: vi.fn() });
            expect(screen.queryByText('🔄 New Chat')).toBeNull();
        });
    });

    describe('window action routing', () => {
        it('lens mode shows minimize and pin, hides unpin', () => {
            renderHeader({ windowMode: 'lens', onMinimize: vi.fn(), onPin: vi.fn(), onUnpin: vi.fn() });
            expect(screen.getByTestId('notes-chat-minimize-btn')).toBeTruthy();
            expect(screen.getByTestId('notes-chat-pin-btn')).toBeTruthy();
            expect(screen.queryByTestId('notes-chat-unpin-btn')).toBeNull();
        });

        it('lens mode calls onMinimize and onPin on click', () => {
            const onMinimize = vi.fn();
            const onPin = vi.fn();
            renderHeader({ windowMode: 'lens', onMinimize, onPin });
            fireEvent.click(screen.getByTestId('notes-chat-minimize-btn'));
            fireEvent.click(screen.getByTestId('notes-chat-pin-btn'));
            expect(onMinimize).toHaveBeenCalledTimes(1);
            expect(onPin).toHaveBeenCalledTimes(1);
        });

        it('side-panel mode shows unpin, hides minimize and pin', () => {
            renderHeader({ windowMode: 'side-panel', onMinimize: vi.fn(), onPin: vi.fn(), onUnpin: vi.fn() });
            expect(screen.getByTestId('notes-chat-unpin-btn')).toBeTruthy();
            expect(screen.queryByTestId('notes-chat-minimize-btn')).toBeNull();
            expect(screen.queryByTestId('notes-chat-pin-btn')).toBeNull();
        });

        it('side-panel mode calls onUnpin on click', () => {
            const onUnpin = vi.fn();
            renderHeader({ windowMode: 'side-panel', onUnpin });
            fireEvent.click(screen.getByTestId('notes-chat-unpin-btn'));
            expect(onUnpin).toHaveBeenCalledTimes(1);
        });

        it('embedded mode hides minimize, pin, and unpin — only close (and overflow when available) remain', () => {
            renderHeader({ windowMode: 'embedded', onMinimize: vi.fn(), onPin: vi.fn(), onUnpin: vi.fn() });
            expect(screen.queryByTestId('notes-chat-minimize-btn')).toBeNull();
            expect(screen.queryByTestId('notes-chat-pin-btn')).toBeNull();
            expect(screen.queryByTestId('notes-chat-unpin-btn')).toBeNull();
            expect(screen.getByTestId('note-chat-close-btn')).toBeTruthy();
        });

        it('omits action buttons entirely when their handler is not supplied, even in the matching window mode', () => {
            renderHeader({ windowMode: 'lens' /* onMinimize/onPin omitted */ });
            expect(screen.queryByTestId('notes-chat-minimize-btn')).toBeNull();
            expect(screen.queryByTestId('notes-chat-pin-btn')).toBeNull();
        });
    });
});

describe('NotesChatScopeToggle', () => {
    it('renders This note and Workspace options', () => {
        render(<NotesChatScopeToggle scope="per-note" onScopeChange={vi.fn()} />);
        expect(screen.getByTestId('chat-scope-per-note')).toHaveTextContent('This note');
        expect(screen.getByTestId('chat-scope-per-workspace')).toHaveTextContent('Workspace');
    });
});
