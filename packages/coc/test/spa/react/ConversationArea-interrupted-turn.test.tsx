import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { createRef } from 'react';
import { ConversationArea } from '../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: (props: any) => (
        <button
            type="button"
            data-testid="mock-interrupted-continue"
            onClick={props.onContinueInterrupted}
        >
            Continue / retry
        </button>
    ),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useMessageNavigation', () => ({
    useMessageNavigation: () => ({ currentTurnIndex: null, navHintVisible: false }),
}));

function makeInterruptedTurn(): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Partial answer before timeout.',
        timestamp: '2026-01-15T14:19:00Z',
        turnIndex: 1,
        interrupted: true,
        interruptionReason: 'Request timed out after 90000ms',
        timeline: [],
    };
}

function renderConversationArea(inputFocus: () => void) {
    return render(
        <ConversationArea
            loading={false}
            error={null}
            turns={[makeInterruptedTurn()]}
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
});
