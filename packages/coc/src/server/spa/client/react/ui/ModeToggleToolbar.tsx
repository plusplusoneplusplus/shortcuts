import type { ReactNode } from 'react';

export interface ModeOption<M extends string> {
    value: M;
    label: string;
    testId?: string;
}

export interface ModeToggleToolbarProps<M extends string> {
    modes: readonly ModeOption<M>[];
    activeMode: M;
    onModeChange: (mode: M) => void;

    /** When true, shows a dirty indicator on the active mode button. */
    dirty?: boolean;
    /** When true, show a save button. Only rendered when `dirty` is also true. */
    showSave?: boolean;
    /** Called when the save button is clicked. */
    onSave?: () => void;
    /** Whether a save is currently in progress. */
    saving?: boolean;

    /** Content rendered at the right end of the toolbar. */
    right?: ReactNode;

    /** data-testid for the outer container. */
    testId?: string;
    /** data-testid for the save button. */
    saveTestId?: string;
}

export function ModeToggleToolbar<M extends string>({
    modes,
    activeMode,
    onModeChange,
    dirty = false,
    showSave = false,
    onSave,
    saving = false,
    right,
    testId,
    saveTestId,
}: ModeToggleToolbarProps<M>) {
    return (
        <div className="mode-toggle" data-testid={testId}>
            {modes.map((m) => {
                const isActive = m.value === activeMode;
                const showDirty = isActive && dirty;
                return (
                    <button
                        key={m.value}
                        className={`mode-btn${isActive ? ' active' : ''}`}
                        onClick={() => { if (!isActive) onModeChange(m.value); }}
                        aria-label={showDirty ? `${m.label} (modified)` : undefined}
                        data-testid={m.testId}
                    >{showDirty ? `${m.label} ●` : m.label}</button>
                );
            })}
            {showSave && dirty && (
                <button className="save-btn" onClick={onSave} disabled={saving} data-testid={saveTestId}>
                    {saving ? 'Saving…' : 'Save'}
                </button>
            )}
            {right}
        </div>
    );
}
