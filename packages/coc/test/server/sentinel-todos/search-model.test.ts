/**
 * Pure To-do search rules: literal, case-insensitive words that must all occur
 * across title, notes and completion condition; stable order; Done/Archived and
 * items beyond the recent page; safe highlight segments and match excerpts.
 */
import { describe, expect, it } from 'vitest';
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import {
    parseSentinelTodoSearch,
    sentinelTodoHighlight,
    sentinelTodoMatchesSearch,
    sentinelTodoSearchExcerpt,
    sentinelTodoSearchItems,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoSearch';
import { sentinelTodoRecentPage } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoStatusModel';

let seq = 0;
function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    seq += 1;
    const stamp = new Date(Date.UTC(2026, 9, 9, 0, 0, seq)).toISOString();
    return {
        id: `item-${seq}`, title: `Item ${seq}`, completionCondition: '', notes: '', status: 'todo', archived: false,
        revision: 1, createdAt: stamp, updatedAt: stamp, createdBy: 'user', updatedBy: 'user', jobs: [],
        type: 'normal', priority: 'regular', ...overrides,
    };
}

const matches = (overrides: Partial<SentinelTodoItem>, query: string) => sentinelTodoMatchesSearch(item(overrides), parseSentinelTodoSearch(query));

describe('parseSentinelTodoSearch', () => {
    it('splits on any whitespace, drops empty and duplicate words, and is inactive for blank input', () => {
        expect(parseSentinelTodoSearch('  alpha\tbeta\n alpha  ').words).toEqual(['alpha', 'beta']);
        expect(parseSentinelTodoSearch('').words).toEqual([]);
        expect(parseSentinelTodoSearch(' \t\n ').words).toEqual([]);
    });
});

describe('sentinelTodoMatchesSearch', () => {
    it('matches title, notes and completion condition', () => {
        expect(matches({ title: 'Fix login' }, 'login')).toBe(true);
        expect(matches({ notes: 'see the parser' }, 'parser')).toBe(true);
        expect(matches({ completionCondition: 'CI is green' }, 'green')).toBe(true);
        expect(matches({ title: 'Fix login' }, 'logout')).toBe(false);
    });

    it('requires every word but lets words come from different fields', () => {
        const fields = { title: 'Ship search', notes: 'needs highlight', completionCondition: 'tests pass' };
        expect(matches(fields, 'search highlight pass')).toBe(true);
        expect(matches(fields, 'search missing')).toBe(false);
    });

    it('folds case in query and text', () => {
        expect(matches({ title: 'Deploy STAGING' }, 'staging')).toBe(true);
        expect(matches({ title: 'deploy staging' }, 'StAgInG')).toBe(true);
    });

    it('treats punctuation and regex characters literally', () => {
        expect(matches({ notes: 'call foo.bar() then a|b' }, 'foo.bar()')).toBe(true);
        expect(matches({ notes: 'fooXbar' }, 'foo.bar')).toBe(false);
        expect(matches({ notes: 'a|b [x] ^$ \\d+' }, 'a|b [x] ^$ \\d+')).toBe(true);
        expect(matches({ notes: 'ab' }, 'a|b')).toBe(false);
        expect(matches({ title: 'C++ build' }, 'c++')).toBe(true);
        expect(matches({ title: '"quoted" -dash' }, '"quoted" -dash')).toBe(true);
    });

    it('never matches job/transcript data, only the three fields', () => {
        const linked = item({
            title: 'Plain', statusReason: 'secret reason', outcome: { summary: 'secret outcome', recordedBy: 'user', recordedAt: '2026-10-09T00:00:00Z' } as SentinelTodoItem['outcome'],
            jobs: [{ processId: 'secret-process', workspaceId: 'ws', kind: 'local', openLink: '#secret', linkedAt: '2026-10-09T00:00:00Z', execution: { state: 'completed' } } as SentinelTodoItem['jobs'][number]],
        });
        expect(sentinelTodoMatchesSearch(linked, parseSentinelTodoSearch('secret'))).toBe(false);
    });
});

describe('sentinelTodoSearchItems', () => {
    it('keeps the given order and includes Done and Archived items', () => {
        const items = [
            item({ id: 'a', title: 'alpha one' }),
            item({ id: 'b', title: 'beta' }),
            item({ id: 'c', title: 'alpha done', status: 'done' }),
            item({ id: 'd', notes: 'ALPHA archived', archived: true }),
        ];
        expect(sentinelTodoSearchItems(items, parseSentinelTodoSearch('alpha')).map(entry => entry.id)).toEqual(['a', 'c', 'd']);
        expect(sentinelTodoSearchItems([...items].reverse(), parseSentinelTodoSearch('alpha')).map(entry => entry.id)).toEqual(['d', 'c', 'a']);
    });

    it('returns every item for a blank query without mutating input', () => {
        const items = [item({ id: 'a' }), item({ id: 'b' })];
        const before = structuredClone(items);
        expect(sentinelTodoSearchItems(items, parseSentinelTodoSearch('   ')).map(entry => entry.id)).toEqual(['a', 'b']);
        sentinelTodoSearchItems(items, parseSentinelTodoSearch('a'));
        expect(items).toEqual(before);
    });

    it('finds an item outside the recent page of the full ledger', () => {
        const done = Array.from({ length: 70 }, (_, index) => item({ id: `done-${index}`, status: 'done' }));
        const old = item({ id: 'old-archived', archived: true, completionCondition: 'needle in history', updatedAt: '2020-01-01T00:00:00Z' });
        const ledger = [old, ...done];
        expect(sentinelTodoRecentPage(ledger).items.map(entry => entry.id)).not.toContain('old-archived');
        const ordered = sentinelTodoRecentPage(ledger, ledger.length).items;
        expect(sentinelTodoSearchItems(ordered, parseSentinelTodoSearch('needle')).map(entry => entry.id)).toEqual(['old-archived']);
    });
});

describe('sentinelTodoHighlight', () => {
    it('returns plain segments with merged, case-insensitive literal matches over the original text', () => {
        expect(sentinelTodoHighlight('Fix Login page; login.', parseSentinelTodoSearch('login'))).toEqual([
            { text: 'Fix ', match: false }, { text: 'Login', match: true }, { text: ' page; ', match: false },
            { text: 'login', match: true }, { text: '.', match: false },
        ]);
        expect(sentinelTodoHighlight('abcdef', parseSentinelTodoSearch('abc cde'))).toEqual([
            { text: 'abcde', match: true }, { text: 'f', match: false },
        ]);
    });

    it('keeps markup-like text as plain text and handles no match or empty text', () => {
        const segments = sentinelTodoHighlight('<b>bold</b>', parseSentinelTodoSearch('<b>'));
        expect(segments.map(segment => segment.text).join('')).toBe('<b>bold</b>');
        expect(segments.filter(segment => segment.match).map(segment => segment.text)).toEqual(['<b>']);
        expect(sentinelTodoHighlight('plain', parseSentinelTodoSearch('zzz'))).toEqual([{ text: 'plain', match: false }]);
        expect(sentinelTodoHighlight('', parseSentinelTodoSearch('zzz'))).toEqual([]);
    });
});

describe('sentinelTodoSearchExcerpt', () => {
    it('prefers the completion condition, then notes, and returns null for title-only matches', () => {
        const query = parseSentinelTodoSearch('needle');
        expect(sentinelTodoSearchExcerpt(item({ completionCondition: 'find the needle', notes: 'needle too' }), query))
            .toEqual({ field: 'completionCondition', text: 'find the needle' });
        expect(sentinelTodoSearchExcerpt(item({ notes: 'line one\nthe needle\nline three' }), query))
            .toEqual({ field: 'notes', text: 'line one the needle line three' });
        expect(sentinelTodoSearchExcerpt(item({ title: 'needle' }), query)).toBeNull();
    });

    it('trims long text around the first match with ellipses', () => {
        const notes = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`;
        const excerpt = sentinelTodoSearchExcerpt(item({ notes }), parseSentinelTodoSearch('needle'));
        expect(excerpt?.text.startsWith('…')).toBe(true);
        expect(excerpt?.text.endsWith('…')).toBe(true);
        expect(excerpt?.text).toContain('needle');
        expect(excerpt!.text.length).toBeLessThan(160);
    });
});
