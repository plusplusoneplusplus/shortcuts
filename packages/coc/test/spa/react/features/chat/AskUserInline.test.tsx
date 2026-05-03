/**
 * Tests for AskUserInline — verifies ask-user responses go through
 * cocClient.processes.askUserResponse instead of raw fetch().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AskUserInline } from '../../../../../src/server/spa/client/react/features/chat/AskUserInline';
import type { AskUserQuestion } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatSSE';

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
        questionId: 'q-1',
        question: 'Pick a color',
        type: 'select',
        options: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
        ],
        ...overrides,
    };
}

describe('AskUserInline', () => {
    it('renders the question text', () => {
        render(
            <AskUserInline
                question={makeQuestion()}
                processId="proc-1"
                onAnswered={vi.fn()}
            />,
        );
        expect(screen.getByText('Pick a color')).toBeInTheDocument();
    });

    it('calls cocClient.processes.askUserResponse on submit with answer', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                question={makeQuestion()}
                processId="proc-1"
                onAnswered={onAnswered}
            />,
        );

        // Select "blue"
        const blueRadio = screen.getByDisplayValue('blue');
        fireEvent.click(blueRadio);

        // Click submit
        fireEvent.click(screen.getByTestId('ask-user-submit-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                { questionId: 'q-1', answer: 'blue' },
            );
        });
        expect(onAnswered).toHaveBeenCalled();
    });

    it('calls cocClient.processes.askUserResponse with skipped=true on skip', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                question={makeQuestion()}
                processId="proc-1"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByTestId('ask-user-skip-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-1',
                { questionId: 'q-1', skipped: true },
            );
        });
        expect(onAnswered).toHaveBeenCalled();
    });

    it('calls askUserResponse for yes-no with boolean answer', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                question={makeQuestion({ type: 'yes-no', options: undefined })}
                processId="proc-2"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByTestId('ask-user-yes-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-2',
                { questionId: 'q-1', answer: true },
            );
        });
    });

    it('calls askUserResponse for confirm with boolean false on cancel', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                question={makeQuestion({ type: 'confirm', options: undefined })}
                processId="proc-3"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByTestId('ask-user-cancel-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-3',
                { questionId: 'q-1', answer: false },
            );
        });
    });

    it('handles text input submission', async () => {
        const onAnswered = vi.fn();
        render(
            <AskUserInline
                question={makeQuestion({ type: 'text', options: undefined })}
                processId="proc-4"
                onAnswered={onAnswered}
            />,
        );

        const input = screen.getByTestId('ask-user-text-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'my answer' } });
        fireEvent.click(screen.getByTestId('ask-user-submit-btn'));

        await waitFor(() => {
            expect(mocks.processes.askUserResponse).toHaveBeenCalledWith(
                'proc-4',
                { questionId: 'q-1', answer: 'my answer' },
            );
        });
    });

    it('silently handles API failure without crashing', async () => {
        mocks.processes.askUserResponse.mockRejectedValue(new Error('network'));

        const onAnswered = vi.fn();
        render(
            <AskUserInline
                question={makeQuestion({ type: 'yes-no', options: undefined })}
                processId="proc-5"
                onAnswered={onAnswered}
            />,
        );

        fireEvent.click(screen.getByTestId('ask-user-no-btn'));

        // Should not throw; onAnswered should NOT be called on failure
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
