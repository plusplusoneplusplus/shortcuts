/**
 * Tests for the host-owned right-end toolbar actions — the 🤖 chat toggle in
 * particular, plus its ordering against the 💬 comments button and the
 * caller-supplied `toolbarRight` content.
 *
 * These actions are driven entirely by props (they read no editor state) and
 * stay visible in source mode, which is what separates them from the formatting
 * commands.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditorToolbar } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditorToolbar';

/** Minimal editor double — the host actions never touch it. */
function makeEditor() {
    const focusResult = new Proxy({}, {
        get: () => () => ({ run: vi.fn() }),
    });
    return {
        isActive: vi.fn(() => false),
        getAttributes: vi.fn(() => ({})),
        can: vi.fn(() => new Proxy({}, { get: () => () => true })),
        chain: () => ({ focus: () => focusResult }),
    };
}

function renderToolbar(props: Record<string, unknown> = {}) {
    return render(<NoteEditorToolbar editor={makeEditor() as never} {...props} />);
}

describe('NoteEditorToolbar — chat toggle', () => {
    it('is absent when neither a handler nor a disabled reason is given', () => {
        renderToolbar();
        expect(screen.queryByTestId('chat-panel-toggle')).toBeNull();
    });

    it('renders when onToggleChatPanel is provided and calls it on click', () => {
        const onToggleChatPanel = vi.fn();
        renderToolbar({ onToggleChatPanel });

        const btn = screen.getByTestId('chat-panel-toggle');
        fireEvent.click(btn);

        expect(onToggleChatPanel).toHaveBeenCalledTimes(1);
    });

    it('renders disabled with the reason as its label when chat is unavailable', () => {
        const onToggleChatPanel = vi.fn();
        renderToolbar({ onToggleChatPanel, chatDisabledReason: 'No workspace selected' });

        const btn = screen.getByTestId('chat-panel-toggle') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute('aria-label')).toBe('No workspace selected');
        expect(btn.title).toBe('No workspace selected');

        fireEvent.click(btn);
        expect(onToggleChatPanel).not.toHaveBeenCalled();
    });

    it('still renders from a disabled reason alone, with no handler', () => {
        renderToolbar({ chatDisabledReason: 'Chat is off' });
        expect((screen.getByTestId('chat-panel-toggle') as HTMLButtonElement).disabled).toBe(true);
    });

    it.each([
        [{ chatPanelOpen: true }, 'Hide AI chat'],
        [{ chatPanelOpen: false, hasExistingChat: true }, 'Continue AI chat'],
        [{ chatPanelOpen: false, hasExistingChat: false }, 'Show AI chat'],
    ])('labels the button %o as "%s"', (state, label) => {
        renderToolbar({ onToggleChatPanel: vi.fn(), ...state });

        const btn = screen.getByTestId('chat-panel-toggle');
        expect(btn.getAttribute('aria-label')).toBe(label);
        expect(btn.title).toBe(label);
    });

    it('tints the button blue for an existing chat while the panel is closed', () => {
        renderToolbar({ onToggleChatPanel: vi.fn(), hasExistingChat: true });
        expect(screen.getByTestId('chat-panel-toggle').className).toContain('#0078d4');
    });

    it('shows the open styling rather than the existing-chat tint once open', () => {
        renderToolbar({ onToggleChatPanel: vi.fn(), hasExistingChat: true, chatPanelOpen: true });

        const cls = screen.getByTestId('chat-panel-toggle').className;
        expect(cls).toContain('bg-[#e8e8e8]');
        expect(cls).not.toContain('#0078d4');
    });

    it('sits between the comments button and the caller-supplied right content', () => {
        renderToolbar({
            onToggleCommentsPanel: vi.fn(),
            onToggleChatPanel: vi.fn(),
            toolbarRight: <span data-testid="custom-right">extra</span>,
        });

        const order = [
            screen.getByTestId('comments-panel-toggle'),
            screen.getByTestId('chat-panel-toggle'),
            screen.getByTestId('custom-right'),
        ];
        for (let i = 0; i < order.length - 1; i++) {
            // DOCUMENT_POSITION_FOLLOWING — the next element comes later in the DOM.
            expect(order[i].compareDocumentPosition(order[i + 1]) & 4).toBeTruthy();
        }
    });

    it('stays visible in source mode, where the formatting group is hidden', () => {
        renderToolbar({ onToggleChatPanel: vi.fn(), hidden: true });

        expect(screen.getByTestId('chat-panel-toggle')).toBeDefined();
        expect(screen.queryByLabelText('Bold')).toBeNull();
    });
});

describe('NoteEditorToolbar — host action group', () => {
    it('omits the whole right-end group when no host action is configured', () => {
        const { container } = renderToolbar();
        expect(container.querySelector('.ml-auto')).toBeNull();
    });

    it('emits the spacer once any host action is configured', () => {
        const { container } = renderToolbar({ onRefresh: vi.fn() });
        expect(container.querySelector('.ml-auto')).not.toBeNull();
    });

    it('renders the AI-edits toggle only when there are edits and a handler', () => {
        const onToggleAiEdits = vi.fn();
        const { rerender } = renderToolbar({ aiEditCount: 0, onToggleAiEdits });
        expect(screen.queryByTestId('ai-edits-toggle')).toBeNull();

        rerender(
            <NoteEditorToolbar editor={makeEditor() as never} aiEditCount={3} onToggleAiEdits={onToggleAiEdits} />,
        );
        expect(screen.getByTestId('ai-edits-toggle').textContent).toContain('3');
    });
});
