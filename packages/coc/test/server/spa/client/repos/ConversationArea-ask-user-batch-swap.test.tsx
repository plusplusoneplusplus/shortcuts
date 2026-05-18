/**
 * Regression test: ConversationArea must remount AskUserInline whenever the
 * pendingAskUserBatch identity changes, so that AskUserInline's internal
 * `answers` state is reseeded with the new batch's questionIds.
 *
 * Bug history: AskUserInline initializes its `answers` state from
 * `batch.questions` exactly once (via `useState`'s lazy initializer). If the
 * parent reused the same component instance and passed in a new batch with
 * different `questionId`s, `answers[question.questionId]` was `undefined` for
 * every new question, and `isAnswerComplete` crashed with:
 *
 *   TypeError: Cannot read properties of undefined (reading 'skipped')
 *
 * Fix: ConversationArea now renders `<AskUserInline key={batch.batchId} ... />`,
 * which forces a fresh mount (and fresh state) whenever the batch changes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationArea } from '../../../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { AskUserBatch, AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import type { ClientConversationTurn } from '../../../../../src/server/spa/client/react/types/dashboard';

beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ processes: { askUserResponse: vi.fn().mockResolvedValue({ ok: true }) } }),
}));
vi.mock('../../../../../src/server/spa/client/react/ui', () => ({ Spinner: () => null }));
vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({ cn: (...c: any[]) => c.filter(Boolean).join(' ') }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: () => null,
}));
vi.mock('../../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({ PendingTaskInfoPanel: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({ QueuedFollowUps: () => null }));
vi.mock('../../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({ BackgroundTasksIndicator: () => null }));

function makeBatch(batchId: string, questionId: string, question: string): AskUserBatch {
    const q: AskUserQuestion = {
        batchId,
        questionId,
        question,
        type: 'select',
        options: [{ value: 'a', label: 'A' }],
        turnIndex: 1,
        index: 0,
        batchSize: 1,
    };
    return { batchId, questions: [q] };
}

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
    onAskUserAnswered: vi.fn(),
    taskId: 'queue_1',
    processId: 'queue_1',
};

describe('ConversationArea AskUserInline batch swap', () => {
    it('renders a new batch with different questionIds without crashing (regression)', () => {
        const first = makeBatch('batch-1', 'q-1', 'First question?');
        const second = makeBatch('batch-2', 'q-2', 'Second question?');

        const { rerender } = render(
            <ConversationArea {...baseProps} pendingAskUserBatch={first} />,
        );
        expect(screen.getByText('First question?')).toBeInTheDocument();

        // Swap to a brand new batch with a different batchId and different
        // questionIds. Without the `key={batchId}` fix, AskUserInline's stale
        // `answers` map would have no entry for `q-2`, and `isAnswerComplete`
        // would throw "Cannot read properties of undefined (reading 'skipped')".
        expect(() => {
            rerender(<ConversationArea {...baseProps} pendingAskUserBatch={second} />);
        }).not.toThrow();

        expect(screen.getByText('Second question?')).toBeInTheDocument();
        expect(screen.queryByText('First question?')).toBeNull();
    });
});
