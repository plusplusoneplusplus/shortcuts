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
        it('renders exactly one header row with context label and scope control', () => {
            renderHeader({ contextLabel: 'roadmap' });
            expect(screen.getAllByTestId('notes-chat-header')).toHaveLength(1);
            expect(screen.queryByText('Notes Chat')).toBeNull();
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

        it('centers the scope control independently of the title and window actions', () => {
            renderHeader({ windowMode: 'lens', onMinimize: vi.fn(), onPin: vi.fn() });
            expect(screen.getByTestId('notes-chat-header').className)
                .toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
            expect(screen.getByTestId('chat-scope-toggle').parentElement)
                .toBe(screen.getByTestId('notes-chat-header'));
            expect(screen.getByTestId('note-chat-close-btn').parentElement?.className)
                .toContain('justify-self-end');
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

    describe('path-reference affordance (📎)', () => {
        it('is hidden when no chatNotePath is provided (no bound chat note)', () => {
            renderHeader();
            expect(screen.queryByTestId('notes-chat-path-ref')).toBeNull();
        });

        it('is hidden in the per-workspace scope shape (chatNotePath null)', () => {
            renderHeader({ scope: 'per-workspace', chatNotePath: null });
            expect(screen.queryByTestId('notes-chat-path-ref')).toBeNull();
        });

        it('renders the 📎 button with the full path in its tooltip when chatNotePath is set', () => {
            renderHeader({ chatNotePath: 'Plans/roadmap.md', chatNoteTitle: 'roadmap' });
            const btn = screen.getByTestId('notes-chat-path-ref');
            expect(btn).toBeTruthy();
            expect(btn.getAttribute('title')).toBe('Path reference: Plans/roadmap.md');
            expect(btn.getAttribute('aria-label')).toBe('Path reference: Plans/roadmap.md');
        });

        it('tints blue and is not marked switched in the normal (non-switched) case', () => {
            renderHeader({ chatNotePath: 'Plans/roadmap.md', chatNoteTitle: 'roadmap', isSwitched: false });
            const btn = screen.getByTestId('notes-chat-path-ref');
            expect(btn.className).toContain('text-[#0078d4]');
            expect(btn.getAttribute('data-switched')).toBe('false');
        });

        it('tints amber and swaps to the "Attached to…" warning tooltip when switched', () => {
            renderHeader({ chatNotePath: 'Plans/roadmap.md', chatNoteTitle: 'roadmap', isSwitched: true });
            const btn = screen.getByTestId('notes-chat-path-ref');
            expect(btn.className).toContain('text-[#9a6700]');
            expect(btn.getAttribute('data-switched')).toBe('true');
            expect(btn.getAttribute('title')).toBe('Attached to roadmap — Start New Chat to switch.');
            expect(btn.getAttribute('aria-label')).toBe('Attached to roadmap — Start New Chat to switch.');
        });

        it('falls back to the file name when chatNoteTitle is missing in the switched tooltip', () => {
            renderHeader({ chatNotePath: 'Plans/roadmap.md', chatNoteTitle: null, isSwitched: true });
            const btn = screen.getByTestId('notes-chat-path-ref');
            expect(btn.getAttribute('title')).toBe('Attached to roadmap — Start New Chat to switch.');
        });
    });

    describe('window action routing', () => {
        it('lens mode shows minimize and pin, hides unpin', () => {
            renderHeader({ windowMode: 'lens', onMinimize: vi.fn(), onPin: vi.fn(), onUnpin: vi.fn() });
            expect(screen.getByTestId('notes-chat-minimize-btn')).toBeTruthy();
            expect(screen.getByTestId('notes-chat-pin-btn')).toBeTruthy();
            expect(screen.queryByTestId('notes-chat-unpin-btn')).toBeNull();
        });

        it('lens mode renders pin before minimize (pin → minimize order)', () => {
            renderHeader({ windowMode: 'lens', onMinimize: vi.fn(), onPin: vi.fn() });
            const pin = screen.getByTestId('notes-chat-pin-btn');
            const min = screen.getByTestId('notes-chat-minimize-btn');
            expect(pin.compareDocumentPosition(min) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    it('renders This note, Section, and Workspace options', () => {
        render(<NotesChatScopeToggle scope="per-note" onScopeChange={vi.fn()} sectionAvailable />);
        expect(screen.getByTestId('chat-scope-per-note')).toHaveTextContent('This note');
        expect(screen.getByTestId('chat-scope-per-section')).toHaveTextContent('Section');
        expect(screen.getByTestId('chat-scope-per-workspace')).toHaveTextContent('Workspace');
    });

    it('places Section in the middle so the control reads as widening scope', () => {
        render(<NotesChatScopeToggle scope="per-note" onScopeChange={vi.fn()} sectionAvailable />);
        const labels = Array.from(screen.getByTestId('chat-scope-toggle').children)
            .map(el => el.textContent);
        expect(labels).toEqual(['This note', 'Section', 'Workspace']);
    });

    it('keeps the Section label static rather than naming the folder', () => {
        // The pill is text-[10px]; a folder name would blow the layout. The
        // folder is already named by the adjacent context label.
        render(<NotesChatScopeToggle scope="per-section" onScopeChange={vi.fn()} sectionAvailable />);
        expect(screen.getByTestId('chat-scope-per-section').textContent).toBe('Section');
    });

    it('marks only the active segment as pressed', () => {
        render(<NotesChatScopeToggle scope="per-section" onScopeChange={vi.fn()} sectionAvailable />);
        expect(screen.getByTestId('chat-scope-per-section').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('chat-scope-per-note').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('chat-scope-per-workspace').getAttribute('aria-pressed')).toBe('false');
    });

    it('reports per-section when the middle segment is clicked', () => {
        const onScopeChange = vi.fn();
        render(<NotesChatScopeToggle scope="per-note" onScopeChange={onScopeChange} sectionAvailable />);
        fireEvent.click(screen.getByTestId('chat-scope-per-section'));
        expect(onScopeChange).toHaveBeenCalledWith('per-section');
    });

    describe('a note with no parent folder', () => {
        it('disables Section rather than letting it select and resolve to nothing', () => {
            const onScopeChange = vi.fn();
            render(<NotesChatScopeToggle scope="per-note" onScopeChange={onScopeChange} />);
            const section = screen.getByTestId('chat-scope-per-section');
            expect(section).toBeDisabled();
            expect(section.getAttribute('title')).toBe("This note isn't in a folder");
            fireEvent.click(section);
            expect(onScopeChange).not.toHaveBeenCalled();
        });

        it('leaves the other two segments usable', () => {
            const onScopeChange = vi.fn();
            render(<NotesChatScopeToggle scope="per-note" onScopeChange={onScopeChange} />);
            fireEvent.click(screen.getByTestId('chat-scope-per-workspace'));
            expect(onScopeChange).toHaveBeenCalledWith('per-workspace');
        });
    });

    it('explains section scope in the enabled tooltip', () => {
        render(<NotesChatScopeToggle scope="per-note" onScopeChange={vi.fn()} sectionAvailable />);
        expect(screen.getByTestId('chat-scope-per-section').getAttribute('title'))
            .toBe('One chat for every note in this folder');
    });

    it('renders a compact pill with pill-shaped segments', () => {
        render(<NotesChatScopeToggle scope="per-note" onScopeChange={vi.fn()} />);

        const toggle = screen.getByTestId('chat-scope-toggle');
        expect(toggle.className).toContain('rounded-full');
        expect(toggle.className).toContain('gap-px');
        expect(toggle.className).toContain('p-px');

        for (const segment of [
            screen.getByTestId('chat-scope-per-note'),
            screen.getByTestId('chat-scope-per-section'),
            screen.getByTestId('chat-scope-per-workspace'),
        ]) {
            expect(segment.className).toContain('rounded-full');
            expect(segment.className).toContain('px-1.5');
            expect(segment.className).toContain('py-px');
        }
    });
});
