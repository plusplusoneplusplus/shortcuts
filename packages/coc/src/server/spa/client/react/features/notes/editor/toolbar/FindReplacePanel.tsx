import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { Sep } from './ToolbarDropdown';
import { useFindAndReplaceState, getSelectedText } from './useFindReplaceToolbarController';

export interface FindReplacePanelProps {
    editor: Editor;
    /** Close the panel (also clears the search, dropping stale highlights). */
    onClose: () => void;
}

/** Toggle for one of the search modifiers (case / whole word / regex). */
function FindModeToggle({
    label,
    icon,
    active,
    onToggle,
    disabled,
    testId,
}: {
    label: string;
    icon: string;
    active: boolean;
    onToggle: () => void;
    disabled?: boolean;
    testId: string;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            data-testid={testId}
            className={
                'h-6 min-w-6 px-1 rounded text-[11px] font-mono flex items-center justify-center ' +
                (disabled
                    ? 'opacity-40 cursor-not-allowed text-[#888]'
                    : active
                        ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                        : 'text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#505050]')
            }
            onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the find input
                if (!disabled) onToggle();
            }}
        >
            {icon}
        </button>
    );
}

export function FindReplacePanel({ editor, onClose }: FindReplacePanelProps) {
    const state = useFindAndReplaceState(editor);
    const [findTerm, setFindTerm] = useState(state.searchTerm);
    const [replaceTerm, setReplaceTerm] = useState('');
    const findInputRef = useRef<HTMLInputElement>(null);

    // Focus the find input when the panel opens, and seed it from any selected
    // text so "select a word, hit find" does the obvious thing.
    useEffect(() => {
        const selected = getSelectedText(editor);
        if (selected) {
            setFindTerm(selected);
            editor.commands?.setSearchTerm?.(selected);
        }
        findInputRef.current?.focus();
        findInputRef.current?.select();
        // Mount-only: re-seeding on every render would fight the user's typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const total = state.results.length;
    // `currentIndex` is a 0-based index into the results, or null when nothing
    // is selected yet. Users count from 1.
    const position = state.currentIndex === null ? 0 : state.currentIndex + 1;
    const hasResults = total > 0;

    function handleFindChange(term: string) {
        setFindTerm(term);
        // The extension debounces the actual search, so typing stays responsive
        // on large documents.
        editor.commands?.setSearchTerm?.(term);
    }

    function handleReplaceChange(term: string) {
        setReplaceTerm(term);
        editor.commands?.setReplaceTerm?.(term);
    }

    function handleFindKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) editor.commands?.goToPreviousResult?.();
            else editor.commands?.goToNextResult?.();
        }
    }

    return (
        <div
            className="flex items-center gap-1 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-wrap text-[#1e1e1e] dark:text-[#cccccc]"
            role="search"
            aria-label="Find and replace"
            data-testid="find-replace-panel"
        >
            <input
                ref={findInputRef}
                type="text"
                value={findTerm}
                onChange={(e) => handleFindChange(e.target.value)}
                onKeyDown={handleFindKeyDown}
                placeholder="Find"
                aria-label="Find"
                data-testid="find-input"
                className="h-6 w-40 px-1.5 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
            />

            <span
                className="text-[11px] tabular-nums text-[#888] min-w-[3.5rem] text-center"
                data-testid="find-match-count"
            >
                {findTerm === '' ? '' : hasResults ? `${position} / ${total}` : 'No results'}
            </span>

            <button
                type="button"
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
                disabled={!hasResults}
                data-testid="find-prev-btn"
                className="h-6 w-6 rounded text-xs flex items-center justify-center text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#505050] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                onMouseDown={(e) => {
                    e.preventDefault();
                    editor.commands?.goToPreviousResult?.();
                }}
            >
                ↑
            </button>
            <button
                type="button"
                title="Next match (Enter)"
                aria-label="Next match"
                disabled={!hasResults}
                data-testid="find-next-btn"
                className="h-6 w-6 rounded text-xs flex items-center justify-center text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#505050] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                onMouseDown={(e) => {
                    e.preventDefault();
                    editor.commands?.goToNextResult?.();
                }}
            >
                ↓
            </button>

            <Sep />

            <FindModeToggle
                label="Match case"
                icon="Aa"
                active={state.caseSensitive}
                testId="find-case-toggle"
                onToggle={() => editor.commands?.setCaseSensitive?.(!state.caseSensitive)}
            />
            <FindModeToggle
                label="Match whole word"
                icon="ab|"
                active={state.wholeWord}
                // The extension ignores whole-word in regex mode, so surface that
                // rather than letting the toggle look effective but do nothing.
                disabled={state.useRegex}
                testId="find-whole-word-toggle"
                onToggle={() => editor.commands?.setWholeWord?.(!state.wholeWord)}
            />
            <FindModeToggle
                label="Use regular expression"
                icon=".*"
                active={state.useRegex}
                testId="find-regex-toggle"
                onToggle={() => editor.commands?.setUseRegex?.(!state.useRegex)}
            />

            <Sep />

            <input
                type="text"
                value={replaceTerm}
                onChange={(e) => handleReplaceChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        onClose();
                    }
                }}
                placeholder="Replace with"
                aria-label="Replace with"
                data-testid="replace-input"
                className="h-6 w-40 px-1.5 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
            />
            <button
                type="button"
                title="Replace the current match"
                aria-label="Replace"
                disabled={!hasResults}
                data-testid="replace-btn"
                className="h-6 px-2 rounded text-[11px] text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#505050] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                onMouseDown={(e) => {
                    e.preventDefault();
                    editor.commands?.replace?.();
                }}
            >
                Replace
            </button>
            <button
                type="button"
                title="Replace every match"
                aria-label="Replace all"
                disabled={!hasResults}
                data-testid="replace-all-btn"
                className="h-6 px-2 rounded text-[11px] text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#505050] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                onMouseDown={(e) => {
                    e.preventDefault();
                    editor.commands?.replaceAll?.();
                }}
            >
                Replace all
            </button>

            <div className="ml-auto" />
            <button
                type="button"
                title="Close find (Esc)"
                aria-label="Close find"
                data-testid="find-close-btn"
                className="h-6 w-6 rounded text-xs flex items-center justify-center text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                onMouseDown={(e) => {
                    e.preventDefault();
                    onClose();
                }}
            >
                ✕
            </button>
        </div>
    );
}
