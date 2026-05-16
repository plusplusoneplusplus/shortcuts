/**
 * Tests for the AI assistant drawer that ships alongside the redesigned
 * PR review page. The drawer is fully driven by mocked fixtures.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrAiAssistantDrawer } from '../../../../../src/server/spa/client/react/features/pull-requests/PrAiAssistantDrawer';

beforeEach(() => {
    vi.resetAllMocks();
});

describe('PrAiAssistantDrawer', () => {
    it('renders the seeded chat history when opened', () => {
        const onClose = vi.fn();
        render(<PrAiAssistantDrawer open onClose={onClose} prNumber={4289} />);

        expect(screen.getAllByTestId('pr-ai-message-ai').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/Grounded in PR #4289/i)).toBeInTheDocument();
    });

    it('reports aria-hidden=true when closed and false when open', () => {
        const { rerender } = render(
            <PrAiAssistantDrawer open={false} onClose={vi.fn()} prNumber={4289} />,
        );
        expect(screen.getByTestId('pr-ai-assistant').getAttribute('aria-hidden')).toBe('true');
        rerender(<PrAiAssistantDrawer open onClose={vi.fn()} prNumber={4289} />);
        expect(screen.getByTestId('pr-ai-assistant').getAttribute('aria-hidden')).toBe('false');
    });

    it('appends a user + AI bubble when a question is asked', () => {
        render(<PrAiAssistantDrawer open onClose={vi.fn()} />);
        const initialAi = screen.getAllByTestId('pr-ai-message-ai').length;
        const initialUser = screen.queryAllByTestId('pr-ai-message-user').length;

        fireEvent.change(screen.getByTestId('pr-ai-input'), {
            target: { value: 'Can this merge today?' },
        });
        fireEvent.submit(screen.getByTestId('pr-ai-form'));

        expect(screen.getAllByTestId('pr-ai-message-user')).toHaveLength(initialUser + 1);
        expect(screen.getAllByTestId('pr-ai-message-ai')).toHaveLength(initialAi + 1);
    });

    it('seeds the input from a suggested prompt', () => {
        render(<PrAiAssistantDrawer open onClose={vi.fn()} />);
        const prompts = screen.getAllByTestId('pr-ai-prompt');
        expect(prompts.length).toBeGreaterThanOrEqual(1);

        fireEvent.click(prompts[0]);
        const input = screen.getByTestId('pr-ai-input') as HTMLTextAreaElement;
        expect(input.value).toBe(prompts[0].textContent ?? '');
    });

    it('calls onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(<PrAiAssistantDrawer open onClose={onClose} />);
        fireEvent.click(screen.getByTestId('pr-ai-assistant-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores empty submissions', () => {
        render(<PrAiAssistantDrawer open onClose={vi.fn()} />);
        const initialAi = screen.getAllByTestId('pr-ai-message-ai').length;
        fireEvent.submit(screen.getByTestId('pr-ai-form'));
        expect(screen.getAllByTestId('pr-ai-message-ai')).toHaveLength(initialAi);
    });
});
