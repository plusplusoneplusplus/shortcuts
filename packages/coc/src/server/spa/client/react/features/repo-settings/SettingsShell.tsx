/**
 * SettingsShell — the pieces settings surfaces share.
 *
 * Real repo settings and repo-group settings use the same split-panel layout:
 * a filterable grouped sidebar on the left and a card-based content surface on
 * the right. Callers can use the whole shell or compose the exported sidebar,
 * section header, badges, and card primitive directly.
 */

import React, { useMemo, useState } from 'react';
import type { SettingsSection } from '../../types/dashboard';

export interface SettingsNavItem<SectionId extends SettingsSection = SettingsSection> {
    id: SectionId;
    label: string;
    title: string;
    description: string;
}

export interface SettingsNavGroup<SectionId extends SettingsSection = SettingsSection> {
    /** Stable id, used for the `nav-group-<id>` test id. */
    id: string;
    label?: string;
    items: SettingsNavItem<SectionId>[];
}

export type SettingsShellNavItem<SectionId extends SettingsSection = SettingsSection> = SettingsNavItem<SectionId>;
export type SettingsShellNavGroup<SectionId extends SettingsSection = SettingsSection> = SettingsNavGroup<SectionId>;

export interface SettingsShellProps<SectionId extends SettingsSection = SettingsSection> {
    groups: SettingsNavGroup<SectionId>[];
    activeSectionId: SectionId;
    onSelect: (id: SectionId) => void;
    renderIcon?: (id: SectionId) => React.ReactNode;
    renderBadge?: (id: SectionId) => React.ReactNode;
    footer?: React.ReactNode;
    suppressSectionHeader?: boolean;
    headerActions?: React.ReactNode;
    children: React.ReactNode;
}

export function SettingsSectionIcon({
    id,
    className = 'h-3.5 w-3.5',
}: {
    id: SettingsSection;
    className?: string;
}) {
    const stroke = 'currentColor';
    const common = {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke,
        strokeWidth: 1.7,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        className,
        'aria-hidden': true,
    };
    switch (id) {
        case 'info':
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5" />
                    <circle cx="12" cy="8" r="0.6" fill={stroke} stroke="none" />
                </svg>
            );
        case 'preferences':
            return (
                <svg {...common}>
                    <path d="M4 7h10" />
                    <path d="M18 7h2" />
                    <circle cx="16" cy="7" r="2" />
                    <path d="M4 17h2" />
                    <path d="M10 17h10" />
                    <circle cx="8" cy="17" r="2" />
                </svg>
            );
        case 'tasks':
            return (
                <svg {...common}>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
            );
        case 'notes':
            return (
                <svg {...common}>
                    <path d="M4 20h4l11-11-4-4L4 16z" />
                    <path d="M14 6l4 4" />
                </svg>
            );
        case 'members':
            return (
                <svg {...common}>
                    <circle cx="9" cy="9" r="3" />
                    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
                    <path d="M16 6.2a3 3 0 0 1 0 5.6" />
                    <path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
                </svg>
            );
        case 'mcp':
            return (
                <svg {...common}>
                    <rect x="3" y="5" width="18" height="10" rx="1.5" />
                    <path d="M8 19h8" />
                    <path d="M12 15v4" />
                </svg>
            );
        case 'skills':
            return (
                <svg {...common}>
                    <path d="M12 3l8 4-8 4-8-4z" />
                    <path d="M4 11l8 4 8-4" />
                    <path d="M4 15l8 4 8-4" />
                </svg>
            );
        case 'llm-tools':
            return (
                <svg {...common}>
                    <path d="M14.7 6.3a4 4 0 0 1 5 5l-2.5 2.5-3.5-3.5z" />
                    <path d="M13 9l-9 9v3h3l9-9" />
                </svg>
            );
        case 'instructions':
            return (
                <svg {...common}>
                    <path d="M6 3h9l4 4v14H6z" />
                    <path d="M14 3v5h5" />
                    <path d="M9 13h6" />
                    <path d="M9 17h4" />
                </svg>
            );
        case 'memory':
            return (
                <svg {...common}>
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                    <path d="M9 5V3M15 5V3M9 21v-2M15 21v-2M5 9H3M5 15H3M21 9h-2M21 15h-2" />
                </svg>
            );
        default:
            return null;
    }
}

export function SettingsSearchIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-3.5-3.5" />
        </svg>
    );
}

export function SectionCard({
    label,
    right,
    children,
    className = '',
    testId,
}: {
    label?: string;
    right?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}) {
    return (
        <section
            data-testid={testId}
            className={`rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] ${className}`}
        >
            {(label || right) && (
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    {label && (
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6e7781] dark:text-[#8b949e]">
                            {label}
                        </span>
                    )}
                    {right}
                </div>
            )}
            <div className="px-4 pb-4">{children}</div>
        </section>
    );
}

export function SettingsNavCountBadge({ count }: { count: number }) {
    return (
        <span className="ml-auto text-[10px] font-mono px-1.5 py-px rounded text-[#6e7781] dark:text-[#8b949e] bg-[#eaeef2] dark:bg-[#2d2d30]">
            {count}
        </span>
    );
}

export function SettingsNavDotBadge({ label }: { label: string }) {
    return <span className="ml-auto inline-block w-1.5 h-1.5 rounded-full bg-[#0969da] dark:bg-[#3794ff]" aria-label={label} />;
}

export interface SettingsNavSidebarProps<SectionId extends SettingsSection = SettingsSection> {
    groups: SettingsNavGroup<SectionId>[];
    activeSection: SectionId;
    onSelect: (section: SectionId) => void;
    renderIcon?: (id: SectionId) => React.ReactNode;
    renderBadge?: (id: SectionId) => React.ReactNode;
    footer?: React.ReactNode;
}

export function SettingsNavSidebar<SectionId extends SettingsSection = SettingsSection>({
    groups,
    activeSection,
    onSelect,
    renderIcon,
    renderBadge,
    footer,
}: SettingsNavSidebarProps<SectionId>) {
    const [filterQuery, setFilterQuery] = useState('');
    const normalizedQuery = filterQuery.trim().toLowerCase();
    const itemCount = groups.reduce((count, group) => count + group.items.length, 0);
    const showFilter = itemCount > 1;

    const filteredGroups = useMemo<SettingsNavGroup<SectionId>[]>(() => {
        if (!normalizedQuery) {
            return groups;
        }
        return groups
            .map(group => ({
                ...group,
                items: group.items.filter(item =>
                    item.label.toLowerCase().includes(normalizedQuery)
                    || item.title.toLowerCase().includes(normalizedQuery)
                ),
            }))
            .filter(group => group.items.length > 0);
    }, [groups, normalizedQuery]);

    return (
        <nav
            className="flex-shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-[#e0e0e0] dark:border-[#2d2d30] bg-[var(--vscode-sideBar-background,#fafbfc)] dark:bg-[#1c1c1c] sm:w-[210px]"
            data-testid="settings-sidebar"
        >
            {showFilter && (
                <div className="px-3 pt-3 pb-2 sticky top-0 z-10 bg-inherit">
                    <label className="flex items-center gap-1.5 h-7 rounded-md border border-[#d8dee4] dark:border-[#2d2d30] bg-white dark:bg-[#252526] px-2 focus-within:border-[#0969da] dark:focus-within:border-[#3794ff]">
                        <SettingsSearchIcon className="h-3 w-3 text-[#6e7781] dark:text-[#8b949e]" />
                        <input
                            type="search"
                            value={filterQuery}
                            onChange={event => setFilterQuery(event.target.value)}
                            placeholder="Filter settings"
                            className="flex-1 min-w-0 bg-transparent text-[12px] text-[#1f2328] dark:text-[#e6edf3] placeholder:text-[#6e7781] dark:placeholder:text-[#8b949e] outline-none"
                            data-testid="settings-filter-input"
                        />
                        <kbd
                            className="hidden sm:inline-flex items-center justify-center h-[18px] px-1 rounded text-[10px] font-mono text-[#6e7781] dark:text-[#8b949e] bg-[#eaeef2] dark:bg-[#2d2d30] border border-[#d8dee4] dark:border-[#3c3c3c] select-none"
                            aria-hidden
                        >
                            ⌘K
                        </kbd>
                    </label>
                </div>
            )}

            <div className="sm:flex-1 sm:min-h-0 sm:overflow-y-auto">
                <div className={`px-1.5 pb-3 flex flex-col gap-3 ${showFilter ? '' : 'pt-3'}`}>
                    {filteredGroups.length === 0 ? (
                        <div className="px-2.5 py-3 text-[11px] text-[#6e7781] dark:text-[#8b949e]" data-testid="settings-filter-empty">
                            No settings match “{filterQuery.trim()}”.
                        </div>
                    ) : (
                        filteredGroups.map(group => (
                            <div key={group.id} className="flex flex-col" data-testid={`nav-group-${group.id}`}>
                                {group.label && (
                                    <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6e7781] dark:text-[#8b949e]">
                                        {group.label}
                                    </div>
                                )}
                                {group.items.map(item => {
                                    const isActive = activeSection === item.id;
                                    const icon = renderIcon ? renderIcon(item.id) : <SettingsSectionIcon id={item.id} />;
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => onSelect(item.id)}
                                            className={`group flex items-center gap-2 h-7 px-2.5 rounded-md text-[12.5px] text-left transition-colors whitespace-nowrap ${
                                                isActive
                                                    ? 'bg-white dark:bg-[#252526] text-[#1f2328] dark:text-[#e6edf3] border border-[#d8dee4] dark:border-[#3c3c3c] font-semibold shadow-[0_1px_0_rgba(31,35,40,0.04)]'
                                                    : 'border border-transparent text-[#1f2328] dark:text-[#c9d1d9] hover:bg-[#eef1f4] dark:hover:bg-[#252526]'
                                            }`}
                                            data-testid={`nav-item-${item.id}`}
                                            aria-current={isActive ? 'page' : undefined}
                                        >
                                            {icon && (
                                                <span className={`flex-shrink-0 ${isActive ? 'text-[#1f2328] dark:text-[#e6edf3]' : 'text-[#6e7781] dark:text-[#8b949e]'}`}>
                                                    {icon}
                                                </span>
                                            )}
                                            <span className="flex-1 truncate">{item.label}</span>
                                            {renderBadge?.(item.id)}
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
            </div>
            {footer}
        </nav>
    );
}

export function SettingsSectionHeader({
    title,
    description,
    actions,
}: {
    title: string;
    description: string;
    actions?: React.ReactNode;
}) {
    return (
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
            <div className="min-w-0">
                <h2 className="text-[18px] font-semibold leading-tight text-[#1f2328] dark:text-[#e6edf3]" data-testid="settings-section-title">
                    {title}
                </h2>
                <p className="mt-0.5 text-[12.5px] text-[#6e7781] dark:text-[#8b949e]" data-testid="settings-section-description">
                    {description}
                </p>
            </div>
            {actions}
        </header>
    );
}

export function SettingsShell<SectionId extends SettingsSection = SettingsSection>({
    groups,
    activeSectionId,
    onSelect,
    renderIcon,
    renderBadge,
    footer,
    suppressSectionHeader = false,
    headerActions,
    children,
}: SettingsShellProps<SectionId>) {
    const activeNav = useMemo(() => {
        for (const group of groups) {
            const item = group.items.find(candidate => candidate.id === activeSectionId);
            if (item) {
                return item;
            }
        }
        return groups[0]?.items[0];
    }, [activeSectionId, groups]);

    return (
        <div className="flex flex-col sm:flex-row h-full overflow-hidden bg-[var(--vscode-editor-background,#fff)] dark:bg-[#191919]">
            <SettingsNavSidebar
                groups={groups}
                activeSection={activeSectionId}
                onSelect={onSelect}
                renderIcon={renderIcon}
                renderBadge={renderBadge}
                footer={footer}
            />

            <div className="flex-1 overflow-y-auto min-w-0" data-testid="settings-content-panel">
                {!suppressSectionHeader && activeNav && (
                    <SettingsSectionHeader
                        title={activeNav.title}
                        description={activeNav.description}
                        actions={headerActions}
                    />
                )}

                <div className={suppressSectionHeader ? '' : 'px-6 pb-8 flex flex-col gap-4'}>
                    {children}
                </div>
            </div>
        </div>
    );
}
