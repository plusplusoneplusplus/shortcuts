import React, { useMemo, useState } from 'react';

export interface SettingsShellNavItem<SectionId extends string> {
    id: SectionId;
    label: string;
    title: string;
    description: string;
}

export interface SettingsShellNavGroup<SectionId extends string> {
    id: string;
    label?: string;
    items: SettingsShellNavItem<SectionId>[];
}

interface SettingsShellProps<SectionId extends string> {
    groups: SettingsShellNavGroup<SectionId>[];
    activeSectionId: SectionId;
    onSelect: (id: SectionId) => void;
    renderIcon?: (id: SectionId) => React.ReactNode;
    renderBadge?: (id: SectionId) => React.ReactNode;
    footer?: React.ReactNode;
    suppressSectionHeader?: boolean;
    headerActions?: React.ReactNode;
    children: React.ReactNode;
}

function SearchIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-3.5-3.5" />
        </svg>
    );
}

export function SettingsShell<SectionId extends string>({
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
    const [filterQuery, setFilterQuery] = useState('');
    const normalizedQuery = filterQuery.trim().toLowerCase();
    const itemCount = groups.reduce((count, group) => count + group.items.length, 0);
    const showFilter = itemCount > 1;

    const filteredGroups = useMemo<SettingsShellNavGroup<SectionId>[]>(() => {
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
            <nav
                className="flex-shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-[#e0e0e0] dark:border-[#2d2d30] bg-[var(--vscode-sideBar-background,#fafbfc)] dark:bg-[#1c1c1c] sm:w-[210px]"
                data-testid="settings-sidebar"
            >
                {showFilter && (
                    <div className="px-3 pt-3 pb-2 sticky top-0 z-10 bg-inherit">
                        <label className="flex items-center gap-1.5 h-7 rounded-md border border-[#d8dee4] dark:border-[#2d2d30] bg-white dark:bg-[#252526] px-2 focus-within:border-[#0969da] dark:focus-within:border-[#3794ff]">
                            <SearchIcon className="h-3 w-3 text-[#6e7781] dark:text-[#8b949e]" />
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
                    <div className="px-1.5 pb-3 flex flex-col gap-3">
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
                                        const isActive = activeSectionId === item.id;
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
                                                {renderIcon && (
                                                    <span className={`flex-shrink-0 ${isActive ? 'text-[#1f2328] dark:text-[#e6edf3]' : 'text-[#6e7781] dark:text-[#8b949e]'}`}>
                                                        {renderIcon(item.id)}
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

            <div className="flex-1 overflow-y-auto min-w-0" data-testid="settings-content-panel">
                {!suppressSectionHeader && activeNav && (
                    <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
                        <div className="min-w-0">
                            <h2 className="text-[18px] font-semibold leading-tight text-[#1f2328] dark:text-[#e6edf3]" data-testid="settings-section-title">
                                {activeNav.title}
                            </h2>
                            <p className="mt-0.5 text-[12.5px] text-[#6e7781] dark:text-[#8b949e]" data-testid="settings-section-description">
                                {activeNav.description}
                            </p>
                        </div>
                        {headerActions}
                    </header>
                )}

                <div className={suppressSectionHeader ? '' : 'px-6 pb-8 flex flex-col gap-4'}>
                    {children}
                </div>
            </div>
        </div>
    );
}
