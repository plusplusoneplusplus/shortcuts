/**
 * useSlashCommands — manages slash-command autocomplete state.
 *
 * Integrates with the slash-command parser to provide menu visibility,
 * filtering, keyboard navigation, and skill selection/extraction.
 */

import { useState, useCallback, useRef } from 'react';
import { parseSlashCommands, getSlashCommandContext } from './slash-command-parser';
import type { SkillItem } from './SlashCommandMenu';

export interface UseSlashCommandsResult {
    menuVisible: boolean;
    menuFilter: string;
    filteredSkills: SkillItem[];
    highlightIndex: number;
    /** Call on every input change with current text and cursor position */
    handleInputChange: (text: string, cursorPos: number) => void;
    /** Intercepts keyboard events when menu is open. Returns true if event was consumed. */
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
    /** Insert selected skill at the slash position */
    selectSkill: (name: string, text: string, setText: (t: string) => void) => void;
    /** Extract skills and clean prompt for submission */
    parseAndExtract: (text: string) => { skills: string[]; prompt: string };
    /** Dismiss the menu */
    dismissMenu: () => void;
}

export function useSlashCommands(skills: SkillItem[]): UseSlashCommandsResult {
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuFilter, setMenuFilter] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const slashStartRef = useRef<number>(-1);

    const skillNames = skills.map(s => s.name);

    const filteredSkills = menuVisible
        ? skills.filter(s => s.name.toLowerCase().startsWith(menuFilter.toLowerCase()))
        : [];

    const handleInputChange = useCallback((text: string, cursorPos: number) => {
        const ctx = getSlashCommandContext(text, cursorPos);
        if (ctx?.active) {
            slashStartRef.current = ctx.startIndex;
            setMenuFilter(ctx.prefix);
            setMenuVisible(true);
            setHighlightIndex(0);
        } else {
            setMenuVisible(false);
            setMenuFilter('');
        }
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
        if (!menuVisible || filteredSkills.length === 0) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(prev => (prev + 1) % filteredSkills.length);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => (prev - 1 + filteredSkills.length) % filteredSkills.length);
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            // Selection will be handled by the caller using selectSkill
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            setMenuVisible(false);
            return true;
        }
        return false;
    }, [menuVisible, filteredSkills.length]);

    const selectSkill = useCallback((name: string, text: string, setText: (t: string) => void) => {
        const start = slashStartRef.current;
        if (start < 0) return;

        // Find the end of the current partial token
        let end = start + 1; // skip the /
        while (end < text.length && /[a-zA-Z0-9_-]/.test(text[end])) {
            end++;
        }

        // Replace the /partial with /name followed by a space
        const before = text.slice(0, start);
        const after = text.slice(end);
        const insertion = `/${name} `;
        setText(before + insertion + after);

        setMenuVisible(false);
        setMenuFilter('');
    }, []);

    const parseAndExtract = useCallback((text: string) => {
        return parseSlashCommands(text, skillNames);
    }, [skillNames]);

    const dismissMenu = useCallback(() => {
        setMenuVisible(false);
        setMenuFilter('');
    }, []);

    return {
        menuVisible,
        menuFilter,
        filteredSkills,
        highlightIndex,
        handleInputChange,
        handleKeyDown,
        selectSkill,
        parseAndExtract,
        dismissMenu,
    };
}
