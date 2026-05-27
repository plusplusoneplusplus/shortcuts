/**
 * useModelCommand — manages the `/model` meta-command state.
 *
 * Handles model picker visibility, filtering, keyboard navigation,
 * and the modelOverride that persists until cleared.
 */

import { useState, useCallback } from 'react';
import type { ModelInfo } from '../../../hooks/useModels';
import { isMetaCommand } from '../slash-command-parser';
import { filterModels } from '../ModelCommandMenu';

export interface UseModelCommandResult {
    /** Whether the model picker menu is visible */
    modelMenuVisible: boolean;
    /** Current filter text for models */
    modelFilter: string;
    /** Filtered list of models matching the current filter */
    filteredModels: ModelInfo[];
    /** Currently highlighted model index */
    modelHighlightIndex: number;
    /** The user-selected model override, or null for session default */
    modelOverride: string | null;
    /** Set the model override directly (e.g., from initial state) */
    setModelOverride: (model: string | null) => void;
    /** Handle model selection from the picker */
    handleModelSelect: (modelId: string) => void;
    /** Show the model picker menu */
    showModelMenu: (filter?: string) => void;
    /** Dismiss the model picker menu */
    dismissModelMenu: () => void;
    /** Handle keyboard events when model menu is visible. Returns true if consumed. */
    handleModelKeyDown: (e: React.KeyboardEvent<HTMLElement>) => boolean;
    /** Update filter text (for continued typing after /model) */
    setModelFilter: (filter: string) => void;
}

/**
 * Resolve the list of models the chat composer's `/model` picker should
 * surface. Prefers the user-enabled subset, but falls back to the full
 * model list when nothing is enabled — otherwise the dropdown silently
 * renders nothing on accounts where Copilot returns every model as
 * `enabled: false` (fresh installs, accounts that haven't opted into the
 * per-model admin toggles, etc.). Mirrors the same fallback used by
 * EnqueueDialog/RunScriptDialog/etc.
 */
export function selectPickableModels(availableModels: ModelInfo[]): ModelInfo[] {
    const enabled = availableModels.filter(m => m.enabled);
    return enabled.length > 0 ? enabled : availableModels;
}

export function useModelCommand(
    enabledModels: ModelInfo[],
): UseModelCommandResult {
    const [modelMenuVisible, setModelMenuVisible] = useState(false);
    const [modelFilter, setModelFilter] = useState('');
    const [modelHighlightIndex, setModelHighlightIndex] = useState(0);
    const [modelOverride, setModelOverride] = useState<string | null>(null);

    const filteredModels = modelMenuVisible
        ? filterModels(enabledModels, modelFilter)
        : [];

    const showModelMenu = useCallback((filter = '') => {
        setModelFilter(filter);
        setModelMenuVisible(true);
        setModelHighlightIndex(0);
    }, []);

    const dismissModelMenu = useCallback(() => {
        setModelMenuVisible(false);
        setModelFilter('');
    }, []);

    const handleModelSelect = useCallback((modelId: string) => {
        setModelOverride(modelId);
        setModelMenuVisible(false);
        setModelFilter('');
    }, []);

    const handleModelKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>): boolean => {
        if (!modelMenuVisible || filteredModels.length === 0) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setModelHighlightIndex(prev => (prev + 1) % filteredModels.length);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setModelHighlightIndex(prev => (prev - 1 + filteredModels.length) % filteredModels.length);
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            dismissModelMenu();
            return true;
        }
        return false;
    }, [modelMenuVisible, filteredModels.length, dismissModelMenu]);

    return {
        modelMenuVisible,
        modelFilter,
        filteredModels,
        modelHighlightIndex,
        modelOverride,
        setModelOverride,
        handleModelSelect,
        showModelMenu,
        dismissModelMenu,
        handleModelKeyDown,
        setModelFilter,
    };
}

/** Check if a prefix could match the `/model` command (for menu filtering). */
export function isModelCommandPrefix(prefix: string): boolean {
    if (!prefix) return true; // empty prefix → show all commands including /model
    return 'model'.startsWith(prefix.toLowerCase());
}

export { isMetaCommand };
