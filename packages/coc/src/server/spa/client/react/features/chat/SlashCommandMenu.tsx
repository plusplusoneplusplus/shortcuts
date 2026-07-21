/**
 * SlashCommandMenu — autocomplete popover for `/skill` commands.
 *
 * Renders as a card-style panel anchored above the chat input. Each row shows
 * the command name in monospace plus a short description, and the highlighted
 * row gets a return-key indicator on the right edge to hint that Enter/Tab
 * inserts the command. Supports keyboard navigation (ArrowUp/Down, Enter/Tab
 * to select, Escape to dismiss).
 */

import { useEffect, useRef } from 'react';

export interface SkillItem {
    name: string;
    description?: string;
    args?: string;
    /**
     * Discriminates a built-in meta command (`/model`, `/loop`, `/compact`) from a
     * server-fetched SKILL.md skill. Derived client-side; when absent it is treated
     * as `'skill'` (see {@link effectiveKind}) so surfaces that don't merge meta
     * still render sanely.
     */
    kind?: 'builtin' | 'skill';
}

export const META_SKILL_ITEMS: SkillItem[] = [
    { name: 'model', description: 'Switch AI model', kind: 'builtin' },
    { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>', kind: 'builtin' },
    { name: 'compact', description: 'Compact the conversation to free context', args: '[instructions]', kind: 'builtin' },
];

/**
 * Return meta skill items filtered by feature flags.
 * `/loop` is excluded when the loops feature is disabled.
 */
export function getMetaSkillItems(loopsEnabled: boolean): SkillItem[] {
    return META_SKILL_ITEMS.filter(m => m.name !== 'loop' || loopsEnabled);
}

/**
 * Merge server-fetched skills with meta skill items, deduplicating by name.
 * When a server skill and a meta item share the same name, the server skill's
 * description is preferred but the meta item's `args` hint is overlaid if the
 * server skill lacks one.
 */
export function mergeSkillsWithMeta(skills: SkillItem[], metaItems: SkillItem[]): SkillItem[] {
    const metaByName = new Map(metaItems.map(m => [m.name, m]));
    const merged: SkillItem[] = skills.map(s => {
        const meta = metaByName.get(s.name);
        if (meta) {
            metaByName.delete(s.name);
            // Server description wins; overlay the meta `args` hint when the skill
            // lacks one. The name matches a built-in command, so it is built-in.
            return { ...s, args: s.args || meta.args, kind: 'builtin' };
        }
        // Every server-fetched entry is a skill.
        return { ...s, kind: 'skill' };
    });
    // Remaining meta items were not present server-side; keep their built-in kind.
    return [...merged, ...metaByName.values()];
}

/**
 * The effective kind of a menu item. Defaults to `'skill'` when `kind` is absent,
 * so surfaces that pass raw server skills (without merging meta) render sanely and
 * the row renderer never crashes on a missing discriminator.
 */
export function effectiveKind(item: SkillItem): 'builtin' | 'skill' {
    return item.kind === 'builtin' ? 'builtin' : 'skill';
}

/**
 * Order menu items built-in-first, stable within each bucket. Pure and idempotent
 * (a stable re-sort of an already-ordered list is a no-op), so the menu renderer
 * and `useSlashCommands` both apply it and stay in lockstep — that alignment keeps
 * the keyboard-highlighted row matching the item that Enter/Tab inserts.
 */
export function orderSkillItems(items: SkillItem[]): SkillItem[] {
    return [...items].sort(
        (a, b) => (effectiveKind(a) === 'builtin' ? 0 : 1) - (effectiveKind(b) === 'builtin' ? 0 : 1),
    );
}

/** Accessible label + hover tooltip per kind (no visible group headers exist). */
const KIND_LABEL: Record<'builtin' | 'skill', string> = {
    builtin: 'Command',
    skill: 'Skill',
};

/** Terminal/command glyph for built-in commands. */
function CommandGlyph() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
            <polyline points="4.5 6 6.5 8 4.5 10" />
            <line x1="8" y1="10.25" x2="11" y2="10.25" />
        </svg>
    );
}

/** Blocks glyph for SKILL.md skills. */
function SkillGlyph() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
    );
}

/**
 * Leading per-row icon distinguishing a built-in command from a skill. The
 * accessible label and hover tooltip carry the "Command"/"Skill" wording because
 * the flat single-list layout has no visible group-header rows.
 */
function KindIcon({ kind }: { kind: 'builtin' | 'skill' }) {
    const label = KIND_LABEL[kind];
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            data-testid="slash-command-kind-icon"
            data-kind={kind}
            className="shrink-0 flex items-center text-[#848484] dark:text-[#858585]"
        >
            {kind === 'builtin' ? <CommandGlyph /> : <SkillGlyph />}
        </span>
    );
}

interface SlashCommandMenuProps {
    skills: SkillItem[];
    filter: string;
    onSelect: (name: string) => void;
    onDismiss: () => void;
    visible: boolean;
    position?: { top: number; left: number };
    highlightIndex: number;
}

export function SlashCommandMenu({
    skills,
    filter,
    onSelect,
    onDismiss,
    visible,
    position,
    highlightIndex,
}: SlashCommandMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Filter skills by prefix, then order built-in commands before skills.
    // orderSkillItems must match useSlashCommands' ordering so the highlighted
    // row lines up with the item Enter/Tab inserts.
    const filtered = orderSkillItems(
        skills.filter(s => s.name.toLowerCase().startsWith(filter.toLowerCase())),
    );

    // Dismiss on outside click
    useEffect(() => {
        if (!visible) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onDismiss();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [visible, onDismiss]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const items = menuRef.current.querySelectorAll('[data-menu-item]');
        const item = items[highlightIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex, visible]);

    if (!visible || filtered.length === 0) return null;

    return (
        <div
            ref={menuRef}
            className="absolute z-50 rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden text-sm"
            style={{
                bottom: position ? `calc(100% - ${position.top}px + 4px)` : '100%',
                left: position?.left ?? 0,
                marginBottom: 6,
                minWidth: 320,
                maxWidth: 560,
            }}
            data-testid="slash-command-menu"
        >
            <div
                className="px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-[10px] font-semibold tracking-wider uppercase text-[#848484]"
                data-testid="slash-command-menu-header"
            >
                Slash commands
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
                {filtered.map((skill, i) => {
                    const highlighted = i === highlightIndex;
                    return (
                        <div
                            key={skill.name}
                            data-menu-item
                            data-highlighted={highlighted ? 'true' : 'false'}
                            className={`px-3 py-1.5 cursor-pointer flex items-center gap-3 min-w-0 ${
                                highlighted
                                    ? 'bg-[#eef3fb] dark:bg-[#37373d]'
                                    : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]'
                            }`}
                            onMouseDown={e => { e.preventDefault(); onSelect(skill.name); }}
                        >
                            <KindIcon kind={effectiveKind(skill)} />
                            <span className="font-mono text-[13px] font-semibold text-[#1e1e1e] dark:text-[#d4d4d4] shrink-0">
                                /{skill.name}
                            </span>
                            {skill.args && (
                                <span className="font-mono text-[12px] text-[#9d9d9d] dark:text-[#6e6e6e] shrink-0">
                                    {skill.args}
                                </span>
                            )}
                            {skill.description && (
                                <span className="text-xs text-[#616161] dark:text-[#9d9d9d] truncate min-w-0 flex-1">
                                    {skill.description}
                                </span>
                            )}
                            {highlighted && (
                                <span
                                    aria-hidden="true"
                                    className="ml-auto shrink-0 text-[#848484] text-base leading-none"
                                    data-testid="slash-command-menu-return"
                                    title="Press Enter to insert"
                                >
                                    &#x21B5;
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
