/**
 * useFileMentions — the composer's file-mention popup state machine (AC-04/05).
 *
 * Joins the three halves already built: `getFileMentionContext` decides when a
 * token under the caret is a path being typed, `useFileMentionSearch` fetches
 * ranked matches across the repo group, and `FileMentionMenu` renders them.
 *
 * Deliberately shaped like `useRepoMentions` so both composers can drop it into
 * their existing keyboard-priority chain unchanged: `handleKeyDown` returns true
 * only when it consumed the event, and the popup goes LAST in that chain so it
 * can never steal a key from the `/`, model, or `#repo` menus.
 *
 * Accepting writes plain text — a backticked path, exactly what a file drop
 * inserts — so nothing about message serialization changes.
 */

import { useState, useCallback, useRef } from 'react';
import { getFileMentionContext } from '../slash-command-parser';
import { moveFileMentionHighlight } from '../FileMentionMenu';
import { buildFilePathInsertion } from '../sessionContextDrop';
import {
    useFileMentionSearch,
    type FileMentionRepo,
    type FileMentionResult,
} from './useFileMentionSearch';
import type { RichTextInputHandle } from '../../../shared/RichTextInput';

export interface UseFileMentionsResult {
    /** True when the menu should be rendered (open, enabled, and non-empty). */
    menuVisible: boolean;
    /** Ranked matches across the group; empty when the menu is closed. */
    results: FileMentionResult[];
    /** Currently highlighted row. */
    highlightIndex: number;
    /** Call on every input change with the current text and cursor position. */
    handleInputChange: (text: string, cursorPos: number) => void;
    /** Intercepts key events while the menu is open. Returns true if consumed. */
    handleKeyDown: (e: React.KeyboardEvent<HTMLElement>) => boolean;
    /** Replace the token under the caret with `` `path` `` plus a trailing space. */
    selectResult: (
        result: FileMentionResult,
        text: string,
        setText: (t: string) => void,
        ref?: React.RefObject<RichTextInputHandle>,
    ) => void;
    /** Close the menu. */
    dismissMenu: () => void;
}

/**
 * @param repos Every repo in the session's repo group, in group order. Empty
 * when the session has no repo at all — the popup then never opens.
 * @param enabled False while the composer is busy or the feature does not
 * apply; typing then behaves exactly as before.
 */
export function useFileMentions(
    repos: FileMentionRepo[],
    enabled: boolean,
): UseFileMentionsResult {
    const [query, setQuery] = useState<string | null>(null);
    const [highlightIndex, setHighlightIndex] = useState(0);
    // Start offset of the token being replaced, including any leading `@`.
    const tokenStartRef = useRef<number>(-1);

    const active = enabled && repos.length > 0 ? query : null;
    const { results } = useFileMentionSearch(repos, active);

    // No "no results" row: when nothing matches the menu simply closes and
    // typing continues as ordinary text.
    const menuVisible = active !== null && results.length > 0;
    const visibleResults = menuVisible ? results : [];

    const dismissMenu = useCallback(() => {
        setQuery(null);
        tokenStartRef.current = -1;
    }, []);

    const handleInputChange = useCallback((text: string, cursorPos: number) => {
        if (!enabled || repos.length === 0) {
            setQuery(null);
            tokenStartRef.current = -1;
            return;
        }
        const ctx = getFileMentionContext(text, cursorPos);
        if (ctx?.active) {
            tokenStartRef.current = ctx.startIndex;
            setQuery(ctx.prefix);
            setHighlightIndex(0);
        } else {
            setQuery(null);
            tokenStartRef.current = -1;
        }
    }, [enabled, repos.length]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>): boolean => {
        if (!menuVisible) return false;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => moveFileMentionHighlight(prev, visibleResults.length, e.key as 'ArrowDown' | 'ArrowUp'));
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            // The caller inserts the highlighted row via `selectResult`.
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            // What was typed stays in the text; only the popup closes.
            dismissMenu();
            return true;
        }
        return false;
    }, [menuVisible, visibleResults.length, dismissMenu]);

    const selectResult = useCallback((
        result: FileMentionResult,
        text: string,
        setText: (t: string) => void,
        ref?: React.RefObject<RichTextInputHandle>,
    ) => {
        const start = tokenStartRef.current;
        if (start < 0 || start > text.length) return;

        // Re-scan the token end from the live text rather than trusting the
        // cursor offset captured at input time — a click on a row happens a
        // beat later, and the text is the only thing that is definitely current.
        let end = start;
        while (end < text.length && !/\s/.test(text[end])) {
            end++;
        }

        // `buildFilePathInsertion` owns the backticks and the trailing space, so
        // a mention and a file drop insert byte-identical text. The `@` sigil is
        // part of the replaced range and is dropped.
        const withoutToken = text.slice(0, start) + text.slice(end);
        const inserted = buildFilePathInsertion(withoutToken, start, [result.path]);

        // The insertion carries its own trailing space. When the token was
        // already followed by whitespace, drop that space rather than leaving a
        // double gap, and put the caret past the whitespace that is already
        // there — either way the caret ends up one space after the path.
        const followedBySpace = end < text.length && /\s/.test(text[end]);
        const newText = followedBySpace
            ? inserted.text.slice(0, inserted.cursorPos - 1) + inserted.text.slice(inserted.cursorPos)
            : inserted.text;

        setText(newText);
        ref?.current?.setValue(newText, inserted.cursorPos);

        setQuery(null);
        tokenStartRef.current = -1;
    }, []);

    return {
        menuVisible,
        results: visibleResults,
        highlightIndex,
        handleInputChange,
        handleKeyDown,
        selectResult,
        dismissMenu,
    };
}
