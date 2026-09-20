/**
 * @vitest-environment jsdom
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
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
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn, provider }: { turn: ClientConversationTurn; provider?: string }) => (
        <div data-testid={`turn-${turn.turnIndex}`} data-provider={provider}>{turn.content}</div>
    ),
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
    provider: 'claude' as const,
};

describe('ConversationArea provider segments', () => {
    it('keeps historical providers and renders one boundary for each A to B to C transition', () => {
        const turns = [
            makeTurn({ turnIndex: 0, provider: 'copilot', segmentId: 'segment-a' }),
            makeTurn({ turnIndex: 1, role: 'assistant', provider: 'copilot', segmentId: 'segment-a' }),
            makeTurn({ turnIndex: 2, provider: 'codex' }),
            makeTurn({ turnIndex: 3, role: 'assistant', provider: 'codex', segmentId: 'segment-b' }),
            makeTurn({ turnIndex: 4, provider: 'codex', segmentId: 'segment-b' }),
            makeTurn({ turnIndex: 5, role: 'assistant', provider: 'codex', segmentId: 'segment-b' }),
            makeTurn({ turnIndex: 6, provider: 'claude' }),
            makeTurn({ turnIndex: 7, role: 'assistant', provider: 'claude', segmentId: 'segment-c' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);

        expect(screen.getByTestId('turn-1').getAttribute('data-provider')).toBe('copilot');
        expect(screen.getByTestId('turn-3').getAttribute('data-provider')).toBe('codex');
        expect(screen.getByTestId('turn-7').getAttribute('data-provider')).toBe('claude');
        expect(screen.getAllByTestId('provider-segment-divider').map(node => node.textContent?.trim()))
            .toEqual(['Continued with Codex', 'Continued with Claude']);
    });

    it('uses provider changes to prove a boundary for partially attributed old records', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'assistant', provider: 'copilot' }),
            makeTurn({ turnIndex: 1, role: 'user', provider: 'codex' }),
            makeTurn({ turnIndex: 2, role: 'assistant', provider: 'codex' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);

        expect(screen.getByTestId('provider-segment-divider').textContent).toContain('Continued with Codex');
    });

    it('does not infer a boundary from the active-provider fallback when old turns are unattributed', () => {
        const turns = [
            makeTurn({ turnIndex: 0, role: 'assistant' }),
            makeTurn({ turnIndex: 1, role: 'user', provider: 'claude' }),
            makeTurn({ turnIndex: 2, role: 'assistant', provider: 'claude' }),
        ];

        render(<ConversationArea {...baseProps} turns={turns} />);

        expect(screen.queryByTestId('provider-segment-divider')).toBeNull();
        expect(screen.getByTestId('turn-0').getAttribute('data-provider')).toBe('claude');
    });

    it('attributes a synthetic streaming placeholder to the latest user turn provider', () => {
        const turns = [
            makeTurn({ turnIndex: 1, role: 'user', provider: 'codex' }),
            makeTurn({ turnIndex: 0, role: 'assistant', provider: 'copilot', segmentId: 'segment-a' }),
        ];

        render(<ConversationArea {...baseProps} task={{ status: 'running' }} turns={turns} />);

        expect(screen.getByTestId('turn-2').getAttribute('data-provider')).toBe('codex');
        expect(screen.getByTestId('provider-segment-divider').textContent).toContain('Continued with Codex');
    });
});
