/**
 * Pure logic for the composer's English word hint: finish the word being
 * typed when only a handful of common words start with it.
 */

/** Hint only when this many dictionary words (or fewer) match the prefix. */
export const MAX_WORD_HINT_CANDIDATES = 2;
/** Minimum letters typed before a hint is considered. */
export const MIN_WORD_HINT_PREFIX = 3;
/** Minimum letters the hint must add. */
export const MIN_WORD_HINT_GAIN = 2;

export interface WordHintDictionary {
    /** Lowercase words sorted lexicographically. */
    sorted: string[];
    /** Frequency rank per word (0 = most common). */
    rank: Map<string, number>;
}

/** Build a dictionary from a newline-separated, frequency-ordered word list. */
export function buildWordHintDictionary(wordList: string): WordHintDictionary {
    const rank = new Map<string, number>();
    for (const raw of wordList.split('\n')) {
        const word = raw.trim().toLowerCase();
        if (word && !rank.has(word)) rank.set(word, rank.size);
    }
    const sorted = [...rank.keys()].sort();
    return { sorted, rank };
}

function lowerBound(sorted: string[], target: string): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

const TRAILING_WORD_RE = new RegExp(`(^|[\\s("'])([A-Za-z]{${MIN_WORD_HINT_PREFIX},})$`);

/** Returns the suffix that completes the word at the end of `text`, or `''`. */
export function computeWordHint(text: string, cursorPos: number, dict: WordHintDictionary): string {
    if (cursorPos !== text.length) return '';
    const match = TRAILING_WORD_RE.exec(text);
    if (!match) return '';
    if ((text.match(/`/g)?.length ?? 0) % 2 === 1) return '';

    const typed = match[2];
    const prefix = typed.toLowerCase();
    // A complete word may be all the user meant; don't nag.
    if (dict.rank.has(prefix)) return '';
    const start = lowerBound(dict.sorted, prefix);
    let end = start;
    while (end < dict.sorted.length && dict.sorted[end].startsWith(prefix)) {
        end++;
        if (end - start > MAX_WORD_HINT_CANDIDATES) return '';
    }
    if (end === start) return '';

    let best = dict.sorted[start];
    for (let i = start + 1; i < end; i++) {
        const word = dict.sorted[i];
        if ((dict.rank.get(word) ?? Infinity) < (dict.rank.get(best) ?? Infinity)) best = word;
    }
    if (best.length - prefix.length < MIN_WORD_HINT_GAIN) return '';

    const suffix = best.slice(prefix.length);
    return typed === typed.toUpperCase() ? suffix.toUpperCase() : suffix;
}
