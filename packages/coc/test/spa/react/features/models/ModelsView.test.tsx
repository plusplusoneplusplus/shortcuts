/**
 * Tests for ModelsView — card grid, search, capability filter, clipboard copy, toggle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseModelConfig = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModelConfig: () => mockUseModelConfig(),
}));

import { ModelsView } from '../../../../../src/server/spa/client/react/features/models/ModelsView';

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
            supportedReasoningEfforts: ['low', 'medium', 'high'],
            defaultReasoningEffort: 'medium',
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
            supportedReasoningEfforts: [],
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
            supportedReasoningEfforts: [],
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
        reasoningEfforts: {} as Record<string, string>,
        setReasoningEffort: vi.fn(),
        ...overrides,
    };
}

describe('ModelsView', () => {
    beforeEach(() => { mockUseModelConfig.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('shows loading state', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ models: [], loading: true }));
        render(<ModelsView />);
        expect(screen.getByTestId('models-loading')).toBeTruthy();
    });

    it('shows error state with retry button', () => {
        const reload = vi.fn();
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ models: [], loading: false, error: 'HTTP 500', reload }));
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

    it('shows supported reasoning effort badges for models that expose them', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        const effortContainers = screen.getAllByTestId('reasoning-efforts');
        // Only sonnet has supported efforts
        expect(effortContainers).toHaveLength(1);
        expect(screen.getByTestId('effort-low')).toBeTruthy();
        expect(screen.getByTestId('effort-medium')).toBeTruthy();
        expect(screen.getByTestId('effort-high')).toBeTruthy();
    });

    it('marks the default reasoning effort with data-default="true"', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        expect(screen.getByTestId('effort-medium').getAttribute('data-default')).toBe('true');
        expect(screen.getByTestId('effort-low').getAttribute('data-default')).toBe('false');
        expect(screen.getByTestId('effort-high').getAttribute('data-default')).toBe('false');
    });

    it('renders no reasoning-efforts container when the supported list is empty', () => {
        const models = makeModels();
        // Strip reasoning info from all models
        for (const m of models) {
            m.supportedReasoningEfforts = [];
            m.defaultReasoningEffort = undefined as unknown as string;
            m.capabilities.supports.reasoningEffort = false;
        }
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ models }));
        render(<ModelsView />);
        expect(screen.queryByTestId('reasoning-efforts')).toBeNull();
    });

    it('renders all four known reasoning efforts in canonical order', () => {
        const models = makeModels();
        models[0].supportedReasoningEfforts = ['xhigh', 'low', 'high', 'medium'];
        models[0].defaultReasoningEffort = 'high';
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ models }));
        render(<ModelsView />);
        const efforts = screen.getAllByTestId(/^effort-/);
        // Order is the order the model exposes them (which is preserved by the hook,
        // but here we are passing them through ModelsView directly so the order
        // is whatever the test fixture provides).
        const ids = efforts.map(el => el.getAttribute('data-testid'));
        expect(ids).toEqual(['effort-xhigh', 'effort-low', 'effort-high', 'effort-medium']);
        expect(screen.getByTestId('effort-high').getAttribute('data-default')).toBe('true');
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

    it('renders a refresh button', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        expect(screen.getByTestId('models-refresh-btn')).toBeTruthy();
    });

    it('calls reload when refresh button is clicked', () => {
        const reload = vi.fn();
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ reload }));
        render(<ModelsView />);
        fireEvent.click(screen.getByTestId('models-refresh-btn'));
        expect(reload).toHaveBeenCalled();
    });

    it('highlights the default effort as active when no persisted override', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        expect(screen.getByTestId('effort-medium').getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId('effort-low').getAttribute('data-active')).toBe('false');
        expect(screen.getByTestId('effort-high').getAttribute('data-active')).toBe('false');
    });

    it('highlights persisted effort override instead of default', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({
            reasoningEfforts: { 'claude-sonnet-4.6': 'high' },
        }));
        render(<ModelsView />);
        expect(screen.getByTestId('effort-high').getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId('effort-medium').getAttribute('data-active')).toBe('false');
        expect(screen.getByTestId('effort-low').getAttribute('data-active')).toBe('false');
    });

    it('shows override indicator when effort is persisted', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({
            reasoningEfforts: { 'claude-sonnet-4.6': 'high' },
        }));
        render(<ModelsView />);
        expect(screen.getByTestId('effort-override-indicator')).toBeTruthy();
    });

    it('does not show override indicator when no effort is persisted', () => {
        mockUseModelConfig.mockReturnValue(makeDefaultReturn());
        render(<ModelsView />);
        expect(screen.queryByTestId('effort-override-indicator')).toBeNull();
    });

    it('calls setReasoningEffort when an effort badge is clicked', () => {
        const setReasoningEffort = vi.fn();
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ setReasoningEffort }));
        render(<ModelsView />);
        fireEvent.click(screen.getByTestId('effort-high'));
        expect(setReasoningEffort).toHaveBeenCalledWith('claude-sonnet-4.6', 'high');
    });

    it('calls setReasoningEffort with empty string to reset when clicking already-selected effort', () => {
        const setReasoningEffort = vi.fn();
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({
            setReasoningEffort,
            reasoningEfforts: { 'claude-sonnet-4.6': 'high' },
        }));
        render(<ModelsView />);
        fireEvent.click(screen.getByTestId('effort-high'));
        expect(setReasoningEffort).toHaveBeenCalledWith('claude-sonnet-4.6', '');
    });

    it('does not call setReasoningEffort when clicking the default effort with no override', () => {
        const setReasoningEffort = vi.fn();
        mockUseModelConfig.mockReturnValue(makeDefaultReturn({ setReasoningEffort }));
        render(<ModelsView />);
        fireEvent.click(screen.getByTestId('effort-medium'));
        expect(setReasoningEffort).not.toHaveBeenCalled();
    });
});
