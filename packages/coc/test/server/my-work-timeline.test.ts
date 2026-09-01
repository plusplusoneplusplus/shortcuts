/**
 * The note this parses is written by an AI sweep and hand-edited by the user,
 * so most of what is asserted here is degradation: a line the parser cannot
 * read is dropped, and nothing in the file can make it throw.
 */

import { describe, it, expect } from 'vitest';
import {
    parseTimeline,
    resolveTimelineLink,
    TIMELINE_LIMIT,
    TIMELINE_NOTE_PATH,
} from '../../src/server/workspaces/my-work-timeline';

const WELL_FORMED = [
    '## 2026-08-09',
    '- 06:00 **[contoso-migration]** cutover slipped to the 14th — you owe Priya a revised plan → [thread](threads/contoso-migration.md)',
    '- 06:00 **[q3-budget]** Dana approved; no action → [thread](threads/q3-budget.md)',
    '',
    '## 2026-08-08',
    '- 17:00 **[hiring-loop]** panel moved to Thursday → [thread](threads/hiring-loop.md)',
    '',
].join('\n');

describe('parseTimeline', () => {
    describe('well-formed input', () => {
        it('parses time, thread, text and link off each bullet', () => {
            const { entries, total } = parseTimeline(WELL_FORMED);
            expect(total).toBe(3);
            expect(entries).toHaveLength(3);
            expect(entries[0]).toMatchObject({
                date: '2026-08-09',
                time: '06:00',
                thread: 'contoso-migration',
                text: 'cutover slipped to the 14th — you owe Priya a revised plan',
                link: { kind: 'note', path: 'Work/threads/contoso-migration.md' },
            });
            expect(entries[2]).toMatchObject({ date: '2026-08-08', time: '17:00', thread: 'hiring-loop' });
        });

        it('keeps file order — the format puts the newest entry first', () => {
            const { entries } = parseTimeline(WELL_FORMED);
            expect(entries.map(e => e.thread)).toEqual(['contoso-migration', 'q3-budget', 'hiring-loop']);
        });

        it('gives every entry a distinct id', () => {
            const { entries } = parseTimeline(WELL_FORMED);
            expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
        });

        it('accepts a bullet with no time, thread or link', () => {
            const { entries } = parseTimeline('## 2026-08-09\n- something happened\n');
            expect(entries).toEqual([
                { id: 'tl-1', date: '2026-08-09', text: 'something happened' },
            ]);
        });

        it('normalizes a single-digit hour', () => {
            const { entries } = parseTimeline('## 2026-08-09\n- 6:05 the thing\n');
            expect(entries[0].time).toBe('06:05');
        });

        it('accepts `*` and `+` bullets and indented ones', () => {
            const { entries } = parseTimeline('## 2026-08-09\n* star\n+ plus\n  - indented\n');
            expect(entries.map(e => e.text)).toEqual(['star', 'plus', 'indented']);
        });

        it('accepts an `->` arrow in place of the unicode one', () => {
            const { entries } = parseTimeline('## 2026-08-09\n- 06:00 **[x]** moved -> [thread](threads/x.md)\n');
            expect(entries[0].text).toBe('moved');
            expect(entries[0].link).toEqual({ kind: 'note', path: 'Work/threads/x.md' });
        });

        it('handles CRLF line endings', () => {
            const { entries } = parseTimeline(WELL_FORMED.replace(/\n/g, '\r\n'));
            expect(entries).toHaveLength(3);
            expect(entries[0].link).toEqual({ kind: 'note', path: 'Work/threads/contoso-migration.md' });
        });
    });

    describe('empty and missing input', () => {
        // The route passes '' for a file that does not exist, so both cases are
        // one case here — and both must produce a strip with nothing in it.
        it.each([
            ['empty string', ''],
            ['whitespace only', '   \n\n\t\n'],
            ['headings with no bullets', '# Timeline\n\n## 2026-08-09\n\n## 2026-08-08\n'],
        ])('returns no entries for %s', (_label, content) => {
            expect(parseTimeline(content)).toEqual({ entries: [], total: 0 });
        });

        it('tolerates a non-string content value', () => {
            expect(parseTimeline(undefined as unknown as string)).toEqual({ entries: [], total: 0 });
        });
    });

    describe('malformed lines', () => {
        it('skips a bullet with no prose left after the syntax is stripped', () => {
            const { entries, total } = parseTimeline([
                '## 2026-08-09',
                '- 06:00 **[ghost]** → [thread](threads/ghost.md)',
                '- 06:00 **[real]** something actually happened',
                '-',
                '-    ',
            ].join('\n'));
            expect(total).toBe(1);
            expect(entries[0].thread).toBe('real');
        });

        it('leaves an unparseable clock in the text rather than eating it', () => {
            const { entries } = parseTimeline('## 2026-08-09\n- 99:99 weird but readable\n');
            expect(entries[0].time).toBeUndefined();
            expect(entries[0].text).toBe('99:99 weird but readable');
        });

        it('keeps a bullet whose link is unusable, minus the link', () => {
            const { entries } = parseTimeline('## 2026-08-09\n- **[x]** escaped → [thread](../../../etc/passwd)\n');
            expect(entries[0]).toMatchObject({ thread: 'x', text: 'escaped' });
            expect(entries[0].link).toBeUndefined();
        });

        it('ignores prose, tables, front-matter and code fences', () => {
            const { entries } = parseTimeline([
                '---',
                'generated: true',
                '---',
                '# Timeline',
                'Some prose about the file.',
                '| a | b |',
                '```',
                '- not a bullet, this is code',
                '```',
                '## 2026-08-09',
                '- 06:00 **[x]** the only real entry',
            ].join('\n'));
            // Fenced content is not tracked as a fence — the bullet inside it
            // still parses. That is the deliberate trade: this parser reads
            // lines, and an over-clever one has more ways to lose a real entry.
            expect(entries.map(e => e.text)).toContain('the only real entry');
            expect(entries).toHaveLength(2);
        });

        it('never throws on adversarial input', () => {
            const nasty = [
                '## not-a-date',
                '- ' + '['.repeat(500),
                '- **[' + 'x'.repeat(5000) + ']** deep',
                '- 00:00 [](())',
                '#'.repeat(80),
                '- \u0000\u0001',
                '## 2026-02-30',
                '- 06:00 **[a]** ok',
            ].join('\n');
            expect(() => parseTimeline(nasty)).not.toThrow();
        });
    });

    describe('heading shapes', () => {
        it('reads the date off a `## YYYY-MM-DD` heading', () => {
            expect(parseTimeline('## 2026-08-09\n- x\n').entries[0].date).toBe('2026-08-09');
        });

        it.each(['# 2026-08-09', '### 2026-08-09', '###### 2026-08-09'])(
            'accepts the date at any heading level (%s)',
            (heading) => {
                expect(parseTimeline(`${heading}\n- x\n`).entries[0].date).toBe('2026-08-09');
            },
        );

        it.each([
            ['a prose heading', '## Today'],
            ['a heading with trailing words', '## 2026-08-09 (Friday)'],
            ['an impossible date', '## 2026-02-30'],
            ['a month out of range', '## 2026-13-01'],
            ['a non-ISO date', '## Aug 9, 2026'],
        ])('keeps bullets under %s, undated', (_label, heading) => {
            const { entries, total } = parseTimeline(`${heading}\n- 06:00 **[x]** still shown\n`);
            expect(total).toBe(1);
            expect(entries[0].date).toBeUndefined();
            expect(entries[0].text).toBe('still shown');
        });

        it('stops applying a date once a non-date heading follows it', () => {
            const { entries } = parseTimeline([
                '## 2026-08-09',
                '- dated',
                '## Notes',
                '- undated',
            ].join('\n'));
            expect(entries[0].date).toBe('2026-08-09');
            expect(entries[1].date).toBeUndefined();
        });
    });

    describe('limit', () => {
        const many = ['## 2026-08-09', ...Array.from({ length: 12 }, (_, i) => `- 06:00 **[t${i}]** entry ${i}`)].join('\n');

        it('caps at five by default and reports the true total', () => {
            const { entries, total } = parseTimeline(many);
            expect(TIMELINE_LIMIT).toBe(5);
            expect(entries).toHaveLength(5);
            expect(total).toBe(12);
            expect(entries.map(e => e.thread)).toEqual(['t0', 't1', 't2', 't3', 't4']);
        });

        it('honours an explicit limit', () => {
            expect(parseTimeline(many, 2).entries).toHaveLength(2);
            expect(parseTimeline(many, 0).entries).toHaveLength(0);
            expect(parseTimeline(many, 0).total).toBe(12);
        });

        it('falls back to the default for a nonsense limit', () => {
            expect(parseTimeline(many, NaN).entries).toHaveLength(5);
            expect(parseTimeline(many, -3).entries).toHaveLength(5);
        });

        it('returns fewer than the limit without padding', () => {
            expect(parseTimeline('## 2026-08-09\n- one\n').entries).toHaveLength(1);
        });
    });
});

describe('resolveTimelineLink', () => {
    it('resolves a relative link against the timeline directory', () => {
        expect(resolveTimelineLink('threads/contoso-migration.md'))
            .toEqual({ kind: 'note', path: 'Work/threads/contoso-migration.md' });
    });

    it('normalizes `./` and backslash separators', () => {
        expect(resolveTimelineLink('./threads/x.md')).toEqual({ kind: 'note', path: 'Work/threads/x.md' });
        expect(resolveTimelineLink('threads\\x.md')).toEqual({ kind: 'note', path: 'Work/threads/x.md' });
    });

    it('keeps http(s) links external', () => {
        expect(resolveTimelineLink('https://teams.microsoft.com/l/message/1'))
            .toEqual({ kind: 'external', url: 'https://teams.microsoft.com/l/message/1' });
    });

    it.each([
        ['a parent-directory escape', '../../secrets.md'],
        ['an escape mid-path', 'threads/../../secrets.md'],
        ['an absolute posix path', '/etc/passwd'],
        ['a windows path', 'C:\\Windows\\win.ini'],
        ['a UNC path', '\\\\server\\share'],
        ['a javascript: url', 'javascript:alert(1)'],
        ['a data: url', 'data:text/html,<script>'],
        ['a file: url', 'file:///etc/passwd'],
        ['an empty target', '   '],
        ['nothing at all', undefined],
        ['a bare dot', '.'],
    ])('refuses %s', (_label, href) => {
        expect(resolveTimelineLink(href)).toBeNull();
    });
});

describe('TIMELINE_NOTE_PATH', () => {
    it('is the fixed Work Radar note, so no request input reaches the filesystem', () => {
        expect(TIMELINE_NOTE_PATH).toBe('Work/timeline.md');
    });
});
