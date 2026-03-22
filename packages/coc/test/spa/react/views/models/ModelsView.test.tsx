/**
 * Tests for ModelsView — card grid, search, capability filter, clipboard copy, toggle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseModelConfig = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModelConfig: () => mockUseModelConfig(),
}));

import { ModelsView } from '../../../../../src/server/spa/client/react/views/models/ModelsView';

function makeModels() {
    return [
        {
            id: 'claude-sonnet-4.6',
            name: 'Claude Sonnet 4.6',
            tokenLimit: 200000,
            enabled: true,
            capabilities: {
                supports: { vision: true, reasoningEffort: true },
                limits: { max_context_window_tokens: 200000 },
            },
        },
        {
            id: 'claude-haiku-4.5',
            name: 'Claude Haiku 4.5',
            tokenLimit: 200000,
            enabled: false,
            capabilities: {
                supports: { vision: true, reasoningEffort: false },
                limits: { max_context_window_tokens: 200000 },
            },
        },
        {
            id: 'gpt-5.1',
            name: 'GPT-5.1',
            tokenLimit: 128000,
            enabled: false,
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 128000 },
            },
        },
    ];
}

function makeDefaultReturn(overrides: Partial<ReturnType<typeof mockUseModelConfig>> = {}) {
    return {
        models: makeModels(),
        loading: false,
        error: null,
        saving: false,
        reload: vi.fn(),
        toggleModel: vi.fn(),
        ...overrides,
    };
}

describe('ModelsView', () => {
    beforeEach(() => { mockUseModelConfig.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('shows loading state', () => {
        mockUseModelConfig.mockReturnValue({ models: [], loading: true, error: null, saving: false, reload: vi.fn(), toggleModel: vi.fn() });
        render(<ModelsView />);
        expect(screen.getByTestId('models-loading')).toBeTruthy();
    });

    it('shows error state with retry button', () => {
        const reload = vi.fn();
        mockUseModelConfig.mockReturnValue({ models: [], loading: false, error: 'HTTP 500', saving: false, reload, toggleModel: vi.fn() });
        render(<ModelsView />);
        expect(screen.getByTestId('models-error')).toBeTruthy();
        fireEvent.click(screen.getByTestId('models-retry'));
        expect(reload).toHaveBeenCalled();
    });

    it('renders model cards', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(3);
        expect(screen.getByTestId('models-count').textContent).toBe('3 models');
    });

    it('search filters by name', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-search'), { target: { value: 'claude' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(2);
    });

    it('search filters by id', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-search'), { target: { value: 'gpt' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(1);
    });

    it('capability filter: vision', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-filter'), { target: { value: 'vision' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(2); // sonnet + haiku
    });

    it('capability filter: reasoning', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-filter'), { target: { value: 'reasoning' } });
        const cards = screen.getAllByTestId('model-card');
        expect(cards).toHaveLength(1); // sonnet only
    });

    it('shows empty state when no models match filter', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        fireEvent.change(screen.getByTestId('models-search'), { target: { value: 'nonexistent' } });
        expect(screen.getByTestId('models-empty')).toBeTruthy();
    });

    it('shows vision and reasoning badges', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        const visionBadges = screen.getAllByTestId('badge-vision');
        const reasoningBadges = screen.getAllByTestId('badge-reasoning');
        expect(visionBadges).toHaveLength(2); // sonnet + haiku
        expect(reasoningBadges).toHaveLength(1); // sonnet only
    });

    it('copies model id to clipboard on card click', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        const cards = screen.getAllByTestId('model-card');
        fireEvent.click(cards[0]);
        expect(writeText).toHaveBeenCalledWith('claude-sonnet-4.6');
        await waitFor(() => expect(screen.getByTestId('copied-overlay')).toBeTruthy());
    });

    it('singular count for 1 model', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({
            models: [makeModels()[0]],
        }));
        render(<ModelsView />);
        expect(screen.getByTestId('models-count').textContent).toBe('1 model');
    });

    it('shows enabled count in header', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        // 1 of 3 enabled (only claude-sonnet-4.6)
        expect(screen.getByTestId('models-enabled-count').textContent).toBe('1 of 3 enabled');
    });

    it('renders toggle-on for enabled model and toggle-off for disabled', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        expect(screen.getAllByTestId('toggle-on')).toHaveLength(1);
        expect(screen.getAllByTestId('toggle-off')).toHaveLength(2);
    });

    it('calls toggleModel when toggle is clicked', () => {
        const toggleModel = vi.fn();
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ toggleModel }));
        render(<ModelsView />);
        const toggles = screen.getAllByTestId('model-toggle');
        fireEvent.click(toggles[0]); // click the first toggle (enabled model → disable)
        expect(toggleModel).toHaveBeenCalledWith('claude-sonnet-4.6', false);
    });

    it('shows saving indicator in enabled count when saving=true', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ saving: true }));
        render(<ModelsView />);
        expect(screen.getByTestId('models-enabled-count').textContent).toContain('…');
    });
});
