/**
 * useModelCommand hook tests.
 *
 * Covers state transitions, model selection, keyboard navigation,
 * and isModelCommandPrefix utility.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModelCommand, isModelCommandPrefix, selectPickableModels } from '../../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand';
import type { ModelInfo } from '../../../../../src/server/spa/client/react/hooks/useModels';

const MODELS: ModelInfo[] = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tokenLimit: 200000, enabled: true },
    { id: 'gpt-5.4', name: 'GPT-5.4', tokenLimit: 128000, enabled: true },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tokenLimit: 200000, enabled: true },
];

function makeKeyEvent(key: string): React.KeyboardEvent<HTMLElement> {
    return { key, preventDefault: () => {} } as unknown as React.KeyboardEvent<HTMLElement>;
}

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

// ============================================================================
// selectPickableModels — fallback when no models are enabled
// ============================================================================

describe('selectPickableModels', () => {
    const ENABLED_A: ModelInfo = { id: 'a', name: 'A', tokenLimit: 0, enabled: true, supportedReasoningEfforts: [] };
    const ENABLED_B: ModelInfo = { id: 'b', name: 'B', tokenLimit: 0, enabled: true, supportedReasoningEfforts: [] };
    const DISABLED_C: ModelInfo = { id: 'c', name: 'C', tokenLimit: 0, enabled: false, supportedReasoningEfforts: [] };
    const DISABLED_D: ModelInfo = { id: 'd', name: 'D', tokenLimit: 0, enabled: false, supportedReasoningEfforts: [] };

    it('returns just the enabled subset when at least one model is enabled', () => {
        const result = selectPickableModels([ENABLED_A, DISABLED_C, ENABLED_B]);
        expect(result.map(m => m.id)).toEqual(['a', 'b']);
    });

    it('falls back to the FULL list when zero models are enabled (regression)', () => {
        // Regression for: clicking the model picker chip rendered nothing
        // because every model came back from Copilot as `enabled: false`,
        // collapsing the picker into an empty list. With the fallback the
        // dropdown still has rows to render.
        const result = selectPickableModels([DISABLED_C, DISABLED_D]);
        expect(result.map(m => m.id)).toEqual(['c', 'd']);
    });

    it('returns an empty list when given an empty input (no fallback to invent rows)', () => {
        expect(selectPickableModels([])).toEqual([]);
    });

    it('preserves the input order in both branches', () => {
        const enabledOnly = selectPickableModels([ENABLED_B, DISABLED_C, ENABLED_A]);
        expect(enabledOnly.map(m => m.id)).toEqual(['b', 'a']);
        const fallback = selectPickableModels([DISABLED_D, DISABLED_C]);
        expect(fallback.map(m => m.id)).toEqual(['d', 'c']);
    });

    it('does not mutate the input array', () => {
        const input = [ENABLED_A, DISABLED_C];
        const copy = [...input];
        selectPickableModels(input);
        expect(input).toEqual(copy);
    });
});

// ============================================================================
// Regression: useSlashCommands must include "model" for keyboard nav to work
// ============================================================================

describe('useSlashCommands with model entry (regression)', () => {
    // This test documents the requirement that the "model" entry must be included
    // in the skills list passed to useSlashCommands, so that keyboard navigation
    // (Tab/Enter) correctly identifies the "model" item and transitions to the
    // model picker instead of falling through.

    let useSlashCommands: typeof import('../../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands').useSlashCommands;
    beforeAll(async () => {
        const mod = await import('../../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands');
        useSlashCommands = mod.useSlashCommands;
    });

    const SKILLS = [
        { name: 'impl', description: 'Implement changes' },
        { name: 'model', description: 'Switch AI model' },
    ];

    it('filteredSkills includes "model" when prefix is "mo"', () => {
        const { result } = renderHook(() => useSlashCommands(SKILLS));
        act(() => result.current.handleInputChange('/mo', 3));
        expect(result.current.menuVisible).toBe(true);
        expect(result.current.filteredSkills.map(s => s.name)).toContain('model');
    });

    it('handleKeyDown returns true when "model" matches filter', () => {
        const { result } = renderHook(() => useSlashCommands(SKILLS));
        act(() => result.current.handleInputChange('/mo', 3));
        expect(result.current.filteredSkills.length).toBeGreaterThan(0);
        let consumed = false;
        act(() => { consumed = result.current.handleKeyDown(makeKeyEvent('Tab')); });
        expect(consumed).toBe(true);
    });

    it('filteredSkills is empty when "model" is NOT in skills (regression scenario)', () => {
        const skillsWithoutModel = [{ name: 'impl', description: 'Implement changes' }];
        const { result } = renderHook(() => useSlashCommands(skillsWithoutModel));
        act(() => result.current.handleInputChange('/mo', 3));
        // "mo" does not match "impl", so filteredSkills is empty
        expect(result.current.filteredSkills).toHaveLength(0);
        // handleKeyDown returns false — this was the bug
        let consumed = false;
        act(() => { consumed = result.current.handleKeyDown(makeKeyEvent('Tab')); });
        expect(consumed).toBe(false);
    });
});
