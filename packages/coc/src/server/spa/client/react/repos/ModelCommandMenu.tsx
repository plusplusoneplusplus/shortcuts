/**
 * ModelCommandMenu — autocomplete dropdown for the `/model` meta-command.
 *
 * Same visual pattern as SlashCommandMenu but shows available AI models.
 * Supports keyboard navigation (ArrowUp/Down, Enter/Tab to select, Escape to dismiss).
 */

import { useEffect, useRef } from 'react';
import type { ModelInfo } from '../hooks/useModels';

export interface ModelCommandMenuProps {
    models: ModelInfo[];
    filter: string;
    onSelect: (modelId: string) => void;
    onDismiss: () => void;
    visible: boolean;
    highlightIndex: number;
    currentModelId?: string;
}

/** Filter models by ID or display name against a prefix. */
export function filterModels(models: ModelInfo[], prefix: string): ModelInfo[] {
    if (!prefix) return models;
    const lc = prefix.toLowerCase();
    return models.filter(m =>
        m.id.toLowerCase().includes(lc) ||
        (m.name && m.name.toLowerCase().includes(lc))
    );
}

export function ModelCommandMenu({
    models,
    filter,
    onSelect,
    onDismiss,
    visible,
    highlightIndex,
    currentModelId,
}: ModelCommandMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    const filtered = filterModels(models, filter);

    // Dismiss on outside click
    useEffect(() => {
        if (!visible) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onDismiss();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [visible, onDismiss]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const items = menuRef.current.querySelectorAll('[data-menu-item]');
        const item = items[highlightIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex, visible]);

    if (!visible || filtered.length === 0) return null;

    return (
        <div
            ref={menuRef}
            className="absolute z-50 border rounded shadow-lg bg-white dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#3c3c3c] max-h-48 overflow-y-auto text-sm"
            style={{
                bottom: '100%',
                left: 0,
                minWidth: 220,
                maxWidth: 480,
            }}
            data-testid="model-command-menu"
        >
            {filtered.map((model, i) => {
                const isCurrent = model.id === currentModelId;
                return (
                    <div
                        key={model.id}
                        data-menu-item
                        className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 min-w-0 overflow-hidden ${
                            i === highlightIndex
                                ? 'bg-[#e8e8e8] dark:bg-[#37373d]'
                                : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'
                        }`}
                        onMouseDown={e => { e.preventDefault(); onSelect(model.id); }}
                    >
                        {isCurrent && <span className="text-[#6a9955]">✓</span>}
                        <span className="text-blue-500">🤖</span>
                        <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">{model.name || model.id}</span>
                        {model.name && model.name !== model.id && (
                            <span className="text-xs text-[#848484] truncate min-w-0">{model.id}</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
