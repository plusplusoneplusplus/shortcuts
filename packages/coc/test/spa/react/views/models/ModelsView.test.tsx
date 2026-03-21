/**
 * Tests for ModelsView — card grid, search, capability filter, clipboard copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseModels = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => mockUseModels(),
}));

import { ModelsView } from '../../../../../src/server/spa/client/react/views/models/ModelsView';

function makeModels() {
    return [
        {
            id: 'claude-sonnet-4.6',
            name: 'Claude Sonnet 4.6',
            tokenLimit: 200000,
            capabilities: {
                supports: { vision: true, reasoningEffort: true },
                limits: { max_context_window_tokens: 200000 },
            },
        },
        {
            id: 'claude-haiku-4.5',
            name: 'Claude Haiku 4.5',
            tokenLimit: 200000,
            capabilities: {
                supports: { vision: true, reasoningEffort: false },
                limits: { max_context_window_tokens: 200000 },
            },
        },
        {
            id: 'gpt-5.1',
            name: 'GPT-5.1',
            tokenLimit: 128000,
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 128000 },
            },
        },
    ];
}

describe('ModelsView', () => {
    beforeEach(() => { mockUseModels.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('shows loading state', () => {
        mockUseModels.mockReturnValue({ models: [], loading: true, error: null, reload: vi.fn() });
        render(<ModelsView />);
        expect(screen.getByTestId('models-loading')).toBeTruthy();
    });

    it('shows error state with retry button', () => {
        const reload = vi.fn();
        mockUseModels.mockReturnValue({ models: [], loading: false, error: 'HTTP 500', reload });
        render(<ModelsView />);
        expect(screen.getByTestId('models-error')).toBeTruthy();
        fireEvent.click(screen.getByTestId('models-retry'));
        expect(reload).toHaveBeenCalled();
    });

    it('renders model cards', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(3);
        expect(screen.getByTestId('models-count').textContent).toBe('3 models');
    });

    it('search filters by name', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-search'), { target: { value: 'claude' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(2);
    });

    it('search filters by id', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-search'), { target: { value: 'gpt' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(1);
    });

    it('capability filter: vision', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-filter'), { target: { value: 'vision' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(2); // sonnet + haiku
    });

    it('capability filter: reasoning', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-filter'), { target: { value: 'reasoning' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(1); // sonnet only
    });

    it('shows empty state when no models match filter', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-search'), { target: { value: 'nonexistent' } });
        expect(screen.getByTestId('models-empty')).toBeTruthy();
    });

    it('shows vision and reasoning badges', () => {
        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        const visionBadges = screen.getAllByTestId('badge-vision');
        const reasoningBadges = screen.getAllByTestId('badge-reasoning');
        expect(visionBadges).toHaveLength(2); // sonnet + haiku
        expect(reasoningBadges).toHaveLength(1); // sonnet only
    });

    it('copies model id to clipboard on card click', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        mockUseModels.mockReturnValue({ models: makeModels(), loading: false, error: null, reload: vi.fn() });
        render(<ModelsView />);
        const cards = screen.getAllByTestId('model-card');
        fireEvent.click(cards[0]);
        expect(writeText).toHaveBeenCalledWith('claude-sonnet-4.6');
        await waitFor(() => expect(screen.getByTestId('copied-overlay')).toBeTruthy());
    });

    it('singular count for 1 model', () => {
        mockUseModels.mockReturnValue({
            models: [makeModels()[0]],
            loading: false,
            error: null,
            reload: vi.fn(),
        });
        render(<ModelsView />);
        expect(screen.getByTestId('models-count').textContent).toBe('1 model');
    });
});
