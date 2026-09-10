/**
 * useSlashCommands — manages slash-command autocomplete state.
 *
 * Integrates with the slash-command parser to provide menu visibility,
 * filtering, keyboard navigation, and skill selection/extraction.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { parseSlashCommands, getSlashCommandContext, getActiveMetaCommands, type ParsedSlashCommands } from '../slash-command-parser';
import { isCronEnabled } from '../../../utils/config';
import { orderSkillItems, type SkillItem } from '../SlashCommandMenu';
import type { RichTextInputHandle } from '../../../shared/RichTextInput';

export interface UseSlashCommandsResult {
    menuVisible: boolean;
    menuFilter: string;
    filteredSkills: SkillItem[];
    highlightIndex: number;
    /** Call on every input change with current text and cursor position */
    handleInputChange: (text: string, cursorPos: number) => void;
    /** Intercepts keyboard events when menu is open. Returns true if event was consumed. */
    handleKeyDown: (e: React.KeyboardEvent<HTMLElement>) => boolean;
    /** Insert selected skill at the slash position */
    selectSkill: (
        name: string,
        text: string,
        setText: (t: string) => void,
        ref?: React.RefObject<RichTextInputHandle>,
    ) => void;
    /** Extract skills, meta-commands, and clean prompt for submission */
    parseAndExtract: (text: string) => ParsedSlashCommands;
    /** Dismiss the menu */
    dismissMenu: () => void;
    /** Ghost text hint shown after a meta-command with no argument yet (e.g. "[provider] <task>" after /delegate) */
    activeCommandHint: string | null;
}

/**
 * Meta-commands that activate a bundled skill of the same name. `cron` is only
 * reachable when the cron feature is enabled, which `getActiveMetaCommands`
 * already enforces before parsing, so an inactive command never matches here.
 */
const SKILL_BACKED_COMMANDS = ['cron', 'delegate'] as const;

/** Meta-commands that show an inline argument hint while the argument is empty. */
const HINT_COMMANDS = new Set<string>(SKILL_BACKED_COMMANDS);

/** A trailing `/command` token, optionally followed by whitespace, at the end of the input. */
const TRAILING_COMMAND_REGEX = /(?:^|\s)\/([a-zA-Z][a-zA-Z0-9_-]*)\s*$/;

export function useSlashCommands(skills: SkillItem[]): UseSlashCommandsResult {
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuFilter, setMenuFilter] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [currentText, setCurrentText] = useState('');
    const slashStartRef = useRef<number>(-1);

    const skillNames = skills.map(s => s.name);

    // Order built-in commands before skills. Must match SlashCommandMenu's
    // renderer ordering so the highlighted row lines up with the selected item.
    const filteredSkills = menuVisible
        ? orderSkillItems(skills.filter(s => s.name.toLowerCase().startsWith(menuFilter.toLowerCase())))
        : [];

    const activeCommandHint = useMemo((): string | null => {
        const match = TRAILING_COMMAND_REGEX.exec(currentText);
        if (!match) return null;
        const name = match[1].toLowerCase();
        if (!HINT_COMMANDS.has(name)) return null;
        return skills.find(s => s.name === name)?.args ?? null;
    }, [currentText, skills]);

    const handleInputChange = useCallback((text: string, cursorPos: number) => {
        setCurrentText(text);
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

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>): boolean => {
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

    const selectSkill = useCallback((
        name: string,
        text: string,
        setText: (t: string) => void,
        ref?: React.RefObject<RichTextInputHandle>,
    ) => {
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
        const newText = before + `/${name} ` + after;
        // Always sync React state; additionally update DOM when ref is available
        setText(newText);
        if (ref?.current) {
            // Place cursor right after the inserted "/${name} "
            const newCursorPos = before.length + 1 + name.length + 1;
            ref.current.setValue(newText, newCursorPos);
        }

        setMenuVisible(false);
        setMenuFilter('');
    }, []);

    const parseAndExtract = useCallback((text: string) => {
        const cronEnabled = isCronEnabled();
        const activeMeta = getActiveMetaCommands(cronEnabled);
        const result = parseSlashCommands(text, skillNames, activeMeta);
        // These meta-commands are thin entry points onto a bundled skill of the
        // same name: the command activates the skill and the agent reads the
        // remaining text as its argument.
        for (const name of SKILL_BACKED_COMMANDS) {
            if (result.metaCommands.includes(name) && !result.skills.includes(name)) {
                result.skills.push(name);
            }
        }
        return result;
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
        activeCommandHint,
    };
}
