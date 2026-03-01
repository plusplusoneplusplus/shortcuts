/**
 * SlashCommandMenu — autocomplete dropdown for `/skill` commands.
 *
 * Renders a filtered list of available skills. Supports keyboard
 * navigation (ArrowUp/Down, Enter/Tab to select, Escape to dismiss).
 */

import { useEffect, useRef } from 'react';

export interface SkillItem {
    name: string;
    description?: string;
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
            className="absolute z-50 border rounded shadow-lg bg-white dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#3c3c3c] max-h-48 overflow-y-auto text-sm"
            style={{
                bottom: position ? `calc(100% - ${position.top}px + 4px)` : '100%',
                left: position?.left ?? 0,
                minWidth: 220,
            }}
            data-testid="slash-command-menu"
        >
            {filtered.map((skill, i) => (
                <div
                    key={skill.name}
                    data-menu-item
                    className={`px-3 py-1.5 cursor-pointer flex items-center gap-2 ${
                        i === highlightIndex
                            ? 'bg-[#e8e8e8] dark:bg-[#37373d]'
                            : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'
                    }`}
                    onMouseDown={e => { e.preventDefault(); onSelect(skill.name); }}
                >
                    <span className="text-yellow-500">⚡</span>
                    <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{skill.name}</span>
                    {skill.description && (
                        <span className="text-xs text-[#848484] truncate">— {skill.description}</span>
                    )}
                </div>
            ))}
        </div>
    );
}
