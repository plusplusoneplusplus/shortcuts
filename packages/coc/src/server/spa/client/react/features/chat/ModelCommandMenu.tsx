/**
 * ModelCommandMenu — autocomplete dropdown for the `/model` meta-command
 * and the model-picker chip in the composer toolbar.
 *
 * Visual style mirrors `AgentSelectorChip`'s popover: same rounded-md
 * shadow surface, same option row layout (icon + label + checkmark for
 * selected, optional secondary id line). Keyboard navigation is
 * preserved — the highlighted row uses the sunken background and the
 * selected (current) model is indicated by the checkmark.
 *
 * When `onClearOverride` is provided and a `currentModelId` is set, a
 * "Use default" entry is rendered at the top so the user can clear the
 * override without an inline × on the chip (the chip mirrors the agent
 * provider chip, which has no clear button).
 */

import { useEffect, useRef } from 'react';
import { cn } from '../../ui/cn';
import type { ModelInfo } from '../../hooks/useModels';

export interface ModelCommandMenuProps {
    models: ModelInfo[];
    filter: string;
    onSelect: (modelId: string) => void;
    onDismiss: () => void;
    visible: boolean;
    highlightIndex: number;
    currentModelId?: string;
    /**
     * If provided, the menu renders a "Use default" entry at the top
     * (only when `currentModelId` is set) that clears the override.
     * Optional so the `/model` slash-command UX (which doesn't have a
     * persistent chip) can omit it.
     */
    onClearOverride?: () => void;
}

/** Hexagonal model glyph — mirrors the polygon used in the chip. */
function ModelIcon({ className }: { className?: string }) {
    return (
        <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={cn('shrink-0', className)}
        >
            <polygon
                points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
        </svg>
    );
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
    onClearOverride,
}: ModelCommandMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    const filtered = filterModels(models, filter);
    const showClearRow = !!(onClearOverride && currentModelId);

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

    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const items = menuRef.current.querySelectorAll('[data-menu-item]');
        const item = items[highlightIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex, visible]);

    if (!visible) return null;
    // Render the menu when there is at least one row to show. The clear
    // entry counts on its own, so the user can still revert to default
    // even when the filtered model list happens to be empty.
    if (filtered.length === 0 && !showClearRow) return null;

    return (
        <div
            ref={menuRef}
            className={cn(
                'absolute z-[10000] py-0.5 rounded-md shadow-lg overflow-y-auto',
                'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                'max-h-48',
            )}
            style={{
                bottom: '100%',
                marginBottom: '4px',
                left: 0,
                minWidth: 220,
                maxWidth: 480,
            }}
            role="listbox"
            aria-label="Select model"
            data-testid="model-command-menu"
        >
            {showClearRow && (
                <button
                    key="__clear"
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={e => {
                        e.preventDefault();
                        onClearOverride?.();
                        onDismiss();
                    }}
                    className={cn(
                        'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] cursor-pointer transition-colors',
                        'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                        'border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
                    )}
                    data-testid="model-command-menu-clear"
                    title="Clear the override and use the session/default model"
                >
                    <ModelIcon className="text-[#848484] dark:text-[#999]" />
                    <span className="font-medium leading-tight min-w-0 truncate">Use default</span>
                </button>
            )}
            {filtered.map((model, i) => {
                const isCurrent = model.id === currentModelId;
                const isHighlighted = i === highlightIndex;
                return (
                    <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        data-menu-item
                        data-current={isCurrent ? 'true' : 'false'}
                        className={cn(
                            'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] cursor-pointer transition-colors min-w-0',
                            isHighlighted || isCurrent
                                ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                        )}
                        onMouseDown={e => { e.preventDefault(); onSelect(model.id); }}
                    >
                        <ModelIcon className={isCurrent ? 'text-[#0078d4] dark:text-[#3794ff]' : 'text-[#848484] dark:text-[#999]'} />
                        <span className="font-medium leading-tight truncate">{model.name || model.id}</span>
                        {model.name && model.name !== model.id && (
                            <span className="text-[10px] font-mono text-[#848484] dark:text-[#999] truncate min-w-0">
                                {model.id}
                            </span>
                        )}
                        {isCurrent && (
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 ml-auto text-[#0078d4] dark:text-[#3794ff]">
                                <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
