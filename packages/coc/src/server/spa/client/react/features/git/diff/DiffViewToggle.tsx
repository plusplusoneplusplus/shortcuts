import React from 'react';
import type { DiffViewMode } from '../hooks/useDiffViewMode';
import type { DiffEngine } from '../hooks/useDiffEngine';
import { useDiffWordWrap } from '../hooks/useDiffWordWrap';
import { DIFF_TOOLBAR_NARROW_HIDDEN } from './diffToolbarClasses';

interface ToggleOption<T extends string> {
    value: T;
    icon: string;
    label: string;
    title: string;
}

interface DiffToolbarToggleProps<T extends string> {
    value: T;
    onChange: (value: T) => void;
    /** Exactly two options; the button shows the current one and flips to the other. */
    buttons: [ToggleOption<T>, ToggleOption<T>];
    testId: string;
    appearance?: 'default' | 'quiet';
}

/** One button that shows the current option and switches to the other on click. */
function DiffToolbarToggle<T extends string>({ value, onChange, buttons, testId, appearance = 'default' }: DiffToolbarToggleProps<T>) {
    const quiet = appearance === 'quiet';
    const current = buttons[0].value === value ? buttons[0] : buttons[1];
    const next = current === buttons[0] ? buttons[1] : buttons[0];
    const title = `${current.title} — switch to ${next.label}`;
    return (
        <button
            type="button"
            onClick={() => onChange(next.value)}
            aria-label={title}
            title={title}
            data-testid={testId}
            data-value={current.value}
            className={[
                'inline-flex items-center whitespace-nowrap shrink-0 rounded border border-[#d0d7de] dark:border-[#30363d] px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0078d4]',
                quiet ? 'h-7' : '',
                'bg-white dark:bg-[#161b22] text-[#1f2328] dark:text-[#c9d1d9] hover:bg-[#f3f4f6] dark:hover:bg-[#21262d]',
            ].join(' ')}
        >
            {quiet ? (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                    <rect x="2" y="2" width="12" height="12" rx="1" />
                    <path d={current.value === 'split' ? 'M8 2v12' : 'M2 6h12M2 10h12'} />
                </svg>
            ) : <span aria-hidden="true">{current.icon}</span>}
            <span className={`ml-1 ${DIFF_TOOLBAR_NARROW_HIDDEN}`} data-testid={`${testId}-label`}>{current.label}</span>
        </button>
    );
}

interface DiffViewToggleProps {
    mode: DiffViewMode;
    onChange: (mode: DiffViewMode) => void;
    appearance?: 'default' | 'quiet';
}

const VIEW_BUTTONS: [ToggleOption<DiffViewMode>, ToggleOption<DiffViewMode>] = [
    { value: 'unified', icon: '☰', label: 'Unified', title: 'Unified view' },
    { value: 'split',   icon: '⬜', label: 'Split', title: 'Split view' },
];

export function DiffViewToggle({ mode, onChange, appearance }: DiffViewToggleProps) {
    return (
        <DiffToolbarToggle
            value={mode}
            onChange={onChange}
            buttons={VIEW_BUTTONS}
            testId="diff-view-toggle"
            appearance={appearance}
        />
    );
}

interface DiffEngineToggleProps {
    engine: DiffEngine;
    onChange: (engine: DiffEngine) => void;
}

const ENGINE_BUTTONS: [ToggleOption<DiffEngine>, ToggleOption<DiffEngine>] = [
    { value: 'legacy', icon: '≡', label: 'Classic', title: 'Classic diff viewer' },
    { value: 'monaco', icon: '✎', label: 'Editor', title: 'Editor diff viewer' },
];

/** Shared Classic / Editor (Monaco) engine toggle for file diffs. */
export function DiffEngineToggle({ engine, onChange }: DiffEngineToggleProps) {
    return (
        <DiffToolbarToggle
            value={engine}
            onChange={onChange}
            buttons={ENGINE_BUTTONS}
            testId="diff-engine-toggle"
        />
    );
}

/** Shared, keyboard-accessible toggle for Monaco's original and modified panes. */
export function DiffWordWrapToggle() {
    const [enabled, setEnabled] = useDiffWordWrap();
    return (
        <button
            type="button"
            aria-label="Word wrap"
            aria-pressed={enabled}
            title={enabled ? 'Disable word wrap' : 'Enable word wrap'}
            onClick={() => setEnabled(!enabled)}
            data-testid="diff-word-wrap-toggle"
            className={[
                'inline-flex items-center whitespace-nowrap shrink-0 rounded border px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0078d4]',
                enabled
                    ? 'border-[#0078d4] bg-[#ddeeff] text-[#005a9e] dark:border-[#3794ff] dark:bg-[#1e3a5f] dark:text-[#79c0ff]'
                    : 'border-[#d0d7de] dark:border-[#30363d] bg-white dark:bg-[#161b22] text-[#1f2328] dark:text-[#c9d1d9] hover:bg-[#f3f4f6] dark:hover:bg-[#21262d]',
            ].join(' ')}
        >
            Word wrap
        </button>
    );
}
