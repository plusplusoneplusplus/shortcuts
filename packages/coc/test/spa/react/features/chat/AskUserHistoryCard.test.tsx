/**
 * Tests for the compact answered-ask_user history card.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserHistoryCard } from '../../../../../src/server/spa/client/react/features/chat/AskUserHistoryCard';
import type { AskUserHistoryToolCall } from '../../../../../src/server/spa/client/react/features/chat/AskUserHistoryCard';

const OPTIONS = [
    { value: 'manual', label: 'Manual creation', description: 'User creates a named group and checks member repos from the registered workspace list' },
    { value: 'auto', label: 'Auto discovery' },
];

function makeToolCall(
    questions: Array<Record<string, unknown>>,
    answers: Array<Record<string, unknown>>,
): AskUserHistoryToolCall {
    return {
        id: 'call-1',
        toolName: 'ask_user',
        status: 'completed',
        args: { questions },
        result: JSON.stringify({ answers }),
    };
}

function singleSelect(): AskUserHistoryToolCall {
    return makeToolCall(
        [{ questionId: 'q-1', question: 'How are groups created?', type: 'select', options: OPTIONS }],
        [{ questionId: 'q-1', answer: 'manual' }],
    );
}

function twoQuestions(): AskUserHistoryToolCall {
    return makeToolCall(
        [
            { questionId: 'q-1', question: 'How are groups created?', type: 'select', options: OPTIONS },
            { questionId: 'q-2', question: 'Why?', type: 'text' },
        ],
        [
            { questionId: 'q-1', answer: 'manual' },
            { questionId: 'q-2', answer: 'Because.' },
        ],
    );
}

describe('AskUserHistoryCard compact layout', () => {
    it('puts the question count in the header instead of a subtitle line', () => {
        const { unmount } = render(<AskUserHistoryCard toolCall={singleSelect()} />);
        const card = screen.getByTestId('ask-user-history-card');
        expect(card).toHaveTextContent('1 question');
        expect(card.textContent).not.toContain('Question and response from this run.');
        unmount();

        render(<AskUserHistoryCard toolCall={twoQuestions()} />);
        expect(screen.getByTestId('ask-user-history-card')).toHaveTextContent('2 questions');
    });

    it('keeps the status pill in the header, above the questions', () => {
        render(<AskUserHistoryCard toolCall={singleSelect()} />);

        const status = screen.getByTestId('ask-user-history-status');
        expect(status).toHaveTextContent('Answered');

        // DOCUMENT_POSITION_FOLLOWING === 4: the question comes after the pill.
        const question = screen.getAllByTestId('ask-user-history-question')[0];
        expect(status.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('drops the nested question card for a single question but keeps it for a batch', () => {
        const { unmount } = render(<AskUserHistoryCard toolCall={singleSelect()} />);
        expect(screen.getByTestId('ask-user-history-question').className).toBe('');
        unmount();

        render(<AskUserHistoryCard toolCall={twoQuestions()} />);
        for (const card of screen.getAllByTestId('ask-user-history-question')) {
            expect(card.className).toContain('border');
        }
    });

    it('keeps the option description as the chip tooltip with the caption inline', () => {
        render(<AskUserHistoryCard toolCall={singleSelect()} />);

        const options = screen.getByTestId('ask-user-history-options');
        expect(options).toHaveTextContent('Options');
        expect(options.className).toContain('flex-wrap');

        const chip = Array.from(options.querySelectorAll('span[title]'))
            .find(node => node.textContent?.includes('Manual creation'));
        expect(chip?.getAttribute('title')).toBe(OPTIONS[0].description);
    });

    it('still renders the answer, skipped and deferred rows', () => {
        const { unmount } = render(<AskUserHistoryCard toolCall={singleSelect()} />);
        const answer = screen.getByTestId('ask-user-history-answer');
        expect(answer).toHaveTextContent('Manual creation (manual)');
        expect(answer.getAttribute('data-skipped')).toBe('false');
        expect(answer.getAttribute('data-deferred')).toBe('false');
        unmount();

        const skipped = render(
            <AskUserHistoryCard
                toolCall={makeToolCall(
                    [{ questionId: 'q-1', question: 'How are groups created?', type: 'select', options: OPTIONS }],
                    [{ questionId: 'q-1', skipped: true }],
                )}
            />,
        );
        const skippedRow = screen.getByTestId('ask-user-history-answer');
        expect(skippedRow.getAttribute('data-skipped')).toBe('true');
        expect(skippedRow).toHaveTextContent('Question skipped');
        skipped.unmount();

        render(
            <AskUserHistoryCard
                toolCall={makeToolCall(
                    [{ questionId: 'q-1', question: 'How are groups created?', type: 'select', options: OPTIONS }],
                    [{ questionId: 'q-1', deferred: true, reason: 'needs-context', note: 'Read the router first.' }],
                )}
            />,
        );
        const deferredRow = screen.getByTestId('ask-user-history-answer');
        expect(deferredRow.getAttribute('data-deferred')).toBe('true');
        expect(screen.getByTestId('ask-user-history-deferred-note')).toHaveTextContent('Read the router first.');
    });
});
