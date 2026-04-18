/**
 * ConversationArea model-change divider tests.
 *
 * Verifies that a visual divider appears between turns when the model changes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationArea } from '../../../../../src/server/spa/client/react/repos/ConversationArea';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

// scrollIntoView is not implemented in jsdom
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// Mock dependencies that ConversationArea renders
vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    Spinner: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/processes/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn }: any) => <div data-testid={`turn-${turn.turnIndex}`}>{turn.content}</div>,
}));

vi.mock('../../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({
    PendingTaskInfoPanel: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/QueuedBubble', () => ({
    QueuedFollowUps: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/BackgroundTasksIndicator', () => ({
    BackgroundTasksIndicator: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/AskUserInline', () => ({
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

describe('ConversationArea model-change divider', () => {
    it('renders no divider when no model fields are present', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user' }),
            makeTurn({ turnIndex: 3, role: 'assistant' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('model-change-divider')).toBeNull();
    });

    it('renders no divider when model is the same across turns', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'gpt-5.4' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('model-change-divider')).toBeNull();
    });

    it('renders divider when model changes between user turns', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-sonnet-4.6' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        const divider = screen.getByTestId('model-change-divider');
        expect(divider).toBeTruthy();
        expect(divider.textContent).toContain('claude-sonnet-4.6');
    });

    it('renders no divider for the first turn with a model', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('model-change-divider')).toBeNull();
    });

    it('renders no divider when only first turn has no model and second has model', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'gpt-5.4' }),
        ];

        // No previous model-bearing turn → no divider
        render(<ConversationArea {...baseProps} turns={turns} />);
        expect(screen.queryByTestId('model-change-divider')).toBeNull();
    });

    it('renders multiple dividers for multiple model changes', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'user', model: 'gpt-5.4' }),
            makeTurn({ turnIndex: 1, role: 'assistant' }),
            makeTurn({ turnIndex: 2, role: 'user', model: 'claude-sonnet-4.6' }),
            makeTurn({ turnIndex: 3, role: 'assistant' }),
            makeTurn({ turnIndex: 4, role: 'user', model: 'gpt-5.4' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);
        const dividers = screen.getAllByTestId('model-change-divider');
        expect(dividers).toHaveLength(2);
        expect(dividers[0].textContent).toContain('claude-sonnet-4.6');
        expect(dividers[1].textContent).toContain('gpt-5.4');
    });
});
