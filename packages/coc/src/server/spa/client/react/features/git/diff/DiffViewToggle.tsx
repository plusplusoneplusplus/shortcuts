import React from 'react';
import type { DiffViewMode } from '../hooks/useDiffViewMode';
import { DIFF_TOOLBAR_NARROW_HIDDEN } from './diffToolbarClasses';

interface DiffViewToggleProps {
    mode: DiffViewMode;
    onChange: (mode: DiffViewMode) => void;
}

const BUTTONS: { value: DiffViewMode; icon: string; label: string }[] = [
    { value: 'unified', icon: '☰', label: 'Unified' },
    { value: 'split',   icon: '⬜', label: 'Split' },
];

export function DiffViewToggle({ mode, onChange }: DiffViewToggleProps) {
    return (
        <div
            className="inline-flex shrink-0 rounded border border-[#d0d7de] dark:border-[#30363d] overflow-hidden text-xs"
            role="group"
            aria-label="Diff view mode"
            data-testid="diff-view-toggle"
        >
            {BUTTONS.map(({ value, icon, label }, i) => (
                <button
                    key={value}
                    onClick={() => onChange(value)}
                    aria-pressed={mode === value}
                    aria-label={`${label} view`}
                    title={`${label} view`}
                    data-testid={`diff-view-toggle-${value}`}
                    className={[
                        'inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 transition-colors',
                        i > 0 ? 'border-l border-[#d0d7de] dark:border-[#30363d]' : '',
                        mode === value
                            ? 'bg-[#0550ae] dark:bg-[#79c0ff] text-white dark:text-black font-medium'
                            : 'bg-white dark:bg-[#161b22] text-[#6e7681] hover:bg-[#f3f4f6] dark:hover:bg-[#21262d]',
                    ].join(' ')}
                >
                    <span aria-hidden="true">{icon}</span>
                    <span className={`ml-1 ${DIFF_TOOLBAR_NARROW_HIDDEN}`} data-testid={`diff-view-toggle-${value}-label`}>{label}</span>
                </button>
            ))}
        </div>
    );
}
