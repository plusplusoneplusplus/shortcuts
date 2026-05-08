/**
 * Regression test: ConversationArea must pass the explicit processId prop
 * to AskUserInline — not a transformed/prefixed version of taskId.
 *
 * Bug history: the original implementation constructed the process ID by
 * checking `taskId.startsWith('q-')` and prepending `q-` if missing, which
 * was wrong because:
 *   1. The real process ID prefix is `queue_`, not `q-`.
 *   2. `taskId` inside ConversationArea already IS the process ID.
 *
 * Fix: ConversationArea now accepts an explicit optional `processId` prop and
 * passes it directly to AskUserInline (falling back to `taskId` when absent).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationArea } from '../../../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// Capture the processId that AskUserInline receives
const capturedProcessIds: string[] = [];

vi.mock('../../../../../src/server/spa/client/react/features/chat/AskUserInline', () => ({
    AskUserInline: ({ processId }: { processId: string }) => {
        capturedProcessIds.push(processId);
        return <div data-testid="ask-user-inline" data-process-id={processId} />;
    },
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({ Spinner: () => null }));
vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({ cn: (...c: any[]) => c.filter(Boolean).join(' ') }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: () => null,
}));
vi.mock('../../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({ PendingTaskInfoPanel: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({ QueuedFollowUps: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({ BackgroundTasksIndicator: () => null }));

const question: AskUserQuestion = {
    questionId: 'q-abc',
    question: 'Pick one',
    type: 'select',
    options: [{ value: 'a', label: 'A' }],
};

// AskUserInline only renders inside the non-empty-turns branch of ConversationArea,
// so we need at least one turn.
const oneTurn: ClientConversationTurn[] = [
    { role: 'user', content: 'Hello', timeline: [], turnIndex: 0 },
];

const baseProps = {
    loading: false,
    error: null,
    turns: oneTurn,
    pendingQueue: [],
    isScrolledUp: false,
    scrollRef: { current: null } as any,
    onScrollToBottom: vi.fn(),
    isPending: false,
    task: { status: 'running' },
    fullTask: null,
    onCancel: vi.fn(),
    onMoveToTop: vi.fn(),
    variant: 'inline' as const,
    pendingQuestion: question,
    onAskUserAnswered: vi.fn(),
};

describe('ConversationArea AskUserInline processId routing', () => {
    it('uses the explicit processId prop when provided', () => {
        capturedProcessIds.length = 0;
        render(
            <ConversationArea
                {...baseProps}
                taskId="queue_1778218523854-jc2brzg"
                processId="queue_1778218523854-jc2brzg"
            />,
        );
        const el = screen.getByTestId('ask-user-inline');
        expect(el.getAttribute('data-process-id')).toBe('queue_1778218523854-jc2brzg');
    });

    it('does NOT mangle the process ID with a q- prefix (regression)', () => {
        capturedProcessIds.length = 0;
        render(
            <ConversationArea
                {...baseProps}
                taskId="queue_1778218523854-jc2brzg"
                processId="queue_1778218523854-jc2brzg"
            />,
        );
        const el = screen.getByTestId('ask-user-inline');
        const pid = el.getAttribute('data-process-id') ?? '';
        // The old bug would produce `q-queue_...`
        expect(pid).not.toMatch(/^q-/);
        expect(pid).toBe('queue_1778218523854-jc2brzg');
    });

    it('falls back to taskId when processId is not provided', () => {
        capturedProcessIds.length = 0;
        render(
            <ConversationArea
                {...baseProps}
                taskId="queue_fallback-id-123"
            />,
        );
        const el = screen.getByTestId('ask-user-inline');
        expect(el.getAttribute('data-process-id')).toBe('queue_fallback-id-123');
    });

    it('does not render AskUserInline when pendingQuestion is absent', () => {
        capturedProcessIds.length = 0;
        render(
            <ConversationArea
                {...baseProps}
                taskId="queue_1"
                processId="queue_1"
                pendingQuestion={null}
            />,
        );
        expect(screen.queryByTestId('ask-user-inline')).toBeNull();
    });

    it('does not render AskUserInline when task status is completed', () => {
        capturedProcessIds.length = 0;
        render(
            <ConversationArea
                {...baseProps}
                taskId="queue_1"
                processId="queue_1"
                task={{ status: 'completed' }}
            />,
        );
        expect(screen.queryByTestId('ask-user-inline')).toBeNull();
    });
});
