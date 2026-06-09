import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { createRef } from 'react';
import { ConversationArea } from '../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: (props: any) => {
        const toolEventCount = props.turn?.timeline?.filter((item: any) => item.type?.startsWith('tool-')).length ?? 0;
        return (
            <div
                data-testid={`mock-turn-${props.turn?.turnIndex}`}
                data-interrupted={props.turn?.interrupted ? 'true' : 'false'}
            >
                <span>{props.turn?.content ?? ''}</span>
                <span data-testid={`mock-turn-${props.turn?.turnIndex}-tool-events`}>{toolEventCount}</span>
                {props.turn?.interrupted && (
                    <button
                        type="button"
                        data-testid="mock-interrupted-continue"
                        onClick={props.onContinueInterrupted}
                    >
                        Continue / retry
                    </button>
                )}
            </div>
        );
    },
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useMessageNavigation', () => ({
    useMessageNavigation: () => ({ currentTurnIndex: null, navHintVisible: false }),
}));

function makeInterruptedTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Partial answer before timeout.',
        timestamp: '2026-01-15T14:19:00Z',
        turnIndex: 1,
        interrupted: true,
        interruptionReason: 'Request timed out after 90000ms',
        timeline: [],
        ...overrides,
    };
}

function makeTurnsAfterFollowUp(): ClientConversationTurn[] {
    return [
        { role: 'user', content: 'Start the task', timestamp: '2026-01-15T14:18:59Z', turnIndex: 0, timeline: [] },
        makeInterruptedTurn({
            timeline: [
                {
                    type: 'content',
                    timestamp: '2026-01-15T14:19:01Z',
                    content: 'Partial answer before timeout.',
                },
                {
                    type: 'tool-start',
                    timestamp: '2026-01-15T14:19:02Z',
                    toolCall: {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'echo persisted' },
                        status: 'running',
                        startTime: '2026-01-15T14:19:02Z',
                    },
                },
                {
                    type: 'tool-complete',
                    timestamp: '2026-01-15T14:19:03Z',
                    toolCall: {
                        id: 'tool-1',
                        toolName: 'bash',
                        args: { command: 'echo persisted' },
                        result: 'persisted',
                        status: 'completed',
                        startTime: '2026-01-15T14:19:02Z',
                        endTime: '2026-01-15T14:19:03Z',
                    },
                },
            ],
        }),
        { role: 'user', content: 'Please continue', timestamp: '2026-01-15T14:20:00Z', turnIndex: 2, timeline: [] },
        { role: 'assistant', content: 'Fresh answer after retry.', timestamp: '2026-01-15T14:20:05Z', turnIndex: 3, timeline: [] },
    ];
}

function renderConversationArea(
    inputFocus: () => void,
    turns: ClientConversationTurn[] = [makeInterruptedTurn()],
    processError: string | null = null,
) {
    return render(
        <ConversationArea
            loading={false}
            error={null}
            turns={turns}
            pendingQueue={[]}
            isScrolledUp={false}
            scrollRef={createRef<HTMLDivElement>()}
            onScrollToBottom={() => {}}
            isPending={false}
            task={{ status: 'failed' }}
            fullTask={null}
            onCancel={() => {}}
            onMoveToTop={() => {}}
            variant="inline"
            taskId="task-1"
            inputRef={{ current: { focus: inputFocus } }}
            processError={processError}
        />,
    );
}

describe('ConversationArea — interrupted turn affordance wiring', () => {
    it('wires preserved-turn Continue / retry to the normal follow-up input focus path', async () => {
        const focus = vi.fn();
        const { getByTestId } = renderConversationArea(focus);

        await act(async () => {
            fireEvent.click(getByTestId('mock-interrupted-continue'));
        });

        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('keeps a refreshed interrupted turn visible after a later follow-up is appended', () => {
        const { getByTestId } = renderConversationArea(
            vi.fn(),
            makeTurnsAfterFollowUp(),
            'Request timed out after 90000ms',
        );

        const interruptedTurn = getByTestId('mock-turn-1');
        expect(interruptedTurn.getAttribute('data-interrupted')).toBe('true');
        expect(interruptedTurn.textContent).toContain('Partial answer before timeout.');
        expect(getByTestId('mock-turn-1-tool-events').textContent).toBe('2');
        expect(getByTestId('mock-turn-2').textContent).toContain('Please continue');
        expect(getByTestId('mock-turn-3').textContent).toContain('Fresh answer after retry.');
        expect(getByTestId('process-error-banner').textContent).toContain('Request timed out after 90000ms');
    });
});
