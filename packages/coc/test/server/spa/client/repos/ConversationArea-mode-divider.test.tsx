/**
 * ConversationArea mode-change divider tests.
 *
 * Verifies that a visual divider appears between turns when the chat mode
 * (ask | autopilot) changes. Legacy plan turn metadata is displayed as Ask.
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

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn }: any) => <div data-testid={`turn-${turn.turnIndex}`}>{turn.content}</div>,
}));

vi.mock('../../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({
    PendingTaskInfoPanel: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({
    QueuedFollowUps: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({
    BackgroundTasksIndicator: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/AskUserInline', () => ({
    AskUserInline: () => null,
}));

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

describe('ConversationArea mode-change divider', () => {
    it('renders no divider when no mode fields are present', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user' }),
            makeTurn({ turnIndex: 3, role: 'assistant' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('mode-change-divider')).toBeNull();
    });

    it('renders no divider when mode is the same across turns', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', mode: 'plan' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', mode: 'plan' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('mode-change-divider')).toBeNull();
    });

    it('renders no divider when an interrupted retry user turn keeps the current mode', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', mode: 'autopilot', content: 'Run the task' }),
            makeTurn({
                turnIndex: 1,
                role: 'assistant',
                content: 'Partial response before timeout',
                interrupted: true,
                interruptionReason: 'Request timed out after 90000ms',
            }),
            makeTurn({ turnIndex: 2, role: 'user', mode: 'autopilot', content: 'Please continue' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('mode-change-divider')).toBeNull();
    });

    it('renders divider when mode changes between user turns', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', mode: 'plan' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', mode: 'autopilot' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        const divider = screen.getByTestId('mode-change-divider');
        expect(divider).toBeTruthy();
        expect(divider.textContent).toContain('autopilot');
        // Mode icon should be rendered alongside the label
        expect(divider.textContent).toContain('🤖');
    });

    it('renders no divider for the first turn with a mode', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', mode: 'plan' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('mode-change-divider')).toBeNull();
    });

    it('renders legacy plan metadata as Ask when switching from default mode', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', mode: 'plan' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        const divider = screen.getByTestId('mode-change-divider');
        expect(divider).toBeTruthy();
        expect(divider.textContent).toContain('ask');
        expect(divider.textContent).toContain('💡');
    });

    it('renders multiple dividers for multiple mode changes', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', mode: 'plan' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', mode: 'autopilot' }),
            makeTurn({ turnIndex: 3, role: 'assistant' }),
            makeTurn({ turnIndex: 4, role: 'user', mode: 'ask' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        const dividers = screen.getAllByTestId('mode-change-divider');
        expect(dividers).toHaveLength(2);
        expect(dividers[0].textContent).toContain('autopilot');
        expect(dividers[1].textContent).toContain('ask');
    });

    it('renders both model and mode dividers when both change on the same turn', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4', mode: 'plan' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-sonnet-4.6', mode: 'autopilot' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.getByTestId('model-change-divider')).toBeTruthy();
        expect(screen.getByTestId('mode-change-divider')).toBeTruthy();
    });
});
