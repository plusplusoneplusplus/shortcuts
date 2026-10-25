/**
 * sentinelTodoSearch — literal To-do search over a whole Sentinel ledger.
 *
 * A query is split on whitespace into words; an item matches when every word
 * occurs, case-insensitively, in its title, notes or completion condition (each
 * word in any one field). Punctuation is literal text, never query syntax, and
 * results keep the caller's item order. Linked chat transcripts are never
 * searched. Matching and highlighting share one case-insensitive literal
 * pattern per word, so highlight offsets always index the original text.
 */

import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

export type SentinelTodoSearchField = 'title' | 'completionCondition' | 'notes';

type SearchableItem = Pick<SentinelTodoItem, SentinelTodoSearchField>;

/** One compiled query: an empty word list means search is inactive. */
export interface SentinelTodoSearchQuery {
    readonly words: readonly string[];
    readonly patterns: readonly RegExp[];
}

const FIELDS: readonly SentinelTodoSearchField[] = ['title', 'completionCondition', 'notes'];

function escapeLiteral(word: string): string {
    return word.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function parseSentinelTodoSearch(query: string): SentinelTodoSearchQuery {
    const words = [...new Set(query.split(/\s+/u).filter(Boolean))];
    return { words, patterns: words.map(word => new RegExp(escapeLiteral(word), 'iu')) };
}

export function sentinelTodoMatchesSearch(item: SearchableItem, query: SentinelTodoSearchQuery): boolean {
    return query.patterns.every(pattern => FIELDS.some(field => pattern.test(item[field] ?? '')));
}

/** Matching items in the given order; an inactive query returns them all. */
export function sentinelTodoSearchItems<T extends SearchableItem>(items: readonly T[], query: SentinelTodoSearchQuery): T[] {
    return query.words.length ? items.filter(item => sentinelTodoMatchesSearch(item, query)) : [...items];
}

export interface SentinelTodoTextSegment {
    text: string;
    match: boolean;
}

/** Plain-text segments with merged match ranges, for rendering highlights without HTML. */
export function sentinelTodoHighlight(text: string, query: SentinelTodoSearchQuery): SentinelTodoTextSegment[] {
    const ranges: Array<[number, number]> = [];
    for (const pattern of query.patterns) {
        const global = new RegExp(pattern.source, 'giu');
        for (const found of text.matchAll(global)) ranges.push([found.index, found.index + found[0].length]);
    }
    if (!ranges.length) return text ? [{ text, match: false }] : [];
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([...range]);
    }
    const segments: SentinelTodoTextSegment[] = [];
    let cursor = 0;
    for (const [start, end] of merged) {
        if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
        segments.push({ text: text.slice(start, end), match: true });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
    return segments;
}

export interface SentinelTodoSearchExcerpt {
    field: Exclude<SentinelTodoSearchField, 'title'>;
    text: string;
}

const EXCERPT_CONTEXT = 48;

/**
 * A short one-line excerpt around the first match in the completion condition
 * or notes, for a compact row whose title alone does not show why it matched.
 */
export function sentinelTodoSearchExcerpt(item: SearchableItem, query: SentinelTodoSearchQuery): SentinelTodoSearchExcerpt | null {
    for (const field of ['completionCondition', 'notes'] as const) {
        const text = item[field] ?? '';
        let first = -1;
        for (const pattern of query.patterns) {
            const index = text.search(pattern);
            if (index >= 0 && (first < 0 || index < first)) first = index;
        }
        if (first < 0) continue;
        const start = Math.max(0, first - EXCERPT_CONTEXT);
        const end = Math.min(text.length, first + EXCERPT_CONTEXT * 2);
        const body = text.slice(start, end).replace(/\s+/gu, ' ').trim();
        return { field, text: `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}` };
    }
    return null;
}
