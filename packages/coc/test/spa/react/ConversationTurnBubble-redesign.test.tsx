/**
 * Tests for ConversationTurnBubble — visual redesign:
 * - User turns render as a right-aligned soft-gray bubble with a trailing "Y" avatar.
 * - Assistant / script turns show an avatar tile to the left of a borderless body.
 * - Role label is screen-reader-only (visual identity comes from layout + avatar).
 * - User-turn meta row floats above the bubble on hover.
 * - Pinned user turns get an amber bubble background plus a leading pin icon.
 * - Error assistant turns get a red avatar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble redesign — avatar tile', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders an avatar for user turns with the letter "Y"', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar).toBeTruthy();
        expect(avatar.textContent).toBe('Y');
        expect(avatar.getAttribute('title')).toBe('You');
        expect(avatar.getAttribute('aria-hidden')).toBe('true');
    });

    it('user avatar uses a blue palette to distinguish from the assistant avatar', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#ddf4ff]');
        expect(avatar.className).toContain('dark:bg-[#0c2d6b]');
        expect(avatar.className).toContain('ml-3');
    });

    it('renders an avatar for assistant turns with the letter "C"', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const avatar = container.querySelector('.turn-avatar');
        expect(avatar).toBeTruthy();
        expect(avatar!.textContent).toBe('C');
    });

    it('renders an avatar for run-script turns with the "$_" glyph', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} processType="run-script" />
        );
        const avatar = container.querySelector('.turn-avatar');
        expect(avatar).toBeTruthy();
        expect(avatar!.textContent).toBe('$_');
    });

    it('avatar has accessible title that describes the role', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.getAttribute('title')).toBe('Assistant');
    });

    it('avatar is hidden from assistive tech via aria-hidden', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.getAttribute('aria-hidden')).toBe('true');
    });

    it('error assistant avatar reuses the error palette', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', isError: true })} />
        );
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar).toBeTruthy();
        expect(avatar.className).toContain('bg-[#ffebe9]');
        expect(avatar.title).toBe('Assistant — error');
    });

    it('script avatar uses the dark terminal palette', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} processType="run-script" />
        );
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#1e1e1e]');
        expect(avatar.title).toBe('Script Output');
    });
});

describe('ConversationTurnBubble redesign — user bubble surface', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('user inner bubble has the soft-gray turn-bubble background by default', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const bubble = container.querySelector('.turn-bubble');
        expect(bubble).toBeTruthy();
        expect(bubble!.className).toContain('bg-[#f3f4f6]');
        expect(bubble!.className).toContain('rounded-2xl');
    });

    it('user inner bubble has no border by default (only a soft background)', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const bubble = container.querySelector('.turn-bubble') as HTMLElement;
        // The default user bubble must not advertise a border utility class.
        expect(bubble.className).not.toMatch(/\bborder\b/);
    });

    it('user inner bubble is capped to ~78% of the conversation column on desktop', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const bubble = container.querySelector('.turn-bubble') as HTMLElement;
        expect(bubble.className).toContain('max-w-[85%]');
        expect(bubble.className).toContain('sm:max-w-[78%]');
    });

    it('user plain-text content carries a light foreground in dark mode for readability on the dark bubble', () => {
        const { getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'Hello world' })} />);
        const text = getByTestId('user-plain-text');
        // Dark bubble background is dark:bg-[#2a2a2c]; the text needs a light dark-mode color
        // so it does not inherit a near-black default and vanish against the surface.
        expect(text.className).toContain('text-[#1e1e1e]');
        expect(text.className).toContain('dark:text-[#cccccc]');
    });

    it('pinned user bubble switches to the amber palette and gains a border', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', pinnedAt: '2026-01-15T10:31:00Z' })} />
        );
        const bubble = container.querySelector('.turn-bubble') as HTMLElement;
        expect(bubble.className).toContain('bg-[#fff8c5]');
        expect(bubble.className).toContain('border');
    });

    it('pinned user bubble renders a leading 📌 marker outside the bubble surface', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', pinnedAt: '2026-01-15T10:31:00Z' })} />
        );
        const bubble = container.querySelector('.turn-bubble') as HTMLElement;
        const pin = bubble.querySelector('span[title="Pinned"]') as HTMLElement;
        expect(pin).toBeTruthy();
        expect(pin.textContent).toBe('📌');
    });

    it('assistant turn does not render a turn-bubble surface (the body is borderless)', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        expect(container.querySelector('.turn-bubble')).toBeNull();
        expect(container.querySelector('.turn-body')).toBeTruthy();
    });
});

describe('ConversationTurnBubble redesign — meta row hover behavior', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('user meta row is absolutely positioned and hidden until hover', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const bubble = container.querySelector('.turn-bubble') as HTMLElement;
        const headerRow = bubble.querySelector('.flex.items-center') as HTMLElement;
        expect(headerRow).toBeTruthy();
        expect(headerRow.className).toContain('absolute');
        expect(headerRow.className).toContain('opacity-0');
        expect(headerRow.className).toContain('group-hover:opacity-100');
    });

    it('assistant meta row stays inline (no absolute positioning)', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const body = container.querySelector('.turn-body') as HTMLElement;
        const headerRow = body.querySelector('.flex.items-center') as HTMLElement;
        expect(headerRow).toBeTruthy();
        expect(headerRow.className).not.toContain('absolute');
    });
});

describe('ConversationTurnBubble redesign — role-label is screen-reader-only', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('user role label keeps text "You" but is visually hidden via sr-only', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const label = container.querySelector('.role-label') as HTMLElement;
        expect(label).toBeTruthy();
        expect(label.textContent).toBe('You');
        expect(label.className).toContain('sr-only');
    });

    it('assistant role label keeps text "Assistant" but is visually hidden via sr-only', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const label = container.querySelector('.role-label') as HTMLElement;
        expect(label).toBeTruthy();
        expect(label.textContent).toBe('Assistant');
        expect(label.className).toContain('sr-only');
    });
});

describe('ConversationTurnBubble redesign — outer wrapper layout', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('outer wrapper for an assistant turn places avatar before the body', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const wrapper = container.querySelector('.chat-message') as HTMLElement;
        const children = Array.from(wrapper.children);
        // avatar + body. ContextMenu is only rendered when a position is set, so absent here.
        expect(children.length).toBe(2);
        expect(children[0].classList.contains('turn-avatar')).toBe(true);
        expect(children[1].classList.contains('turn-body')).toBe(true);
    });

    it('outer wrapper for a user turn places the bubble before a trailing avatar', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const wrapper = container.querySelector('.chat-message') as HTMLElement;
        const children = Array.from(wrapper.children);
        // bubble + avatar. ContextMenu is only rendered when a position is set, so absent here.
        expect(children.length).toBe(2);
        expect(children[0].classList.contains('turn-bubble')).toBe(true);
        expect(children[1].classList.contains('turn-avatar')).toBe(true);
    });
});
