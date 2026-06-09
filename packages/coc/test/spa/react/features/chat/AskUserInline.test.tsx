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
        fireEvent.change(screen.getAllByTestId('ask-user-question-disposition')[1], { target: { value: 'skip' } });
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

    it('marks a need-more-context question complete and shows an optional note field', () => {
        render(
            <AskUserInline
                batch={makeBatch([makeQuestion({ type: 'text', options: undefined })])}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        const submitBtn = screen.getByTestId('ask-user-submit-all-btn') as HTMLButtonElement;
        expect(submitBtn.disabled).toBe(true);

        fireEvent.change(screen.getByTestId('ask-user-question-disposition'), { target: { value: 'needs-context' } });

        expect(submitBtn.disabled).toBe(false);
        expect(screen.getByTestId('ask-user-deferred-note-input')).toBeInTheDocument();
        expect(screen.getByText(/explain the missing context/i)).toBeInTheDocument();
    });

    it('submits deferred metadata with currently answerable questions', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                batch={makeBatch([
                    makeQuestion({ batchSize: 3 }),
                    makeQuestion({ questionId: 'q-2', question: 'Continue?', type: 'yes-no', options: undefined, index: 1, batchSize: 3 }),
                    makeQuestion({ questionId: 'q-3', question: 'Which deployment target?', type: 'text', options: undefined, index: 2, batchSize: 3 }),
                ])}
                processId="proc-1"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByDisplayValue('blue'));
        fireEvent.click(screen.getByTestId('ask-user-yes-radio'));
        fireEvent.change(screen.getAllByTestId('ask-user-question-disposition')[2], { target: { value: 'needs-context' } });
        fireEvent.change(screen.getByTestId('ask-user-deferred-note-input'), { target: { value: '  What targets are available?  ' } });
        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                {
                    batchId: 'batch-1',
                    answers: [
                        { questionId: 'q-1', answer: 'blue' },
                        { questionId: 'q-2', answer: true },
                        {
                            questionId: 'q-3',
                            deferred: true,
                            reason: 'needs-context',
                            note: 'What targets are available?',
                        },
                    ],
                },
            );
        });
        expect(onAnswered).toHaveBeenCalled();
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

    describe('markdown rendering', () => {
        it('renders bold and inline code in the question text', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            question: 'Pick the **best** option for `useState` hooks',
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const md = screen.getByTestId('ask-user-question-markdown');
            expect(md.querySelector('strong')?.textContent).toBe('best');
            expect(md.querySelector('code')?.textContent).toBe('useState');
        });

        it('renders an ordered list when the question contains numbered items', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            question: 'Choose one:\n\n1. First\n2. Second\n3. Third',
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const md = screen.getByTestId('ask-user-question-markdown');
            const ol = md.querySelector('ol');
            expect(ol).not.toBeNull();
            expect(ol?.querySelectorAll('li')).toHaveLength(3);
            expect(ol?.querySelectorAll('li')[0].textContent).toContain('First');
        });

        it('renders markdown inside select option labels', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            options: [
                                { value: 'red', label: '**Red** option', description: 'Use the `red` value' },
                                { value: 'blue', label: 'Blue' },
                            ],
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const labels = screen.getAllByTestId('ask-user-option-label');
            expect(labels[0].querySelector('strong')?.textContent).toBe('Red');
            const desc = screen.getByTestId('ask-user-option-description');
            expect(desc.querySelector('code')?.textContent).toBe('red');
        });

        it('sanitizes <script> tags and javascript: URLs', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            question: 'Hi <script>window.__pwn=1<\/script> [click](javascript:alert(1))',
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const md = screen.getByTestId('ask-user-question-markdown');
            expect(md.querySelector('script')).toBeNull();
            // The script tag must appear as escaped text, not as an executing element.
            expect(md.innerHTML).not.toMatch(/<script/i);
            expect((window as unknown as { __pwn?: unknown }).__pwn).toBeUndefined();
            const link = md.querySelector('a');
            expect(link).not.toBeNull();
            expect(link!.getAttribute('href')).toBe('#');
            expect(link!.getAttribute('href')).not.toMatch(/^javascript:/i);
        });

        it('does not let select option labels inject script tags', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            options: [
                                { value: 'a', label: 'A <script>window.__pwn2=1<\/script>' },
                            ],
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const label = screen.getByTestId('ask-user-option-label');
            expect(label.querySelector('script')).toBeNull();
            expect((window as unknown as { __pwn2?: unknown }).__pwn2).toBeUndefined();
        });
    });
});
