/**
 * useModelCommand hook tests.
 *
 * Covers state transitions, model selection, keyboard navigation,
 * and isModelCommandPrefix utility.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModelCommand, isModelCommandPrefix } from '../../../../../src/server/spa/client/react/repos/useModelCommand';
import type { ModelInfo } from '../../../../../src/server/spa/client/react/hooks/useModels';

const MODELS: ModelInfo[] = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tokenLimit: 200000, enabled: true },
    { id: 'gpt-5.4', name: 'GPT-5.4', tokenLimit: 128000, enabled: true },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tokenLimit: 200000, enabled: true },
];

// ============================================================================
// isModelCommandPrefix
// ============================================================================

describe('isModelCommandPrefix', () => {
    it('returns true for empty prefix', () => {
        expect(isModelCommandPrefix('')).toBe(true);
    });

    it('returns true for partial "m"', () => {
        expect(isModelCommandPrefix('m')).toBe(true);
    });

    it('returns true for partial "mod"', () => {
        expect(isModelCommandPrefix('mod')).toBe(true);
    });

    it('returns true for full "model"', () => {
        expect(isModelCommandPrefix('model')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isModelCommandPrefix('MODEL')).toBe(true);
        expect(isModelCommandPrefix('Mod')).toBe(true);
    });

    it('returns false for non-matching prefix', () => {
        expect(isModelCommandPrefix('x')).toBe(false);
        expect(isModelCommandPrefix('models')).toBe(false);
    });
});

// ============================================================================
// useModelCommand hook
// ============================================================================

describe('useModelCommand', () => {
    it('starts with menu hidden and no override', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        expect(result.current.modelMenuVisible).toBe(false);
        expect(result.current.modelOverride).toBeNull();
        expect(result.current.filteredModels).toEqual([]);
    });

    it('showModelMenu opens the menu', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        act(() => result.current.showModelMenu());
        expect(result.current.modelMenuVisible).toBe(true);
        expect(result.current.filteredModels).toHaveLength(3);
    });

    it('showModelMenu with filter restricts models', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        act(() => result.current.showModelMenu('claude'));
        expect(result.current.modelMenuVisible).toBe(true);
        expect(result.current.filteredModels).toHaveLength(2);
    });

    it('dismissModelMenu closes the menu', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        act(() => result.current.showModelMenu());
        act(() => result.current.dismissModelMenu());
        expect(result.current.modelMenuVisible).toBe(false);
    });

    it('handleModelSelect sets override and closes menu', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        act(() => result.current.showModelMenu());
        act(() => result.current.handleModelSelect('gpt-5.4'));
        expect(result.current.modelOverride).toBe('gpt-5.4');
        expect(result.current.modelMenuVisible).toBe(false);
    });

    it('setModelOverride(null) clears the override', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        act(() => result.current.handleModelSelect('gpt-5.4'));
        expect(result.current.modelOverride).toBe('gpt-5.4');
        act(() => result.current.setModelOverride(null));
        expect(result.current.modelOverride).toBeNull();
    });

    it('setModelFilter updates the filter', () => {
        const { result } = renderHook(() => useModelCommand(MODELS));
        act(() => result.current.showModelMenu());
        act(() => result.current.setModelFilter('gpt'));
        expect(result.current.modelFilter).toBe('gpt');
        expect(result.current.filteredModels).toHaveLength(1);
    });

    describe('keyboard navigation', () => {
        function makeKeyEvent(key: string): React.KeyboardEvent<HTMLElement> {
            return { key, preventDefault: () => {} } as unknown as React.KeyboardEvent<HTMLElement>;
        }

        it('returns false when menu is hidden', () => {
            const { result } = renderHook(() => useModelCommand(MODELS));
            const consumed = result.current.handleModelKeyDown(makeKeyEvent('ArrowDown'));
            expect(consumed).toBe(false);
        });

        it('ArrowDown increments highlight', () => {
            const { result } = renderHook(() => useModelCommand(MODELS));
            act(() => result.current.showModelMenu());
            expect(result.current.modelHighlightIndex).toBe(0);
            act(() => { result.current.handleModelKeyDown(makeKeyEvent('ArrowDown')); });
            expect(result.current.modelHighlightIndex).toBe(1);
        });

        it('ArrowUp decrements highlight (wraps)', () => {
            const { result } = renderHook(() => useModelCommand(MODELS));
            act(() => result.current.showModelMenu());
            expect(result.current.modelHighlightIndex).toBe(0);
            act(() => { result.current.handleModelKeyDown(makeKeyEvent('ArrowUp')); });
            expect(result.current.modelHighlightIndex).toBe(2); // wraps to last
        });

        it('Enter returns true (consumed)', () => {
            const { result } = renderHook(() => useModelCommand(MODELS));
            act(() => result.current.showModelMenu());
            let consumed = false;
            act(() => { consumed = result.current.handleModelKeyDown(makeKeyEvent('Enter')); });
            expect(consumed).toBe(true);
        });

        it('Escape closes menu', () => {
            const { result } = renderHook(() => useModelCommand(MODELS));
            act(() => result.current.showModelMenu());
            act(() => { result.current.handleModelKeyDown(makeKeyEvent('Escape')); });
            expect(result.current.modelMenuVisible).toBe(false);
        });
    });
});
