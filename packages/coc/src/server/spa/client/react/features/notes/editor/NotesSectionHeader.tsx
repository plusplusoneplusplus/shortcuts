import { useEffect, useRef, useState, type ReactNode } from 'react';

/** One entry in a section header's overflow (⋯) menu. */
export interface NotesSectionHeaderAction {
    /** Stable id — also used to build the action's `data-testid`. */
    id: string;
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    /** Renders the item in the destructive (red) style. */
    danger?: boolean;
    /** Tooltip, typically the reason a disabled action is unavailable. */
    title?: string;
}

export interface NotesSectionHeaderProps {
    /** Section title — a notes root's label, or "Recents". */
    label: string;
    expanded: boolean;
    onToggle: () => void;
    /** Muted page count rendered after the label. Omit to hide. */
    count?: number;
    /** Marks the section as the default managed root (📓 vs 📁). */
    isDefault?: boolean;
    /** Section cannot be removed — renders a 🔒 affordance. */
    isProtected?: boolean;
    /** Tooltip explaining why the section is protected. */
    protectedReason?: string;
    /** Overflow menu entries. When empty/omitted the ⋯ button is not rendered. */
    actions?: NotesSectionHeaderAction[];
    /** Base `data-testid`; child testids are derived from it. */
    testId?: string;
    /** Optional leading glyph override. Falls back to the root icons. */
    icon?: ReactNode;
}

/**
 * Sticky, collapsible header for one notes sidebar section.
 *
 * Sections stack inside a single shared scroll container, so the header pins
 * itself to the top of that container while its own body is in view.
 */
export function NotesSectionHeader({
    label,
    expanded,
    onToggle,
    count,
    isDefault,
    isProtected,
    protectedReason,
    actions,
    testId = 'notes-section-header',
    icon,
}: NotesSectionHeaderProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const hasActions = Boolean(actions && actions.length > 0);

    useEffect(() => {
        if (!menuOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setMenuOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuOpen]);

    return (
        <div
            className="sticky top-0 z-10 flex items-center gap-1 px-2 py-1 bg-[#f6f8fa] dark:bg-[#252526] border-b border-[#eaeef2] dark:border-[#3c3c3c]"
            data-testid={testId}
            data-expanded={expanded ? 'true' : 'false'}
        >
            <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-1 text-left text-[12px] font-semibold uppercase tracking-wide text-[#656d76] dark:text-[#9d9d9d] hover:text-[#1f2328] dark:hover:text-[#cccccc] rounded px-0.5 py-0.5"
                onClick={onToggle}
                aria-expanded={expanded}
                data-testid={`${testId}-toggle`}
                title={label}
            >
                <svg
                    className={`w-3 h-3 flex-shrink-0 opacity-70 transition-transform ${expanded ? '' : '-rotate-90'}`}
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M4 6l4 4 4-4" />
                </svg>
                <span aria-hidden="true">{icon ?? (isDefault ? '📓' : '📁')}</span>
                <span className="truncate normal-case">{label}</span>
                {typeof count === 'number' && (
                    <span
                        className="flex-shrink-0 font-normal text-[11px] text-[#8c959f] dark:text-[#777]"
                        data-testid={`${testId}-count`}
                    >
                        {count}
                    </span>
                )}
            </button>
            {isProtected && (
                <span
                    className="flex-shrink-0 text-[11px]"
                    data-testid={`${testId}-protected`}
                    title={protectedReason ?? 'Protected root'}
                    aria-label="Protected root"
                >
                    🔒
                </span>
            )}
            {hasActions && (
                <div className="relative flex-shrink-0" ref={menuRef}>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center w-5 h-5 rounded text-[#656d76] dark:text-[#9d9d9d] hover:bg-[#eaeef2] dark:hover:bg-[#2a2d2e]"
                        onClick={() => setMenuOpen(prev => !prev)}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-label={`${label} section options`}
                        title="Section options"
                        data-testid={`${testId}-menu-btn`}
                    >
                        <span aria-hidden="true" className="leading-none">⋯</span>
                    </button>
                    {menuOpen && (
                        <div
                            className="absolute right-0 top-full mt-1 z-30 min-w-[180px] bg-white dark:bg-[#252526] border border-[#d0d7de] dark:border-[#3c3c3c] rounded-md shadow-[0_8px_24px_rgba(140,149,159,0.2)] py-1"
                            role="menu"
                            data-testid={`${testId}-menu`}
                        >
                            {actions!.map(action => (
                                <button
                                    key={action.id}
                                    type="button"
                                    role="menuitem"
                                    className={`w-full text-left px-3 py-1.5 text-xs normal-case disabled:opacity-50 disabled:cursor-not-allowed ${
                                        action.danger
                                            ? 'text-[#cf222e] dark:text-[#ff7b72] hover:bg-[#ffebe9] dark:hover:bg-[#3c1f1f]'
                                            : 'text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e]'
                                    }`}
                                    disabled={action.disabled}
                                    title={action.title}
                                    onClick={() => {
                                        setMenuOpen(false);
                                        action.onSelect();
                                    }}
                                    data-testid={`${testId}-action-${action.id}`}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
