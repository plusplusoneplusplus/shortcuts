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
}

export const META_SKILL_ITEMS: SkillItem[] = [
    { name: 'model', description: 'Switch AI model' },
    { name: 'loop', description: 'Run a prompt on a recurring interval', args: '[interval] <prompt>' },
];

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

    // Filter skills by prefix
    const filtered = skills.filter(s =>
        s.name.toLowerCase().startsWith(filter.toLowerCase())
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
