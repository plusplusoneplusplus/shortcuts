/**
 * Tests for the redesigned model-change divider in ConversationArea.
 *
 * Visual contract (per OpenDesign reference `coc-conversation-redesign-3.html`):
 *   - Layout is `label first, then a single horizontal rule on the right`
 *     (was: `rule | label | rule` with dashed lines on both sides).
 *   - Container is left-indented to align with the assistant avatar gutter
 *     (`ml-9`) and uses tight vertical rhythm (`mt-3.5 mb-2`).
 *   - Label is `font-mono`, `uppercase`, `tracking-[0.1em]`, `text-[10.5px]`,
 *     muted color; the model name itself is rendered inside `<strong>` with
 *     foreground text color.
 *   - The trailing rule is a solid 1px line (`h-px`) with surface border color
 *     (`bg-[#e5e7eb]` / `bg-[#3c3c3c]`), NOT dashed.
 *   - The legacy 🤖 emoji prefix is dropped.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationArea } from '../../../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({ Spinner: () => null }));
vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));
vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn }: any) => <div data-testid={`turn-${turn.turnIndex}`}>{turn.content}</div>,
}));
vi.mock('../../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({ PendingTaskInfoPanel: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({ QueuedFollowUps: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({ BackgroundTasksIndicator: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/AskUserInline', () => ({ AskUserInline: () => null }));

function makeTurn(overrides: Partial<ClientConversationTurn> & { turnIndex: number }): ClientConversationTurn {
    return {
        role: 'user',
        content: `Turn ${overrides.turnIndex}`,
        timeline: [],
        ...overrides,
    };
}

const baseProps = {
    loading: false,
    error: null,
    pendingQueue: [],
    isScrolledUp: false,
    scrollRef: { current: null } as any,
    onScrollToBottom: vi.fn(),
    isPending: false,
    task: { status: 'completed' },
    fullTask: null,
    onCancel: vi.fn(),
    onMoveToTop: vi.fn(),
    variant: 'inline' as const,
    taskId: 'task-1',
};

describe('ConversationArea — model-change divider redesign', () => {
    it('uses the new "model-divider" class and ml-9 avatar-gutter alignment', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-opus-4.7' }),
        ];
        render(<ConversationArea {...baseProps} turns={turns} />);
        const divider = screen.getByTestId('model-change-divider');
        expect(divider.classList.contains('model-divider')).toBe(true);
        expect(divider.className).toContain('ml-9');
        expect(divider.className).toContain('mt-3.5');
        expect(divider.className).toContain('mb-2');
        expect(divider.className).toContain('flex');
        expect(divider.className).toContain('items-center');
    });

    it('renders the label first, then a single rule on the right (label-first ordering)', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-opus-4.7' }),
        ];
        const { container } = render(<ConversationArea {...baseProps} turns={turns} />);
        const divider = container.querySelector('[data-testid="model-change-divider"]')!;
        const children = Array.from(divider.children);
        expect(children).toHaveLength(2);

        const label = children[0] as HTMLElement;
        const rule = children[1] as HTMLElement;
        expect(label.classList.contains('model-divider-label')).toBe(true);
        expect(rule.classList.contains('model-divider-rule')).toBe(true);
    });

    it('uses font-mono uppercase 10.5px tracking-[0.1em] muted color on the label', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-opus-4.7' }),
        ];
        const { container } = render(<ConversationArea {...baseProps} turns={turns} />);
        const label = container.querySelector('.model-divider-label')!;
        expect(label.className).toContain('font-mono');
        expect(label.className).toContain('uppercase');
        expect(label.className).toContain('text-[10.5px]');
        expect(label.className).toContain('tracking-[0.1em]');
        expect(label.className).toContain('text-[#6b7280]');
    });

    it('wraps the model name in a <strong> with foreground text color', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-opus-4.7' }),
        ];
        const { container } = render(<ConversationArea {...baseProps} turns={turns} />);
        const label = container.querySelector('.model-divider-label')!;
        const strong = label.querySelector('strong');
        expect(strong).toBeTruthy();
        expect(strong?.textContent).toBe('claude-opus-4.7');
        expect(strong?.className).toContain('font-semibold');
        expect(strong?.className).toContain('text-[#1f2328]');
    });

    it('renders a solid h-px rule (not dashed) using the surface border color', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-opus-4.7' }),
        ];
        const { container } = render(<ConversationArea {...baseProps} turns={turns} />);
        const rule = container.querySelector('.model-divider-rule')!;
        expect(rule.className).toContain('h-px');
        expect(rule.className).toContain('flex-1');
        expect(rule.className).toContain('bg-[#e5e7eb]');
        expect(rule.className).not.toContain('border-dashed');
    });

    it('drops the legacy 🤖 emoji prefix and reads "switched to <model>"', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-opus-4.7' }),
        ];
        const { container } = render(<ConversationArea {...baseProps} turns={turns} />);
        const divider = container.querySelector('[data-testid="model-change-divider"]')!;
        expect(divider.textContent).not.toContain('🤖');
        expect(divider.textContent?.replace(/\s+/g, ' ').trim()).toBe('switched to claude-opus-4.7');
    });

    it('renders multiple dividers each with the new structure', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-sonnet-4.6' }),
            makeTurn({ turnIndex: 3, role: 'assistant' }),
            makeTurn({ turnIndex: 4, role: 'user', model: 'claude-opus-4.7' }),
        ];
        render(<ConversationArea {...baseProps} turns={turns} />);
        const dividers = screen.getAllByTestId('model-change-divider');
        expect(dividers).toHaveLength(2);
        for (const d of dividers) {
            expect(d.classList.contains('model-divider')).toBe(true);
            expect(d.querySelector('.model-divider-label')).toBeTruthy();
            expect(d.querySelector('.model-divider-rule')).toBeTruthy();
            // No double-rule layout from the legacy implementation.
            expect(d.querySelectorAll('.model-divider-rule').length).toBe(1);
        }
    });
});
