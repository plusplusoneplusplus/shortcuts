/**
 * Tests for batched AskUserInline responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AskUserInline } from '../../../../../src/server/spa/client/react/features/chat/AskUserInline';
import type { AskUserBatch, AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';
import { getAskUserDraft } from '../../../../../src/server/spa/client/react/features/chat/hooks/useAskUserDraftStore';

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
    localStorage.clear();
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
    return { batchId: questions[0]?.batchId ?? 'batch-1', questions };
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

    it('renders Ralph grill planning, role groups, and provenance in one batch form', () => {
        render(
            <AskUserInline
                batch={makeBatch([
                    makeQuestion({
                        batchSize: 2,
                        ralphGrill: {
                            planning: {
                                depth: 'deep',
                                agentOutcomes: [
                                    {
                                        role: 'product',
                                        roleLabel: 'Product Agent',
                                        provenanceLabel: 'Product Agent · copilot/gpt-5.5',
                                        status: 'completed',
                                        candidateCount: 2,
                                    },
                                    {
                                        role: 'ux',
                                        roleLabel: 'UX Agent',
                                        provenanceLabel: 'UX Agent · model unavailable',
                                        status: 'failed',
                                        candidateCount: 0,
                                    },
                                ],
                                consolidation: {
                                    rawCandidateCount: 4,
                                    selectedQuestionCount: 2,
                                    exactDuplicatesMerged: 1,
                                    semanticDuplicatesMerged: 1,
                                    conflictsConverted: 1,
                                    duplicateOnlyAgents: ['UX Agent'],
                                },
                                warnings: ['UX Agent failed: rate limit'],
                            },
                            sources: [{
                                role: 'product',
                                roleLabel: 'Product Agent',
                                provider: 'copilot',
                                model: 'gpt-5.5',
                                provenanceLabel: 'Product Agent · copilot/gpt-5.5',
                            }],
                            consolidation: { kind: 'merged-duplicate', mergedCandidateCount: 2 },
                        },
                    }),
                    makeQuestion({
                        questionId: 'q-2',
                        question: 'Describe the grouped form layout',
                        type: 'text',
                        options: undefined,
                        index: 1,
                        batchSize: 2,
                        ralphGrill: {
                            sources: [{
                                role: 'ux',
                                roleLabel: 'UX Agent',
                                provenanceLabel: 'UX Agent · model unavailable',
                            }],
                            consolidation: { kind: 'unique', mergedCandidateCount: 1 },
                        },
                    }),
                ])}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );

        expect(screen.getByTestId('ralph-grill-planning-card')).toHaveTextContent('Question planning');
        expect(screen.getByTestId('ralph-grill-planning-card')).toHaveTextContent('Deep depth');
        expect(screen.getByTestId('ralph-grill-planning-warnings')).toHaveTextContent('UX Agent failed: rate limit');
        expect(screen.getAllByTestId('ask-user-question')).toHaveLength(2);
        expect(screen.getAllByTestId('ask-user-question-group-label').map(label => label.textContent)).toEqual([
            expect.stringContaining('Product Agent'),
            expect.stringContaining('UX Agent'),
        ]);
        expect(screen.getAllByTestId('ask-user-provenance-chip').map(chip => chip.textContent)).toEqual([
            'Product Agent · copilot/gpt-5.5',
            'UX Agent · model unavailable',
        ]);
        expect(screen.getByTestId('ask-user-consolidation-chip')).toHaveTextContent('merged-duplicate · 2 candidates');
        expect(screen.getAllByTestId('ask-user-submit-all-btn')).toHaveLength(1);
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

    it('restores draft answers and defer notes for the same process and batch after remount', async () => {
        const batch = makeBatch([
            makeQuestion({ questionId: 'q-1', question: 'Why?', type: 'text', options: undefined, batchSize: 2 }),
            makeQuestion({ questionId: 'q-2', question: 'Target?', type: 'text', options: undefined, index: 1, batchSize: 2 }),
        ]);
        const { unmount } = render(
            <AskUserInline
                batch={batch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );

        fireEvent.change(screen.getAllByTestId('ask-user-text-input')[0], { target: { value: 'draft answer' } });
        fireEvent.change(screen.getAllByTestId('ask-user-question-disposition')[1], { target: { value: 'needs-context' } });
        fireEvent.change(screen.getByTestId('ask-user-deferred-note-input'), { target: { value: 'Need available targets' } });
        await waitFor(() => {
            const draft = getAskUserDraft('proc-1', 'batch-1');
            expect(draft?.answers['q-1'].value).toBe('draft answer');
            expect(draft?.answers['q-2'].disposition).toBe('needs-context');
        });

        unmount();
        render(
            <AskUserInline
                batch={batch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );

        expect(screen.getByTestId('ask-user-text-input')).toHaveValue('draft answer');
        expect(screen.getAllByTestId('ask-user-question-disposition')[1]).toHaveValue('needs-context');
        expect(screen.getByTestId('ask-user-deferred-note-input')).toHaveValue('Need available targets');
    });

    it('does not leak drafts between processes with the same batch id', async () => {
        const batch = makeBatch([makeQuestion({ type: 'text', options: undefined })]);
        const firstRender = render(
            <AskUserInline
                batch={batch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByTestId('ask-user-text-input'), { target: { value: 'process one answer' } });
        await waitFor(() => {
            expect(getAskUserDraft('proc-1', 'batch-1')?.answers['q-1'].value).toBe('process one answer');
        });

        firstRender.unmount();
        const secondRender = render(
            <AskUserInline
                batch={batch}
                processId="proc-2"
                onAnswered={vi.fn()}
            />,
        );
        expect(screen.getByTestId('ask-user-text-input')).toHaveValue('');

        secondRender.unmount();
        render(
            <AskUserInline
                batch={batch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        expect(screen.getByTestId('ask-user-text-input')).toHaveValue('process one answer');
    });

    it('clears an older draft when the same process receives a replacement batch id', async () => {
        const firstBatch = makeBatch([makeQuestion({ type: 'text', options: undefined })]);
        const secondBatch = makeBatch([
            makeQuestion({ batchId: 'batch-2', questionId: 'q-2', question: 'New question?', type: 'text', options: undefined }),
        ]);
        const { unmount } = render(
            <AskUserInline
                batch={firstBatch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByTestId('ask-user-text-input'), { target: { value: 'stale answer' } });
        await waitFor(() => {
            expect(getAskUserDraft('proc-1', 'batch-1')?.answers['q-1'].value).toBe('stale answer');
        });

        unmount();
        render(
            <AskUserInline
                batch={secondBatch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(getAskUserDraft('proc-1', 'batch-1')).toBeNull();
        });
        expect(screen.getByTestId('ask-user-text-input')).toHaveValue('');
    });

    it('clears the draft after successful submission', async () => {
        const batch = makeBatch([makeQuestion({ type: 'text', options: undefined })]);
        render(
            <AskUserInline
                batch={batch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByTestId('ask-user-text-input'), { target: { value: 'answer to submit' } });
        await waitFor(() => {
            expect(getAskUserDraft('proc-1', 'batch-1')?.answers['q-1'].value).toBe('answer to submit');
        });

        fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalled();
            expect(getAskUserDraft('proc-1', 'batch-1')).toBeNull();
        });
    });

    it('clears the draft after successful skip-all', async () => {
        const batch = makeBatch([makeQuestion({ type: 'text', options: undefined })]);
        render(
            <AskUserInline
                batch={batch}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByTestId('ask-user-text-input'), { target: { value: 'answer before skip' } });
        await waitFor(() => {
            expect(getAskUserDraft('proc-1', 'batch-1')?.answers['q-1'].value).toBe('answer before skip');
        });

        fireEvent.click(screen.getByTestId('ask-user-skip-all-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalled();
            expect(getAskUserDraft('proc-1', 'batch-1')).toBeNull();
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
        // AC-07: routes the ask_user reply through the clone-aware typed client.
        expect(source).toContain('useCocClient');
    });

    describe('dark-mode styling', () => {
        it('gives yes-no option labels a dark-mode text color so they stay readable on the dark card', () => {
            render(
                <AskUserInline
                    batch={makeBatch([makeQuestion({ type: 'yes-no', options: undefined })])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const yesLabel = screen.getByTestId('ask-user-yes-radio').closest('label');
            const noLabel = screen.getByTestId('ask-user-no-radio').closest('label');
            expect(yesLabel?.className).toContain('dark:text-[#cccccc]');
            expect(noLabel?.className).toContain('dark:text-[#cccccc]');
        });

        it('gives confirm option labels a dark-mode text color', () => {
            render(
                <AskUserInline
                    batch={makeBatch([makeQuestion({ type: 'confirm', options: undefined })])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const confirmLabel = screen.getByTestId('ask-user-confirm-radio').closest('label');
            const cancelLabel = screen.getByTestId('ask-user-cancel-radio').closest('label');
            expect(confirmLabel?.className).toContain('dark:text-[#cccccc]');
            expect(cancelLabel?.className).toContain('dark:text-[#cccccc]');
        });
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

    describe('compact layout', () => {
        it('puts submit/skip in the header above the questions, not in a trailing footer', () => {
            render(
                <AskUserInline batch={makeBatch()} processId="proc-1" onAnswered={vi.fn()} />,
            );

            const submit = screen.getByTestId('ask-user-submit-all-btn');
            const skip = screen.getByTestId('ask-user-skip-all-btn');
            const question = screen.getByTestId('ask-user-question');

            // DOCUMENT_POSITION_FOLLOWING === 4: the question comes after the buttons.
            expect(submit.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(skip.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('labels the actions for a single question and pluralizes for a batch', () => {
            const { unmount } = render(
                <AskUserInline batch={makeBatch()} processId="proc-1" onAnswered={vi.fn()} />,
            );
            expect(screen.getByTestId('ask-user-submit-all-btn')).toHaveTextContent('Submit');
            expect(screen.getByTestId('ask-user-submit-all-btn')).not.toHaveTextContent('Submit all');
            expect(screen.getByTestId('ask-user-skip-all-btn')).toHaveTextContent('Skip');
            expect(screen.getByTestId('ask-user-inline')).toHaveTextContent('1 question');
            unmount();

            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({ batchSize: 2 }),
                        makeQuestion({ questionId: 'q-2', question: 'Why?', type: 'text', options: undefined, index: 1, batchSize: 2 }),
                    ])}
                    processId="proc-2"
                    onAnswered={vi.fn()}
                />,
            );
            expect(screen.getByTestId('ask-user-submit-all-btn')).toHaveTextContent('Submit all');
            expect(screen.getByTestId('ask-user-skip-all-btn')).toHaveTextContent('Skip all');
            expect(screen.getByTestId('ask-user-inline')).toHaveTextContent('2 questions');
        });

        it('drops the nested question card for a single question but keeps it for a batch', () => {
            const { unmount } = render(
                <AskUserInline batch={makeBatch()} processId="proc-1" onAnswered={vi.fn()} />,
            );
            expect(screen.getByTestId('ask-user-question').className).toBe('');
            unmount();

            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({ batchSize: 2 }),
                        makeQuestion({ questionId: 'q-2', question: 'Why?', type: 'text', options: undefined, index: 1, batchSize: 2 }),
                    ])}
                    processId="proc-2"
                    onAnswered={vi.fn()}
                />,
            );
            for (const card of screen.getAllByTestId('ask-user-question')) {
                expect(card.className).toContain('border');
            }
        });

        it('renders the option description inline on the option row with the full text as a tooltip', () => {
            const description = 'User creates a named group and checks member repos from the registered workspace list';
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({ options: [{ value: 'manual', label: 'Manual creation', description }] }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );

            const desc = screen.getByTestId('ask-user-option-description');
            // Inline (a <span>, not a block <div>) so it shares the row with the label.
            expect(desc.tagName).toBe('SPAN');
            expect(desc.querySelector('p')).toBeNull();
            expect(desc.className).toContain('truncate');

            const label = screen.getByTestId('ask-user-option-label');
            const row = label.closest('label');
            expect(row).not.toBeNull();
            expect(row).toContainElement(desc);
            // Truncation hides overflow, so the full text must stay reachable on hover.
            expect(row!.getAttribute('title')).toBe(description);
        });

        it('renders multi-select option descriptions inline too', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            type: 'multi-select',
                            options: [{ value: 'a', label: 'Alpha', description: 'the first one' }],
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const desc = screen.getByTestId('ask-user-option-description');
            expect(desc.tagName).toBe('SPAN');
            expect(screen.getByTestId('ask-user-option-label').closest('label')!.getAttribute('title')).toBe('the first one');
        });

        it('still submits normally through the compact header controls', async () => {
            const onAnswered = vi.fn();
            render(
                <AskUserInline batch={makeBatch()} processId="proc-1" onAnswered={onAnswered} />,
            );

            fireEvent.click(screen.getByDisplayValue('blue'));
            fireEvent.click(screen.getByTestId('ask-user-submit-all-btn'));

            await waitFor(() => {
                expect(mocks.processes.askUserResponse).toHaveBeenCalledWith('proc-1', {
                    batchId: 'batch-1',
                    answers: [{ questionId: 'q-1', answer: 'blue' }],
                });
            });
            expect(onAnswered).toHaveBeenCalled();
        });
    });

    describe('overflow containment', () => {
        const LONG_LABEL = 'Refactor the workspace registration pipeline so every clone reuses the shared credential resolver';
        const LONG_DESCRIPTION = 'This option rewrites the resolver, migrates every caller, and backfills the persisted clone records in one pass';

        it('lets a long select option label shrink and truncate instead of spilling past the card', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({ options: [{ value: 'long', label: LONG_LABEL, description: LONG_DESCRIPTION }] }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );

            const label = screen.getByTestId('ask-user-option-label');
            // shrink-0 would let the label push the row wider than the card.
            expect(label.className).not.toContain('shrink-0');
            expect(label.className).toContain('min-w-0');
            expect(label.className).toContain('truncate');

            // The description gives way first, so the label keeps its width as long as it can.
            const desc = screen.getByTestId('ask-user-option-description');
            expect(desc.className).toContain('shrink-[9999]');

            const row = label.closest('label')!;
            expect(row.className).toContain('min-w-0');
            expect(row.className).toContain('w-full');
            // The whole row stays hoverable for the full text.
            expect(row.getAttribute('title')).toBe(LONG_DESCRIPTION);
        });

        it('applies the same shrink rules to multi-select option rows', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            type: 'multi-select',
                            options: [{ value: 'long', label: LONG_LABEL, description: LONG_DESCRIPTION }],
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );

            const label = screen.getByTestId('ask-user-option-label');
            expect(label.className).not.toContain('shrink-0');
            expect(label.className).toContain('truncate');
            expect(label.closest('label')!.className).toContain('min-w-0');
        });

        it('keeps the option list column shrinkable inside the card', () => {
            render(
                <AskUserInline
                    batch={makeBatch([makeQuestion({ options: [{ value: 'long', label: LONG_LABEL }] })])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const optionColumn = screen.getByTestId('ask-user-option-label').closest('label')!.parentElement!;
            expect(optionColumn.className).toContain('min-w-0');
        });

        it('clips anything that still overflows the card and wraps the header', () => {
            render(
                <AskUserInline
                    batch={makeBatch([makeQuestion({ options: [{ value: 'long', label: LONG_LABEL }] })])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const card = screen.getByTestId('ask-user-inline');
            expect(card.className).toContain('overflow-hidden');
            // Header controls wrap onto a second line rather than pushing out of the card.
            const header = screen.getByText('The AI needs your input').closest('div')!;
            expect(header.className).toContain('flex-wrap');
        });

        it('still selects a long option by click', () => {
            render(
                <AskUserInline
                    batch={makeBatch([
                        makeQuestion({
                            options: [
                                { value: 'long', label: LONG_LABEL, description: LONG_DESCRIPTION },
                                { value: 'blue', label: 'Blue' },
                            ],
                        }),
                    ])}
                    processId="proc-1"
                    onAnswered={vi.fn()}
                />,
            );
            const radio = screen.getByDisplayValue('long') as HTMLInputElement;
            fireEvent.click(radio);
            expect(radio.checked).toBe(true);
        });
    });
});
