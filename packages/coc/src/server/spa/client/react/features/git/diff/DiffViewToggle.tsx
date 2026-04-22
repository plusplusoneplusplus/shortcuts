import React from 'react';
import type { DiffViewMode } from '../hooks/useDiffViewMode';

interface DiffViewToggleProps {
    mode: DiffViewMode;
    onChange: (mode: DiffViewMode) => void;
}

const BUTTONS: { value: DiffViewMode; label: string }[] = [
    { value: 'unified', label: '☰ Unified' },
    { value: 'split',   label: '⬜ Split' },
];

export function DiffViewToggle({ mode, onChange }: DiffViewToggleProps) {
    return (
        <div
            className="inline-flex rounded border border-[#d0d7de] dark:border-[#30363d] overflow-hidden text-xs"
            role="group"
            aria-label="Diff view mode"
            data-testid="diff-view-toggle"
        >
            {BUTTONS.map(({ value, label }, i) => (
                <button
                    key={value}
                    onClick={() => onChange(value)}
                    aria-pressed={mode === value}
                    data-testid={`diff-view-toggle-${value}`}
                    className={[
                        'px-2 py-0.5 transition-colors',
                        i > 0 ? 'border-l border-[#d0d7de] dark:border-[#30363d]' : '',
                        mode === value
                            ? 'bg-[#0550ae] dark:bg-[#79c0ff] text-white dark:text-black font-medium'
                            : 'bg-white dark:bg-[#161b22] text-[#6e7681] hover:bg-[#f3f4f6] dark:hover:bg-[#21262d]',
                    ].join(' ')}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
