/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ConversationArea } from '../../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { ClientConversationTurn } from '../../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    Spinner: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn, logicalTurn, provider, turnIndex }: {
        turn: ClientConversationTurn;
        logicalTurn?: ClientConversationTurn;
        provider?: string;
        turnIndex?: number;
    }) => (
        <div
            data-testid="steering-turn"
            data-role={turn.role}
            data-index={turnIndex}
            data-provider={provider}
            data-logical-content={logicalTurn?.content}
            data-logical-index={logicalTurn?.turnIndex}
            data-steered={String(!!turn.steered)}
            data-streaming={String(!!turn.streaming)}
        >
            {turn.content}
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useMessageNavigation', () => ({
    useMessageNavigation: () => ({ currentTurnIndex: null, navHintVisible: false }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({
    PendingTaskInfoPanel: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({
    QueuedFollowUps: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({
    BackgroundTasksIndicator: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/AskUserInline', () => ({
    AskUserInline: () => null,
}));

const timestamp = '2026-01-01T00:00:00.000Z';

describe('ConversationArea steering sections', () => {
    it('renders accepted steer chronology through live updates and reload while retaining canonical actions and provider boundaries', () => {
        const previous: ClientConversationTurn = {
            role: 'assistant', content: 'Prior provider answer.', turnIndex: 0,
            provider: 'copilot', segmentId: 'previous-segment', timeline: [],
        };
        const accepted: ClientConversationTurn = {
            role: 'user', content: 'Change direction.', turnIndex: 2,
            optimisticId: 'steer-a', provider: 'codex', timestamp, timeline: [],
        };
        const response: ClientConversationTurn = {
            role: 'assistant', content: 'Before. After.', turnIndex: 1,
            provider: 'codex', segmentId: 'current-segment', streaming: true,
            timeline: [
                { type: 'content', content: 'Before. ', timestamp },
                { type: 'steering', steeringId: 'steer-a', timestamp },
                { type: 'content', content: 'After.', timestamp },
            ],
        };
        const onTurnClick = vi.fn();
        const props = {
            loading: false,
            error: null,
            pendingQueue: [],
            isScrolledUp: false,
            scrollRef: createRef<HTMLDivElement>(),
            onScrollToBottom: vi.fn(),
            isPending: false,
            task: { status: 'running' },
            fullTask: null,
            onCancel: vi.fn(),
            onMoveToTop: vi.fn(),
            variant: 'inline' as const,
            taskId: 'chat-a',
            provider: 'claude' as const,
            isSelecting: true,
            selectedTurns: new Set<number>(),
            onTurnClick,
        };
        const unaccepted = {
            ...response,
            timeline: response.timeline.filter(item => item.type !== 'steering'),
        };
        const view = render(<ConversationArea {...props} turns={[accepted, unaccepted, previous]} />);

        expect(screen.getAllByTestId('steering-turn').map(node => node.textContent)).toEqual([
            'Prior provider answer.', 'Before. After.', 'Change direction.',
        ]);

        view.rerender(<ConversationArea {...props} turns={[accepted, response, previous]} />);

        const assertSections = (canonicalIndex: number, streaming: boolean) => {
            const bubbles = screen.getAllByTestId('steering-turn');
            expect(bubbles.map(node => node.textContent)).toEqual([
                'Prior provider answer.', 'Before. ', 'Change direction.', 'After.',
            ]);
            expect(bubbles.map(node => node.getAttribute('data-provider'))).toEqual([
                'copilot', 'codex', 'codex', 'codex',
            ]);
            for (const index of [1, 3]) {
                expect(bubbles[index].getAttribute('data-index')).toBe(String(canonicalIndex));
                expect(bubbles[index].getAttribute('data-logical-index')).toBe(String(canonicalIndex));
                expect(bubbles[index].getAttribute('data-logical-content')).toBe('Before. After.');
            }
            expect(bubbles[2].getAttribute('data-steered')).toBe('true');
            expect(bubbles[2].getAttribute('data-index')).toBe('2');
            expect(bubbles[1].getAttribute('data-streaming')).toBe('false');
            expect(bubbles[3].getAttribute('data-streaming')).toBe(String(streaming));
            const dividers = screen.getAllByTestId('provider-segment-divider');
            expect(dividers).toHaveLength(1);
            expect(dividers[0].textContent).toContain('Continued with Codex');
            expect(bubbles[1].closest('[data-conversation-section]')?.contains(dividers[0])).toBe(true);
            return bubbles;
        };
        const liveBubbles = assertSections(1, true);
        fireEvent.click(liveBubbles[1]);
        fireEvent.click(liveBubbles[3]);
        expect(onTurnClick.mock.calls.map(call => call[0])).toEqual([1, 1]);

        const persisted = JSON.parse(JSON.stringify([
            previous, accepted, { ...response, turnIndex: 3, streaming: false },
        ])) as ClientConversationTurn[];
        view.rerender(<ConversationArea {...props} task={{ status: 'completed' }} turns={persisted} />);

        const reloadedBubbles = assertSections(3, false);
        fireEvent.click(reloadedBubbles[1]);
        fireEvent.click(reloadedBubbles[3]);
        expect(onTurnClick.mock.calls.map(call => call[0])).toEqual([1, 1, 3, 3]);
        expect(reloadedBubbles.filter(node => node.getAttribute('data-role') === 'assistant')
            .slice(1).map(node => node.textContent).join('')).toBe(response.content);
        expect(persisted.filter(turn => turn.role === 'assistant')).toHaveLength(2);
        expect(persisted[2].content).toBe('Before. After.');
    });
});
