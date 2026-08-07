/**
 * SkillPicker — Searchable skill picker popover with repo/global grouping.
 * Replaces the flat pill grid with a compact trigger + floating popover pattern.
 *
 * The search box + grouped list is split out as `SkillPickerPanel` so other
 * surfaces (e.g. the Git tab's "Browse all skills…" modal) can reuse it
 * without the trigger button and selected-chip row.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

interface SkillOption { name: string; description?: string; source?: string; }

export type { SkillOption };

interface SkillPickerProps {
    skills: SkillOption[];
    selectedSkills: string[];
    onSkillChange: (name: string) => void;
    /** Custom label text. Pass empty string to hide. Default: "Skills (optional)". */
    label?: string;
}

export interface SkillPickerPanelProps {
    skills: SkillOption[];
    /** Names rendered with a checkmark. Pass [] for single-select surfaces. */
    selectedSkills: string[];
    onSelect: (name: string) => void;
    /** Called when the user presses Escape. */
    onDismiss?: () => void;
    /** Tailwind height cap for the scrollable list. Default: "max-h-64". */
    listHeightClass?: string;
}

const ENDEV_XDPU_SKILL_NAME = 'EnDev-xDpu';

/**
 * Search box + repo/global grouped, keyboard-navigable skill list.
 * Autofocuses its search input on mount.
 */
export function SkillPickerPanel({
    skills,
    selectedSkills,
    onSelect,
    onDismiss,
    listHeightClass = 'max-h-64',
}: SkillPickerPanelProps) {
    const [search, setSearch] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Group skills by source (repo vs global)
    const { repoSkills, globalSkills } = useMemo(() => {
        const repo: SkillOption[] = [];
        const global: SkillOption[] = [];
        for (const s of skills) {
            const source = (s as any).source;
            if (source === 'custom' || source === 'global') {
                global.push({ ...s, source });
            } else {
                repo.push({ ...s, source });
            }
        }
        return { repoSkills: repo, globalSkills: global };
    }, [skills]);

    // Filter skills by search query
    const filterSkills = useCallback((list: SkillOption[]) => {
        if (!search.trim()) return list;
        const q = search.trim().toLowerCase();
        return list.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.description && s.description.toLowerCase().includes(q))
        );
    }, [search]);

    const filteredRepo = useMemo(() => filterSkills(repoSkills), [filterSkills, repoSkills]);
    const filteredGlobal = useMemo(() => filterSkills(globalSkills), [filterSkills, globalSkills]);
    const flatFiltered = useMemo(() => [...filteredRepo, ...filteredGlobal], [filteredRepo, filteredGlobal]);

    // Reset highlight when search changes
    useEffect(() => {
        setHighlightIndex(0);
    }, [search]);

    // Focus search input on mount
    useEffect(() => {
        requestAnimationFrame(() => searchRef.current?.focus());
    }, []);

    // Scroll highlighted item into view
    useEffect(() => {
        if (!listRef.current) return;
        const items = listRef.current.querySelectorAll('[data-skill-item]');
        items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onDismiss?.();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(prev => Math.min(prev + 1, flatFiltered.length - 1));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => Math.max(prev - 1, 0));
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            if (e.key === ' ' && search.length > 0) return; // Allow space in search
            e.preventDefault();
            const skill = flatFiltered[highlightIndex];
            if (skill) onSelect(skill.name);
        }
    }, [flatFiltered, highlightIndex, onSelect, onDismiss, search]);

    const noResults = flatFiltered.length === 0 && search.trim().length > 0;

    const renderSkillRow = (skill: SkillOption, index: number) => {
        const isSelected = selectedSkills.includes(skill.name);
        const isHighlighted = index === highlightIndex;
        return (
            <button
                key={skill.name}
                type="button"
                data-skill-item
                data-testid={`skill-picker-item-${skill.name}`}
                onClick={() => onSelect(skill.name)}
                onMouseEnter={() => setHighlightIndex(index)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors cursor-pointer ${
                    isHighlighted
                        ? 'bg-[#e8e8e8] dark:bg-[#4a4a4a]'
                        : 'hover:bg-[#f0f0f0] dark:hover:bg-[#3c3c3c]'
                }`}
            >
                <span className="flex-shrink-0">⚡</span>
                <span className="flex-1 min-w-0">
                    <span className={`font-medium ${isSelected ? 'text-[#0078d4]' : ''}`} title={skill.name}>
                        {skill.name}
                    </span>
                    {skill.description && (
                        <span className="block text-[10px] text-[#848484] truncate" title={skill.description}>
                            {skill.description}
                        </span>
                    )}
                </span>
                {isSelected && <span className="flex-shrink-0 text-[#0078d4]" data-testid={`skill-picker-check-${skill.name}`}>✓</span>}
            </button>
        );
    };

    // Compute the flat index offset for global skills
    const globalOffset = filteredRepo.length;

    return (
        <>
            {/* Search input */}
            <div className="p-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="🔍 Search skills…"
                    className="w-full px-2 py-1 text-xs rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    data-testid="skill-picker-search"
                />
            </div>

            {/* Skill list */}
            <div ref={listRef} className={`${listHeightClass} overflow-y-auto`} data-testid="skill-picker-list">
                {noResults && (
                    <div className="px-3 py-4 text-xs text-[#848484] text-center" data-testid="skill-picker-no-results">
                        No skills match
                    </div>
                )}

                {filteredRepo.length > 0 && (
                    <>
                        <div className="px-3 py-1 text-[10px] font-semibold text-[#848484] uppercase tracking-wider bg-[#f8f8f8] dark:bg-[#252525]" data-testid="skill-picker-section-repo">
                            Repo
                        </div>
                        {filteredRepo.map((s, i) => renderSkillRow(s, i))}
                    </>
                )}

                {filteredGlobal.length > 0 && (
                    <>
                        <div className="px-3 py-1 text-[10px] font-semibold text-[#848484] uppercase tracking-wider bg-[#f8f8f8] dark:bg-[#252525]" data-testid="skill-picker-section-global">
                            Global
                        </div>
                        {filteredGlobal.map((s, i) => renderSkillRow(s, i + globalOffset))}
                    </>
                )}
            </div>
        </>
    );
}

export function SkillPicker({ skills, selectedSkills, onSkillChange, label }: SkillPickerProps) {
    const [open, setOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const skillByName = useMemo(() => new Map(skills.map(skill => [skill.name, skill])), [skills]);
    const visibleSelectedSkills = useMemo(
        () => selectedSkills.filter(name => name !== ENDEV_XDPU_SKILL_NAME || skillByName.has(name)),
        [selectedSkills, skillByName],
    );

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleToggleOpen = useCallback(() => {
        setOpen(prev => !prev);
    }, []);

    const handleDismiss = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus();
    }, []);

    const handleRemoveSkill = useCallback((e: React.MouseEvent, name: string) => {
        e.stopPropagation();
        onSkillChange(name);
    }, [onSkillChange]);

    const resolvedLabel = label ?? 'Skills (optional)';

    return (
        <div>
            {resolvedLabel && <label className="block text-xs font-medium text-[#848484] mb-1">{resolvedLabel}</label>}
            <div className="flex flex-wrap items-center gap-1.5" data-testid="skill-chips">
                {/* Selected skill chips */}
                {visibleSelectedSkills.map(name => {
                    const skill = skillByName.get(name);
                    return (
                        <button
                            key={name}
                            type="button"
                            onClick={(e) => handleRemoveSkill(e, name)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border bg-[#0078d4] text-white border-[#0078d4] transition-colors"
                            title={skill?.description || name}
                            data-testid={`skill-chip-${name}`}
                        >
                            <span>⚡</span>
                            <span>{name}</span>
                            <span className="ml-0.5">✕</span>
                        </button>
                    );
                })}

                {/* Add skill trigger button */}
                <div className="relative">
                    <button
                        ref={triggerRef}
                        type="button"
                        onClick={handleToggleOpen}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#555] hover:border-[#0078d4] transition-colors"
                        title="Select skills to guide the AI"
                        data-testid="skill-picker-trigger"
                    >
                        <span>⚡</span>
                        <span>Add skill…</span>
                        <span className="text-[10px] ml-0.5">▾</span>
                    </button>

                    {/* Popover */}
                    {open && (
                        <div
                            ref={popoverRef}
                            className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#555] rounded-lg shadow-lg z-50 overflow-hidden"
                            data-testid="skill-picker-popover"
                        >
                            <SkillPickerPanel
                                skills={skills}
                                selectedSkills={selectedSkills}
                                onSelect={onSkillChange}
                                onDismiss={handleDismiss}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
