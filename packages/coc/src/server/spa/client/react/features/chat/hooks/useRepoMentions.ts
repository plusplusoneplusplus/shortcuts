/**
 * useRepoMentions — state for the `#repo_name` mention picker shown in a
 * repo-group chat composer.
 *
 * Deliberately shaped like `useSlashCommands`/`useModelCommand` so the two
 * composers can slot it into their existing keyboard-priority chain without
 * reordering anything: `handleKeyDown` returns true only when it consumed the
 * event, and the caller performs the actual insert on Enter/Tab.
 *
 * The picker is a typing convenience only — selection writes plain text into
 * the composer and nothing else.
 */

import { useState, useCallback, useRef } from 'react';
import { getRepoMentionContext } from '../slash-command-parser';
import { filterRepoMembers } from '../RepoMentionMenu';
import type { RepoGroupMember } from '../../../repos/repoGroupService';
import type { RichTextInputHandle } from '../../../shared/RichTextInput';

export interface UseRepoMentionsResult {
    /** True when the menu should be rendered (open, enabled, and non-empty). */
    menuVisible: boolean;
    /** Text typed after `#`, used to filter the list. */
    menuFilter: string;
    /** Members matching the current filter; empty when the menu is closed. */
    filteredMembers: RepoGroupMember[];
    /** Currently highlighted row. */
    highlightIndex: number;
    /** Call on every input change with the current text and cursor position. */
    handleInputChange: (text: string, cursorPos: number) => void;
    /** Intercepts key events while the menu is open. Returns true if consumed. */
    handleKeyDown: (e: React.KeyboardEvent<HTMLElement>) => boolean;
    /** Replace the `#partial` token under the caret with `#name ` (plain text). */
    selectMember: (
        name: string,
        text: string,
        setText: (t: string) => void,
        ref?: React.RefObject<RichTextInputHandle>,
    ) => void;
    /** Close the menu. */
    dismissMenu: () => void;
}

/** Characters that continue a `#repo-name` token; must match the parser's set. */
const MENTION_CHAR = /[a-zA-Z0-9_.-]/;

/**
 * @param members The group's resolved membership, or `undefined` while it is
 * still loading (the menu stays closed in that case, rather than flashing an
 * empty list).
 * @param enabled False outside a repo-group workspace — `#` then does nothing
 * new and types as ordinary text.
 */
export function useRepoMentions(
    members: RepoGroupMember[] | undefined,
    enabled: boolean,
): UseRepoMentionsResult {
    const [open, setOpen] = useState(false);
    const [menuFilter, setMenuFilter] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const hashStartRef = useRef<number>(-1);

    const matches = open && enabled && members
        ? filterRepoMembers(members, menuFilter)
        : [];
    // No "no results" row: when the filter matches nothing the menu simply
    // closes and typing continues as ordinary text.
    const menuVisible = matches.length > 0;
    const filteredMembers = menuVisible ? matches : [];

    const handleInputChange = useCallback((text: string, cursorPos: number) => {
        if (!enabled || !members) {
            setOpen(false);
            setMenuFilter('');
            return;
        }
        const ctx = getRepoMentionContext(text, cursorPos);
        if (ctx?.active) {
            hashStartRef.current = ctx.startIndex;
            setMenuFilter(ctx.prefix);
            setOpen(true);
            setHighlightIndex(0);
        } else {
            setOpen(false);
            setMenuFilter('');
        }
    }, [enabled, members]);

    const dismissMenu = useCallback(() => {
        setOpen(false);
        setMenuFilter('');
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>): boolean => {
        if (!menuVisible) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(prev => (prev + 1) % filteredMembers.length);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => (prev - 1 + filteredMembers.length) % filteredMembers.length);
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            // The caller inserts the highlighted member via `selectMember`.
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            // The `#` and anything typed after it stay in the text.
            setOpen(false);
            return true;
        }
        return false;
    }, [menuVisible, filteredMembers.length]);

    const selectMember = useCallback((
        name: string,
        text: string,
        setText: (t: string) => void,
        ref?: React.RefObject<RichTextInputHandle>,
    ) => {
        const start = hashStartRef.current;
        if (start < 0) return;

        // Find the end of the partial token being replaced.
        let end = start + 1; // skip the #
        while (end < text.length && MENTION_CHAR.test(text[end])) {
            end++;
        }

        const before = text.slice(0, start);
        const after = text.slice(end);
        const newText = `${before}#${name} ${after}`;
        setText(newText);
        if (ref?.current) {
            // Caret lands after the inserted "#${name} ".
            ref.current.setValue(newText, before.length + 1 + name.length + 1);
        }

        setOpen(false);
        setMenuFilter('');
    }, []);

    return {
        menuVisible,
        menuFilter,
        filteredMembers,
        highlightIndex,
        handleInputChange,
        handleKeyDown,
        selectMember,
        dismissMenu,
    };
}
