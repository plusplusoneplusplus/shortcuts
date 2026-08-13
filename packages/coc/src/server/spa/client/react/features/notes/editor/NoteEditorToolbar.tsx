import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode, RefObject, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Editor } from '@tiptap/react';
import type { TocEntry } from './noteTocUtils';
import { activeTableHasColumnWidths, clearActiveTableColumnWidths } from './tableColumnWidths';
import { NoteTocPanel } from './NoteTocPanel';

export interface NoteEditorToolbarProps {
    editor: Editor | null;
    /** When true, formatting buttons are hidden but the mode toggle and right-end controls (comments) remain visible. */
    hidden?: boolean;
    commentsPanelOpen?: boolean;
    onToggleCommentsPanel?: () => void;
    commentCount?: number;
    /** Inline Rich/Source mode toggle rendered at the left end of the toolbar. */
    modeToggle?: ReactNode;
    /** Number of active AI edit regions in the editor. */
    aiEditCount?: number;
    /** Called to dismiss AI edit decorations permanently. */
    onDismissAiEdits?: () => void;
    /** Called to toggle AI edit decoration visibility. */
    onToggleAiEdits?: () => void;
    /** Whether AI edit decorations are currently shown. */
    aiEditsVisible?: boolean;
    /** Extra content rendered at the right end of the toolbar (before the mode toggle). */
    toolbarRight?: ReactNode;
    /** Called to manually refresh/reload the note from disk. When provided, a ↻ button is rendered. */
    onRefresh?: () => void;
    /** When true, the refresh button is disabled (load in progress). */
    refreshing?: boolean;
    /** Whether the AI chat panel is currently open. */
    chatPanelOpen?: boolean;
    /** Called to toggle the AI chat panel. When provided, the 🤖 button is rendered. */
    onToggleChatPanel?: () => void;
    /** When set, keeps the AI chat button visible but disabled with this reason. */
    chatDisabledReason?: string;
    /** When true, the 🤖 button is tinted blue to indicate an existing chat history. */
    hasExistingChat?: boolean;
    /** Whether the TOC panel is currently open. */
    tocOpen?: boolean;
    /** Called to toggle the TOC panel. When provided, the ≡ button is rendered. */
    onToggleToc?: () => void;
    /** Heading entries for the TOC. Empty list disables the button. */
    tocEntries?: TocEntry[];
    /** Currently active (scroll-spy) heading index, or null. */
    tocActiveIndex?: number | null;
    /** Called when the user clicks a TOC entry to jump to it. */
    onTocJump?: (entry: TocEntry) => void;
    /** Called when the "Insert PDF" button is clicked (opens the hidden file picker). */
    onInsertPdf?: () => void;
}

// ── Highlight color palette ─────────────────────────────────────────────────

export const HIGHLIGHT_COLORS = [
    { name: 'Yellow', color: '#fff3b0' },
    { name: 'Green', color: '#b9f5d0' },
    { name: 'Blue', color: '#bde0fe' },
    { name: 'Pink', color: '#ffc8dd' },
    { name: 'Orange', color: '#ffd6a5' },
    { name: 'Purple', color: '#e0c3fc' },
] as const;

const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].color;

// ── Toolbar button helper ───────────────────────────────────────────────────

interface TBProps {
    editor: Editor;
    label: string;
    icon: string;
    command: () => void;
    activeName?: string;
    activeAttrs?: Record<string, unknown>;
    /** Extra classes (e.g. wider width for heading buttons). */
    className?: string;
}

/** Render text-mark icons with appropriate HTML formatting. */
function renderIcon(icon: string): ReactNode {
    switch (icon) {
        case 'B': return <strong className="font-bold">B</strong>;
        case 'I': return <em className="italic">I</em>;
        case 'S̶': return <s>S</s>;
        default: return icon;
    }
}

function TB({ editor, label, icon, command, activeName, activeAttrs, className }: TBProps) {
    const isActive = activeName ? editor.isActive(activeName, activeAttrs) : false;
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            className={
                'h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                (isActive ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] font-bold' : '') +
                (className ? ' ' + className : '')
            }
            onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                command();
            }}
        >
            {renderIcon(icon)}
        </button>
    );
}

function Sep() {
    return <div className="w-px h-5 mx-1 bg-[#e0e0e0] dark:bg-[#3c3c3c]" />;
}

// ── Find & replace panel ─────────────────────────────────────────────────────

/** Shape of `editor.storage.findAndReplace`, as far as the panel needs it. */
interface FindAndReplaceState {
    searchTerm: string;
    caseSensitive: boolean;
    useRegex: boolean;
    wholeWord: boolean;
    results: { from: number; to: number }[];
    currentIndex: number | null;
}

const EMPTY_FIND_STATE: FindAndReplaceState = {
    searchTerm: '',
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
    results: [],
    currentIndex: null,
};

/**
 * Read the find-and-replace extension state off the editor, re-reading on every
 * transaction. The toolbar is not the component that calls `useEditor`, so it
 * does not re-render on transactions by itself — without this subscription the
 * match counter would freeze at whatever it showed on mount.
 *
 * Tolerates an editor without the extension (or a test double without an event
 * emitter) by falling back to empty state.
 */
function useFindAndReplaceState(editor: Editor): FindAndReplaceState {
    const [, bump] = useState(0);

    useEffect(() => {
        if (typeof editor.on !== 'function') return;
        const onTransaction = () => bump((n) => n + 1);
        editor.on('transaction', onTransaction);
        return () => {
            editor.off('transaction', onTransaction);
        };
    }, [editor]);

    const state = (editor.storage as { findAndReplace?: FindAndReplaceState } | undefined)
        ?.findAndReplace;
    return state ?? EMPTY_FIND_STATE;
}

interface FindReplacePanelProps {
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

function FindReplacePanel({ editor, onClose }: FindReplacePanelProps) {
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

/** Current selection as plain text, or '' when the selection is empty/unavailable. */
function getSelectedText(editor: Editor): string {
    const selection = editor.state?.selection;
    if (!selection || selection.empty) return '';
    const text = editor.state.doc.textBetween(selection.from, selection.to, ' ');
    // Multi-line selections are almost never a search term.
    return text.includes('\n') ? '' : text;
}

// ── Shared toolbar dropdown primitive ───────────────────────────────────────

interface ToolbarDropdownTriggerArgs {
    open: boolean;
    /** Open the panel when closed, close it when open. */
    toggle: () => void;
    /**
     * Attach to the button that owns the panel. Escape returns focus here, and
     * the primitive does not set `aria-haspopup`/`aria-expanded` for you — the
     * trigger markup differs too much between dropdowns (plain button vs. the
     * highlight split button) for that to live here.
     */
    triggerRef: RefObject<HTMLButtonElement>;
}

interface ToolbarDropdownProps {
    renderTrigger: (args: ToolbarDropdownTriggerArgs) => ReactNode;
    renderPanel: (args: { close: () => void }) => ReactNode;
    panelTestId: string;
    /** Layout classes for the floating panel; the chrome (border/shadow) is fixed. */
    panelClassName?: string;
    /** Render the panel as an ARIA menu with arrow-key roving focus. */
    menu?: boolean;
    menuLabel?: string;
    /** Runs whenever the panel closes — used to reset transient panel state. */
    onClose?: () => void;
}

const DROPDOWN_PANEL_CLS =
    'absolute top-full left-0 mt-1 z-50 rounded shadow-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]';

/**
 * The one dropdown implementation in this toolbar: it owns open/close state,
 * outside-click and Escape dismissal, and (in `menu` mode) roving arrow-key
 * focus over `role="menuitem"` children. Every toolbar dropdown renders through
 * this so there is a single set of document listeners to reason about.
 */
function ToolbarDropdown({
    renderTrigger,
    renderPanel,
    panelTestId,
    panelClassName,
    menu,
    menuLabel,
    onClose,
}: ToolbarDropdownProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    // Kept in a ref so `close` stays stable across renders even when callers
    // pass an inline callback.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const close = useCallback(() => {
        setOpen(false);
        onCloseRef.current?.();
    }, []);

    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            close();
            triggerRef.current?.focus();
        }
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open, close]);

    function menuItems(): HTMLElement[] {
        if (!panelRef.current) return [];
        return Array.from(panelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    }

    // Opening a menu moves focus into it (starting at the active item) so the
    // arrow keys have somewhere to rove from. Selection survives because the
    // trigger suppressed the mousedown default and the commands re-focus the
    // editor.
    useEffect(() => {
        if (!open || !menu) return;
        const items = menuItems();
        const active = items.find((el) => el.getAttribute('aria-checked') === 'true');
        (active ?? items[0])?.focus();
    }, [open, menu]);

    function handleMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
        const items = menuItems();
        if (items.length === 0) return;
        e.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        let next: number;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
        else next = current <= 0 ? items.length - 1 : current - 1;
        items[next]?.focus();
    }

    return (
        <div className="relative" ref={rootRef}>
            {renderTrigger({
                open,
                toggle: () => (open ? close() : setOpen(true)),
                triggerRef,
            })}
            {open && (
                <div
                    ref={panelRef}
                    className={DROPDOWN_PANEL_CLS + ' ' + (panelClassName ?? 'p-1.5')}
                    data-testid={panelTestId}
                    role={menu ? 'menu' : undefined}
                    aria-label={menu ? menuLabel : undefined}
                    onKeyDown={menu ? handleMenuKeyDown : undefined}
                >
                    {renderPanel({ close })}
                </div>
            )}
        </div>
    );
}

// ── Highlight button with color picker ───────────────────────────────────────

interface HighlightButtonProps {
    editor: Editor;
}

function HighlightButton({ editor }: HighlightButtonProps) {
    const isActive = editor.isActive('highlight');

    return (
        <ToolbarDropdown
            panelTestId="highlight-color-picker"
            panelClassName="flex gap-1 p-1.5"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <div className="flex items-center">
                    {/* Main highlight toggle */}
                    <button
                        type="button"
                        title="Highlight"
                        aria-label="Highlight"
                        className={
                            'h-7 px-1 rounded-l flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                            (isActive ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] font-bold' : '')
                        }
                        onMouseDown={(e) => {
                            e.preventDefault();
                            editor.chain().focus().toggleHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run();
                        }}
                    >
                        <span
                            className="inline-block w-4 h-4 leading-4 text-center rounded-sm text-[10px] font-bold text-[#1e1e1e]"
                            style={{ backgroundColor: isActive ? (editor.getAttributes('highlight').color ?? DEFAULT_HIGHLIGHT_COLOR) : DEFAULT_HIGHLIGHT_COLOR }}
                        >
                            HL
                        </span>
                    </button>
                    {/* Dropdown arrow */}
                    <button
                        ref={triggerRef}
                        type="button"
                        title="Highlight colors"
                        aria-label="Highlight colors"
                        aria-haspopup="true"
                        aria-expanded={open}
                        className="h-7 w-4 rounded-r flex items-center justify-center text-[10px] hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            toggle();
                        }}
                    >
                        ▾
                    </button>
                </div>
            )}
            renderPanel={({ close }) => (
                <>
                    {HIGHLIGHT_COLORS.map(({ name, color }) => (
                        <button
                            key={color}
                            type="button"
                            title={name}
                            aria-label={`Highlight ${name}`}
                            className="w-6 h-6 rounded-sm border border-[#ccc] dark:border-[#555] hover:scale-110 transition-transform"
                            style={{ backgroundColor: color }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                editor.chain().focus().toggleHighlight({ color }).run();
                                close();
                            }}
                        />
                    ))}
                    {/* Remove highlight */}
                    <button
                        type="button"
                        title="Remove highlight"
                        aria-label="Remove highlight"
                        className="w-6 h-6 rounded-sm border border-[#ccc] dark:border-[#555] hover:scale-110 transition-transform flex items-center justify-center text-xs text-[#888]"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            editor.chain().focus().unsetHighlight().run();
                            close();
                        }}
                    >
                        ✕
                    </button>
                </>
            )}
        />
    );
}

// ── Dropdown menu items ─────────────────────────────────────────────────────

interface MenuItemProps {
    /** Marks the item as the current block type — also where focus lands on open. */
    checked: boolean;
    onSelect: () => void;
    testId: string;
    /** Extra classes for the label span (heading items mimic their own weight/size). */
    labelClassName?: string;
    /** Leading glyph column; heading items leave it empty. */
    icon?: string;
    children: ReactNode;
}

/**
 * One row of a toolbar dropdown menu.
 *
 * Activation is `onMouseDown` (with `preventDefault`, so the editor selection
 * survives the click) plus Enter/Space on `keydown`. Deliberately no `onClick`:
 * suppressing the mousedown default does not suppress the following click, so
 * an `onClick` here would run the command a second time.
 */
function MenuItem({ checked, onSelect, testId, labelClassName, icon, children }: MenuItemProps) {
    return (
        <button
            type="button"
            role="menuitem"
            aria-checked={checked}
            tabIndex={-1}
            data-testid={testId}
            className={
                'w-full flex items-center gap-2 px-2 py-1 rounded text-left whitespace-nowrap ' +
                'hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                (checked ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : '')
            }
            onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                onSelect();
            }}
            onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onSelect();
            }}
        >
            <span className="w-3 text-[10px] text-[#0078d4] dark:text-[#4daafc]">{checked ? '✓' : ''}</span>
            {icon !== undefined && <span className="w-4 text-center text-xs">{icon}</span>}
            <span className={labelClassName}>{children}</span>
        </button>
    );
}

// ── Heading dropdown ────────────────────────────────────────────────────────

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** Menu labels are styled roughly at the weight/size of the heading they set. */
const HEADING_ITEM_CLS: Record<number, string> = {
    1: 'text-base font-bold',
    2: 'text-sm font-bold',
    3: 'text-sm font-semibold',
    4: 'text-xs font-semibold',
    5: 'text-xs',
    6: 'text-[11px] font-semibold text-[#666] dark:text-[#999]',
};

interface HeadingDropdownProps {
    editor: Editor;
}

function HeadingDropdown({ editor }: HeadingDropdownProps) {
    const activeLevel = HEADING_LEVELS.find((level) => editor.isActive('heading', { level })) ?? null;

    return (
        <ToolbarDropdown
            menu
            menuLabel="Heading level"
            panelTestId="heading-dropdown-menu"
            panelClassName="p-1 min-w-[9rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Heading level"
                    aria-label="Heading level"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="heading-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (activeLevel || open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] ' : '') +
                        (activeLevel ? 'font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor selection
                        toggle();
                    }}
                >
                    <span data-testid="heading-dropdown-label">{activeLevel ? `H${activeLevel}` : 'H'}</span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    <MenuItem
                        checked={activeLevel === null}
                        testId="heading-item-paragraph"
                        onSelect={() => {
                            editor.chain().focus().setParagraph().run();
                            close();
                        }}
                    >
                        Paragraph
                    </MenuItem>
                    {HEADING_LEVELS.map((level) => (
                        <MenuItem
                            key={level}
                            checked={activeLevel === level}
                            testId={`heading-item-${level}`}
                            labelClassName={HEADING_ITEM_CLS[level]}
                            onSelect={() => {
                                editor.chain().focus().toggleHeading({ level }).run();
                                close();
                            }}
                        >
                            {`Heading ${level}`}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}

// ── List dropdown ───────────────────────────────────────────────────────────

const LIST_TYPES = [
    { name: 'bulletList', label: 'Bullet List', icon: '•', testId: 'list-item-bullet' },
    { name: 'orderedList', label: 'Ordered List', icon: '1.', testId: 'list-item-ordered' },
    { name: 'taskList', label: 'Task List', icon: '☑', testId: 'list-item-task' },
] as const;

interface ListDropdownProps {
    editor: Editor;
}

function ListDropdown({ editor }: ListDropdownProps) {
    const active = LIST_TYPES.find((t) => editor.isActive(t.name)) ?? null;

    function runToggle(name: (typeof LIST_TYPES)[number]['name']) {
        const chain = editor.chain().focus();
        if (name === 'bulletList') chain.toggleBulletList().run();
        else if (name === 'orderedList') chain.toggleOrderedList().run();
        else chain.toggleTaskList().run();
    }

    return (
        <ToolbarDropdown
            menu
            menuLabel="List type"
            panelTestId="list-dropdown-menu"
            panelClassName="p-1 min-w-[9rem]"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Lists"
                    aria-label="Lists"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    data-testid="list-dropdown"
                    className={
                        'h-7 px-1 rounded flex items-center gap-0.5 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (active || open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] ' : '') +
                        (active ? 'font-bold' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor selection
                        toggle();
                    }}
                >
                    <span data-testid="list-dropdown-label">{active ? active.icon : '•'}</span>
                    <span className="text-[10px]">▾</span>
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {LIST_TYPES.map(({ name, label, icon, testId }) => (
                        <MenuItem
                            key={name}
                            checked={active?.name === name}
                            testId={testId}
                            icon={icon}
                            onSelect={() => {
                                runToggle(name);
                                close();
                            }}
                        >
                            {label}
                        </MenuItem>
                    ))}
                </>
            )}
        />
    );
}

// ── Table insert button with hover size picker ──────────────────────────────

/** Fixed picker size — hovering never grows the grid past this. */
export const TABLE_PICKER_COLS = 10;
export const TABLE_PICKER_ROWS = 8;

interface TableInsertButtonProps {
    editor: Editor;
}

function TableInsertButton({ editor }: TableInsertButtonProps) {
    const [hover, setHover] = useState<{ col: number; row: number } | null>(null);

    return (
        <ToolbarDropdown
            panelTestId="table-size-picker"
            // A reopened picker must not still show the previous hover extent.
            onClose={() => setHover(null)}
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Insert table"
                    aria-label="Insert table"
                    aria-haspopup="true"
                    aria-expanded={open}
                    className={
                        'h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor focus
                        toggle();
                    }}
                >
                    ⊞
                </button>
            )}
            renderPanel={({ close }) => (
                <div onMouseLeave={() => setHover(null)}>
                    <div className="flex flex-col gap-0.5">
                        {Array.from({ length: TABLE_PICKER_ROWS }, (_, ri) => ri + 1).map((row) => (
                            <div key={row} className="flex gap-0.5">
                                {Array.from({ length: TABLE_PICKER_COLS }, (_, ci) => ci + 1).map((col) => {
                                    const selected = hover !== null && col <= hover.col && row <= hover.row;
                                    return (
                                        <button
                                            key={col}
                                            type="button"
                                            aria-label={`${col} × ${row} table`}
                                            data-testid={`table-size-cell-${col}-${row}`}
                                            data-selected={selected ? 'true' : 'false'}
                                            className={
                                                'w-4 h-4 rounded-sm border ' +
                                                (selected
                                                    ? 'border-[#0078d4] bg-[#cce4f7] dark:bg-[#0e639c]'
                                                    : 'border-[#ccc] dark:border-[#555]')
                                            }
                                            onMouseEnter={() => setHover({ col, row })}
                                            onMouseDown={(e) => {
                                                e.preventDefault(); // keep editor focus
                                                editor.chain().focus()
                                                    .insertTable({ rows: row, cols: col, withHeaderRow: true })
                                                    .run();
                                                close();
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <div
                        className="mt-1 text-center text-[10px] text-[#666] dark:text-[#999]"
                        data-testid="table-size-label"
                    >
                        {hover ? `${hover.col} × ${hover.row}` : 'Insert table'}
                    </div>
                </div>
            )}
        />
    );
}

// ── Table contextual controls ───────────────────────────────────────────────

interface TableControlsProps {
    editor: Editor;
}

function TableControls({ editor }: TableControlsProps) {
    if (!editor.isActive('table')) return null;

    const tc = () => editor.chain().focus();
    // Recomputed on every toolbar render, which a selection or doc change
    // already triggers — so the button enables the moment a border is dragged.
    const hasWidths = activeTableHasColumnWidths(editor);
    const btnCls = "h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]";

    return (
        <div
            className="flex items-center gap-0.5 px-2 py-0.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
            data-testid="table-controls-row"
        >
            {/* Column operations */}
            <button type="button" title="Add column before" aria-label="Add column before"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnBefore().run(); }}>
                Add Col ←
            </button>
            <button type="button" title="Add column after" aria-label="Add column after"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnAfter().run(); }}>
                Add Col →
            </button>
            <button type="button" title="Delete column" aria-label="Delete column"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteColumn().run(); }}>
                Del Col
            </button>
            <Sep />
            {/* Row operations */}
            <button type="button" title="Add row before" aria-label="Add row before"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addRowBefore().run(); }}>
                Add Row ↑
            </button>
            <button type="button" title="Add row after" aria-label="Add row after"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addRowAfter().run(); }}>
                Add Row ↓
            </button>
            <button type="button" title="Delete row" aria-label="Delete row"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteRow().run(); }}>
                Del Row
            </button>
            <Sep />
            {/* Table-level */}
            <button type="button" title="Reset column widths" aria-label="Reset column widths"
                disabled={!hasWidths}
                className={btnCls + ' disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (!hasWidths) return;
                    clearActiveTableColumnWidths(editor);
                }}>
                Reset Widths
            </button>
            <button type="button" title="Delete table" aria-label="Delete table"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteTable().run(); }}>
                Del Table
            </button>
        </div>
    );
}

// ── Main toolbar ────────────────────────────────────────────────────────────

export function NoteEditorToolbar({ editor, hidden, commentsPanelOpen, onToggleCommentsPanel, commentCount, modeToggle, aiEditCount, aiEditsVisible, onDismissAiEdits, onToggleAiEdits, toolbarRight, onRefresh, refreshing, chatPanelOpen, onToggleChatPanel, chatDisabledReason, hasExistingChat, tocOpen, onToggleToc, tocEntries = [], tocActiveIndex = null, onTocJump, onInsertPdf }: NoteEditorToolbarProps) {
    const tocRef = useRef<HTMLDivElement>(null);
    const [findOpen, setFindOpen] = useState(false);

    /**
     * Closing the panel clears the search term, so a stale set of match outlines
     * cannot survive on the document with no visible way to dismiss them.
     */
    const closeFind = useCallback(() => {
        setFindOpen(false);
        editor?.commands?.clearSearch?.();
    }, [editor]);

    // Source mode swaps in a separate raw-markdown editor that the extension does
    // not reach, so the panel is force-closed rather than left floating over a
    // document it can no longer search.
    useEffect(() => {
        if (hidden) closeFind();
    }, [hidden, closeFind]);

    if (!editor) return null;

    const hasHeadings = tocEntries.length > 0;
    const c = () => editor.chain().focus();

    function handleLink() {
        if (editor!.isActive('link')) {
            editor!.chain().focus().unsetLink().run();
            return;
        }
        const href = prompt('Enter URL:');
        if (href) {
            editor!.chain().focus().setLink({ href }).run();
        }
    }

    return (
        <>
        <div
            className="flex items-center gap-0.5 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-wrap text-[#1e1e1e] dark:text-[#cccccc]"
            role="toolbar"
            aria-label="Formatting toolbar"
            data-testid="note-editor-toolbar"
        >
            {/* Mode toggle — leftmost, always visible */}
            {modeToggle && (
                <>
                    {modeToggle}
                    {!hidden && <Sep />}
                </>
            )}

            {/* Formatting buttons — hidden in source mode */}
            {!hidden && (
                <>
                    {/* Text formatting */}
                    <TB editor={editor} label="Bold" icon="B" command={() => c().toggleBold().run()} activeName="bold" />
                    <TB editor={editor} label="Italic" icon="I" command={() => c().toggleItalic().run()} activeName="italic" />
                    <TB editor={editor} label="Strikethrough" icon="S̶" command={() => c().toggleStrike().run()} activeName="strike" />
                    <HighlightButton editor={editor} />
                    <Sep />

                    {/* Headings */}
                    <HeadingDropdown editor={editor} />
                    <Sep />

                    {/* Lists */}
                    <ListDropdown editor={editor} />
                    <Sep />

                    {/* Block elements */}
                    <TB editor={editor} label="Blockquote" icon="❝" command={() => c().toggleBlockquote().run()} activeName="blockquote" />
                    <TB editor={editor} label="Code" icon="<>" command={() => c().toggleCode().run()} activeName="code" />
                    <TB editor={editor} label="Code block" icon="⌘" command={() => c().toggleCodeBlock().run()} activeName="codeBlock" />
                    <Sep />

                    {/* Misc */}
                    <TB editor={editor} label="Link" icon="🔗" command={handleLink} activeName="link" />
                    <TB editor={editor} label="Horizontal rule" icon="—" command={() => c().setHorizontalRule().run()} />

                    {/* Table — insert */}
                    <Sep />
                    <TableInsertButton editor={editor} />
                    {onInsertPdf && (
                        <button
                            type="button"
                            title="Insert PDF"
                            aria-label="Insert PDF"
                            data-testid="insert-pdf-btn"
                            className="h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                            onMouseDown={(e) => {
                                e.preventDefault(); // keep editor focus
                                onInsertPdf();
                            }}
                        >
                            📄
                        </button>
                    )}

                    {/* Alignment */}
                    <Sep />
                    <TB editor={editor} label="Align left"    icon="⫷" command={() => c().setTextAlign('left').run()}    activeName="textStyle" activeAttrs={{ textAlign: 'left' }} />
                    <TB editor={editor} label="Align center"  icon="≡" command={() => c().setTextAlign('center').run()}  activeName="textStyle" activeAttrs={{ textAlign: 'center' }} />
                    <TB editor={editor} label="Align right"   icon="⫸" command={() => c().setTextAlign('right').run()}   activeName="textStyle" activeAttrs={{ textAlign: 'right' }} />
                    <TB editor={editor} label="Justify"       icon="☰" command={() => c().setTextAlign('justify').run()} activeName="textStyle" activeAttrs={{ textAlign: 'justify' }} />

                    {/* Indent */}
                    <Sep />
                    <TB editor={editor} label="Increase indent" icon="→|" command={() => editor.chain().focus().increaseIndent().run()} />
                    <TB editor={editor} label="Decrease indent" icon="|←" command={() => editor.chain().focus().decreaseIndent().run()} />

                    {/* Find & replace — part of the formatting group, so it is
                        hidden in source mode along with the rest (the raw-markdown
                        editor is a different editor instance the extension does
                        not reach). */}
                    <Sep />
                    <TB
                        editor={editor}
                        label="Find and replace"
                        icon="🔍"
                        // Toggling off goes through closeFind so the search is
                        // cleared, same as the panel's ✕ and Esc.
                        command={() => (findOpen ? closeFind() : setFindOpen(true))}
                        className={findOpen ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : ''}
                    />
                </>
            )}

            {/* Right-end controls — always visible */}
            {(onToggleCommentsPanel || toolbarRight || onRefresh || onToggleChatPanel || chatDisabledReason || onToggleToc || (aiEditCount ?? 0) > 0) && (
                <>
                    <div className="ml-auto" />
                    {(aiEditCount ?? 0) > 0 && onToggleAiEdits && (
                        <button
                            type="button"
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (aiEditsVisible
                                    ? 'bg-[#e8f5e9] dark:bg-[#1b3a1b] text-green-700 dark:text-green-300'
                                    : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={onToggleAiEdits}
                            title={aiEditsVisible ? 'Hide AI changes' : 'Show AI changes'}
                            data-testid="ai-edits-toggle"
                        >
                            ✦ {aiEditCount}
                        </button>
                    )}
                    {onToggleCommentsPanel && (
                        <button
                            type="button"
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (commentsPanelOpen
                                    ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                    : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={onToggleCommentsPanel}
                            data-testid="comments-panel-toggle"
                            aria-label={commentsPanelOpen ? 'Hide comments' : 'Show comments'}
                        >
                            💬{(commentCount ?? 0) > 0 && (
                                <span className="ml-1 text-[10px]" data-testid="comments-toggle-count">
                                    {commentCount}
                                </span>
                            )}
                        </button>
                    )}
                    {(onToggleChatPanel || chatDisabledReason) && (
                        <button
                            type="button"
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (chatDisabledReason
                                    ? 'text-[#8c959f] dark:text-[#555] cursor-not-allowed'
                                    : chatPanelOpen
                                    ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                    : hasExistingChat
                                        ? 'text-[#0078d4] dark:text-[#3794ff] hover:bg-[#e0eef9] dark:hover:bg-[#1a3a5c]'
                                        : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={onToggleChatPanel}
                            disabled={Boolean(chatDisabledReason)}
                            data-testid="chat-panel-toggle"
                            aria-label={chatDisabledReason ?? (chatPanelOpen ? 'Hide AI chat' : hasExistingChat ? 'Continue AI chat' : 'Show AI chat')}
                            title={chatDisabledReason ?? (chatPanelOpen ? 'Hide AI chat' : hasExistingChat ? 'Continue AI chat' : 'Show AI chat')}
                        >
                            🤖
                        </button>
                    )}
                    {onToggleToc && (
                        <div className="relative" ref={tocRef}>
                            <button
                                type="button"
                                title={hasHeadings ? 'Table of contents' : 'No headings in this note'}
                                aria-label="Table of contents"
                                disabled={!hasHeadings}
                                className={
                                    'text-xs px-2 py-0.5 rounded ' +
                                    (tocOpen && hasHeadings
                                        ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                        : !hasHeadings
                                            ? 'opacity-40 cursor-not-allowed text-[#888]'
                                            : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                                }
                                onClick={onToggleToc}
                                data-testid="toc-toggle-btn"
                            >
                                ≡
                            </button>
                            {tocOpen && hasHeadings && onTocJump && (
                                <NoteTocPanel
                                    entries={tocEntries}
                                    activeIndex={tocActiveIndex}
                                    onJump={onTocJump}
                                    onClose={onToggleToc}
                                />
                            )}
                        </div>
                    )}
                    {onRefresh && (
                        <button
                            type="button"
                            className="text-xs px-2 py-0.5 rounded text-[#888] hover:text-[#333] dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={onRefresh}
                            disabled={refreshing}
                            aria-label="Refresh"
                            title="Refresh (Ctrl+Shift+R)"
                            data-testid="note-editor-refresh-btn"
                        >
                            ↻
                        </button>
                    )}
                    {toolbarRight}
                </>
            )}
        </div>
        {/* Find & replace — secondary row, shown while the panel is toggled on */}
        {!hidden && findOpen && <FindReplacePanel editor={editor} onClose={closeFind} />}
        {/* Table controls — secondary row, visible only when inside a table */}
        {!hidden && <TableControls editor={editor} />}
        </>
    );
}
