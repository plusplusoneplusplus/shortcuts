/**
 * ModelCommandMenu component tests.
 *
 * Covers rendering, filtering, selection, highlight, and current model checkmark.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelCommandMenu, filterModels } from '../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu';
import type { ModelInfo } from '../../../../../src/server/spa/client/react/hooks/useModels';

// scrollIntoView is not implemented in jsdom
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const MODELS: ModelInfo[] = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tokenLimit: 200000, enabled: true },
    { id: 'gpt-5.4', name: 'GPT-5.4', tokenLimit: 128000, enabled: true },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tokenLimit: 200000, enabled: true },
];

// ============================================================================
// filterModels (pure utility)
// ============================================================================

describe('filterModels', () => {
    it('returns all models when filter is empty', () => {
        expect(filterModels(MODELS, '')).toEqual(MODELS);
    });

    it('filters by model ID substring', () => {
        const result = filterModels(MODELS, 'claude');
        expect(result).toHaveLength(2);
        expect(result.map(m => m.id)).toEqual(['claude-sonnet-4.6', 'claude-haiku-4.5']);
    });

    it('filters by display name', () => {
        const result = filterModels(MODELS, 'GPT');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('gpt-5.4');
    });

    it('is case-insensitive', () => {
        expect(filterModels(MODELS, 'CLAUDE')).toHaveLength(2);
        expect(filterModels(MODELS, 'gpt')).toHaveLength(1);
    });

    it('returns empty array when no match', () => {
        expect(filterModels(MODELS, 'nonexistent')).toHaveLength(0);
    });
});

// ============================================================================
// ModelCommandMenu rendering
// ============================================================================

describe('ModelCommandMenu', () => {
    it('renders nothing when not visible', () => {
        const { container } = render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={false}
                highlightIndex={0}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when no models match filter', () => {
        const { container } = render(
            <ModelCommandMenu
                models={[]}
                filter="nonexistent"
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders all models when visible with empty filter', () => {
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
            />
        );
        expect(screen.getByTestId('model-command-menu')).toBeTruthy();
        expect(screen.getByText('Claude Sonnet 4.6')).toBeTruthy();
        expect(screen.getByText('GPT-5.4')).toBeTruthy();
        expect(screen.getByText('Claude Haiku 4.5')).toBeTruthy();
    });

    it('calls onSelect with model ID when item is clicked', () => {
        const onSelect = vi.fn();
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={onSelect}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
            />
        );
        fireEvent.mouseDown(screen.getByText('GPT-5.4'));
        expect(onSelect).toHaveBeenCalledWith('gpt-5.4');
    });

    it('marks the current model with aria-selected and data-current', () => {
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
                currentModelId="gpt-5.4"
            />
        );
        const menu = screen.getByTestId('model-command-menu');
        const rows = menu.querySelectorAll('[data-menu-item]');
        const current = Array.from(rows).find(r => r.getAttribute('data-current') === 'true') as HTMLElement;
        expect(current).toBeTruthy();
        expect(current.textContent).toContain('GPT-5.4');
        expect(current.getAttribute('aria-selected')).toBe('true');
    });

    it('does not mark any row as current when no current model matches', () => {
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
                currentModelId="unknown-model"
            />
        );
        const rows = screen.getByTestId('model-command-menu').querySelectorAll('[data-menu-item]');
        const current = Array.from(rows).find(r => r.getAttribute('data-current') === 'true');
        expect(current).toBeUndefined();
    });

    it('filters models by prefix', () => {
        render(
            <ModelCommandMenu
                models={filterModels(MODELS, 'claude')}
                filter="claude"
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
            />
        );
        expect(screen.queryByText('GPT-5.4')).toBeNull();
        expect(screen.getByText('Claude Sonnet 4.6')).toBeTruthy();
    });

    it('renders a "Use default" entry when onClearOverride is wired and a current model is set', () => {
        const onClearOverride = vi.fn();
        const onDismiss = vi.fn();
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={onDismiss}
                visible={true}
                highlightIndex={0}
                currentModelId="gpt-5.4"
                onClearOverride={onClearOverride}
            />
        );
        const clearRow = screen.getByTestId('model-command-menu-clear');
        expect(clearRow).toBeTruthy();
        expect(clearRow.textContent).toContain('Use default');
        fireEvent.mouseDown(clearRow);
        expect(onClearOverride).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('omits the "Use default" entry when onClearOverride is not wired', () => {
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
                currentModelId="gpt-5.4"
            />
        );
        expect(screen.queryByTestId('model-command-menu-clear')).toBeNull();
    });

    it('omits the "Use default" entry when no current model is set, even if onClearOverride is provided', () => {
        render(
            <ModelCommandMenu
                models={MODELS}
                filter=""
                onSelect={vi.fn()}
                onDismiss={vi.fn()}
                visible={true}
                highlightIndex={0}
                onClearOverride={vi.fn()}
            />
        );
        expect(screen.queryByTestId('model-command-menu-clear')).toBeNull();
    });
});
