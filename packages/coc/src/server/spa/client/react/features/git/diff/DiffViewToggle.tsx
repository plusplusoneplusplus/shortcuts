import React from 'react';
import type { DiffViewMode } from '../hooks/useDiffViewMode';
import type { DiffEngine } from '../hooks/useDiffEngine';
import { DIFF_TOOLBAR_NARROW_HIDDEN } from './diffToolbarClasses';

interface SegmentButton<T extends string> {
    value: T;
    icon: string;
    label: string;
    title: string;
}

interface DiffToolbarSegmentsProps<T extends string> {
    value: T;
    onChange: (value: T) => void;
    buttons: SegmentButton<T>[];
    groupLabel: string;
    testId: string;
    appearance?: 'default' | 'quiet';
}

function DiffToolbarSegments<T extends string>({ value, onChange, buttons, groupLabel, testId, appearance = 'default' }: DiffToolbarSegmentsProps<T>) {
    const quiet = appearance === 'quiet';
    return (
        <div
            className="inline-flex shrink-0 rounded border border-[#d0d7de] dark:border-[#30363d] overflow-hidden text-xs"
            role="group"
            aria-label={groupLabel}
            data-testid={testId}
        >
            {buttons.map(({ value: buttonValue, icon, label, title }, i) => (
                <button
                    key={buttonValue}
                    onClick={() => onChange(buttonValue)}
                    aria-pressed={value === buttonValue}
                    aria-label={title}
                    title={title}
                    data-testid={`${testId}-${buttonValue}`}
                    className={[
                        'inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0078d4]',
                        quiet ? 'h-7' : '',
                        !quiet && i > 0 ? 'border-l border-[#d0d7de] dark:border-[#30363d]' : '',
                        value === buttonValue
                            ? quiet
                                ? 'bg-[#e8f0fc] dark:bg-[#163b5b] text-[#2465b9] dark:text-[#9acbff] font-medium'
                                : 'bg-[#0550ae] dark:bg-[#79c0ff] text-white dark:text-black font-medium'
                            : 'bg-white dark:bg-[#161b22] text-[#6e7681] hover:bg-[#f3f4f6] dark:hover:bg-[#21262d]',
                    ].join(' ')}
                >
                    {quiet ? (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                            <rect x="2" y="2" width="12" height="12" rx="1" />
                            <path d={buttonValue === 'split' ? 'M8 2v12' : 'M2 6h12M2 10h12'} />
                        </svg>
                    ) : <span aria-hidden="true">{icon}</span>}
                    <span className={`ml-1 ${DIFF_TOOLBAR_NARROW_HIDDEN}`} data-testid={`${testId}-${buttonValue}-label`}>{label}</span>
                </button>
            ))}
        </div>
    );
}

interface DiffViewToggleProps {
    mode: DiffViewMode;
    onChange: (mode: DiffViewMode) => void;
    appearance?: 'default' | 'quiet';
}

const VIEW_BUTTONS: SegmentButton<DiffViewMode>[] = [
    { value: 'unified', icon: '☰', label: 'Unified', title: 'Unified view' },
    { value: 'split',   icon: '⬜', label: 'Split', title: 'Split view' },
];

export function DiffViewToggle({ mode, onChange, appearance }: DiffViewToggleProps) {
    return (
        <DiffToolbarSegments
            value={mode}
            onChange={onChange}
            buttons={VIEW_BUTTONS}
            groupLabel="Diff view mode"
            testId="diff-view-toggle"
            appearance={appearance}
        />
    );
}

interface DiffEngineToggleProps {
    engine: DiffEngine;
    onChange: (engine: DiffEngine) => void;
}

const ENGINE_BUTTONS: SegmentButton<DiffEngine>[] = [
    { value: 'legacy', icon: '≡', label: 'Classic', title: 'Classic diff viewer' },
    { value: 'monaco', icon: '✎', label: 'Editor', title: 'Editor diff viewer' },
];

/** Shared Classic / Editor (Monaco) engine switch for file diffs. */
export function DiffEngineToggle({ engine, onChange }: DiffEngineToggleProps) {
    return (
        <DiffToolbarSegments
            value={engine}
            onChange={onChange}
            buttons={ENGINE_BUTTONS}
            groupLabel="Diff engine"
            testId="diff-engine-toggle"
        />
    );
}
