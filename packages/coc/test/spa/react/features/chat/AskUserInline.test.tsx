/**
 * Tests for batched AskUserInline responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AskUserInline } from '../../../../../src/server/spa/client/react/features/chat/AskUserInline';
import type { AskUserBatch, AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';

const mocks = vi.hoisted(() => ({
    processes: {
        askUserResponse: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ processes: mocks.processes }),
    };
});

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.processes.askUserResponse.mockReset().mockResolvedValue({ ok: true });
});

function makeQuestion(overrides: Partial<AskUserQuestion> = {}): AskUserQuestion {
    return {
        batchId: 'batch-1',
        questionId: 'q-1',
        question: 'Pick a color',
        type: 'select',
        options: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
        ],
        turnIndex: 1,
        index: 0,
        batchSize: 1,
        ...overrides,
    };
}

function makeBatch(questions: AskUserQuestion[] = [makeQuestion()]): AskUserBatch {
    return { batchId: 'batch-1', questions };
}

describe('AskUserInline', () => {
    it('renders all questions in one card', () => {
        render(
            <AskUserInline
                batch={makeBatch([
                    makeQuestion(),
                    makeQuestion({ questionId: 'q-2', question: 'Why?', type: 'text', options: undefined, index: 1, batchSize: 2 }),
                ])}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        expect(screen.getByText('Pick a color')).toBeInTheDocument();
        expect(screen.getByText('Why?')).toBeInTheDocument();
        expect(screen.getAllByTestId('ask-user-question')).toHaveLength(2);
    });

    it('submits a batch with answers in question order', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                batch={makeBatch([
                    makeQuestion({ batchSize: 2 }),
                    makeQuestion({ questionId: 'q-2', question: 'Continue?', type: 'yes-no', options: undefined, index: 1, batchSize: 2 }),
                ])}
                processId="proc-1"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByDisplayValue('blue'));
        fireEvent.click(screen.getByTestId('ask-user-yes-radio'));
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                {
                    batchId: 'batch-1',
                    answers: [
                        { questionId: 'q-1', answer: 'blue' },
                        { questionId: 'q-2', answer: true },
                    ],
                },
            );
        });
        expect(onAnswered).toHaveBeenCalled();
    });

    it('submits skip-all for every question', async () => {
        render(
            <AskUserInline
                batch={makeBatch([
                    makeQuestion({ batchSize: 2 }),
                    makeQuestion({ questionId: 'q-2', question: 'Continue?', type: 'confirm', options: undefined, index: 1, batchSize: 2 }),
                ])}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByTestId('ask-user-skip-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                {
                    batchId: 'batch-1',
                    answers: [
                        { questionId: 'q-1', skipped: true },
                        { questionId: 'q-2', skipped: true },
                    ],
                },
            );
        });
    });

    it('supports skipping an individual question', async () => {
        render(
            <AskUserInline
                batch={makeBatch([
                    makeQuestion({ batchSize: 2 }),
                    makeQuestion({ questionId: 'q-2', question: 'Why?', type: 'text', options: undefined, index: 1, batchSize: 2 }),
                ])}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByDisplayValue('red'));
        fireEvent.click(screen.getAllByTestId('ask-user-skip-question-btn')[1]);
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                {
                    batchId: 'batch-1',
                    answers: [
                        { questionId: 'q-1', answer: 'red' },
                        { questionId: 'q-2', skipped: true },
                    ],
                },
            );
        });
    });

    it('keeps submit-all disabled until required answers are complete', () => {
        render(
            <AskUserInline
                batch={makeBatch([makeQuestion({ type: 'text', options: undefined })])}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        const submitBtn = screen.getByTestId('ask-user-submit-all-btn') as HTMLButtonElement;
        expect(submitBtn.disabled).toBe(true);

        fireEvent.change(screen.getByTestId('ask-user-text-input'), { target: { value: '  answer  ' } });
        expect(submitBtn.disabled).toBe(false);
    });

    it('submits custom select text as a trimmed answer', async () => {
        render(
            <AskUserInline
                batch={makeBatch()}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId('ask-user-custom-radio'));
        fireEvent.change(screen.getByTestId('ask-user-custom-input'), { target: { value: '  green  ' } });
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                { batchId: 'batch-1', answers: [{ questionId: 'q-1', answer: 'green' }] },
            );
        });
    });

    it('silently handles API failure without calling onAnswered', async () => {
        mocks.processes.askUserResponse.mockRejectedValue(new Error('network'));
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                batch={makeBatch([makeQuestion({ type: 'yes-no', options: undefined })])}
                processId="proc-1"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByTestId('ask-user-no-radio'));
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalled();
        });
        expect(onAnswered).not.toHaveBeenCalled();
    });

    it('does not use raw fetch()', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../../../src/server/spa/client/react/features/chat/AskUserInline.tsx'),
            'utf-8',
        );
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).toContain('getSpaCocClient');
    });
});
