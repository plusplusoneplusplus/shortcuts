/**
 * useWordHint — client-only ghost text that finishes the English word being
 * typed. The dictionary is lazy-loaded the first time the hook is enabled and
 * kept at module level. `dismiss()` hides the hint until the text changes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildWordHintDictionary, computeWordHint, type WordHintDictionary } from '../utils/wordHint';

let dictionary: WordHintDictionary | null = null;
let dictionaryPromise: Promise<WordHintDictionary> | null = null;

function loadDictionary(): Promise<WordHintDictionary> {
    dictionaryPromise ??= import('../data/english-words').then(mod => {
        dictionary = buildWordHintDictionary(mod.ENGLISH_WORDS);
        return dictionary;
    });
    return dictionaryPromise;
}

/** @internal Reset module-level state for testing. */
export function __resetWordHintForTesting(): void {
    dictionary = null;
    dictionaryPromise = null;
}

export interface UseWordHintOptions {
    text: string;
    cursorPos: number;
    enabled: boolean;
}

export interface UseWordHintResult {
    completion: string;
    /** Returns the joined string (text + completion) for the caller to apply. */
    accept(): string;
    dismiss(): void;
}

export function useWordHint({ text, cursorPos, enabled }: UseWordHintOptions): UseWordHintResult {
    const [dict, setDict] = useState<WordHintDictionary | null>(dictionary);
    const [dismissedFor, setDismissedFor] = useState<string | null>(null);
    // Any text change ends the dismissal.
    if (dismissedFor !== null && dismissedFor !== text) setDismissedFor(null);

    useEffect(() => {
        if (!enabled || dict) return;
        let cancelled = false;
        loadDictionary().then(d => { if (!cancelled) setDict(d); }, () => { /* keep hints off */ });
        return () => { cancelled = true; };
    }, [enabled, dict]);

    const completion = useMemo(() => {
        if (!enabled || !dict || dismissedFor === text) return '';
        return computeWordHint(text, cursorPos, dict);
    }, [enabled, dict, dismissedFor, text, cursorPos]);

    const accept = useCallback(() => text + completion, [text, completion]);
    const dismiss = useCallback(() => setDismissedFor(text), [text]);

    return { completion, accept, dismiss };
}

type GhostSource = UseWordHintResult;

/**
 * Merge ghost-text sources for a composer: the first source with a non-empty
 * completion wins (and owns `accept()`); `dismiss()` clears all of them.
 */
export function mergeGhostSources(text: string, ...sources: GhostSource[]): GhostSource {
    const winner = sources.find(s => s.completion);
    return {
        completion: winner?.completion ?? '',
        accept: () => winner?.accept() ?? text,
        dismiss: () => { for (const s of sources) s.dismiss(); },
    };
}
