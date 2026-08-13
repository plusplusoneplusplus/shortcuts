/**
 * My Work task model tests (AC-01).
 *
 * Covers the pure parser/serializer:
 * - parse round-trip for LF and CRLF endings, unicode, legacy default files,
 *   and malformed/non-checkbox pass-through
 * - minimal-diff serialization: toggling one checkbox changes exactly one line,
 *   archiving moves only checked action items
 */

import { describe, it, expect } from 'vitest';
import {
    parseActionItems,
    parseFollowUps,
    parse,
    patchActionItem,
    patchFollowUp,
    addActionItem,
    addFollowUp,
    archiveCheckedActionItems,
    formatTaskLine,
} from '../../src/server/workspaces/my-work-tasks';

// The exact DEFAULT_NOTES content from my-work-workspace.ts.
const DEFAULT_ACTION_ITEMS =
    '# Action Items\n\nTrack your tasks and action items here. Use checkboxes to mark progress.\n\n- [ ] Example: Add your first action item\n';
const DEFAULT_FOLLOW_UPS =
    "# Follow Ups\n\nTrack items you're waiting on from others, grouped by person.\n\n## Example Person\n- [ ] Waiting on reply about project timeline\n";

/** Count how many lines differ between two strings (split on '\n'). */
function changedLineCount(a: string, b: string): number {
    const la = a.split('\n');
    const lb = b.split('\n');
    let diff = Math.abs(la.length - lb.length);
    for (let i = 0; i < Math.min(la.length, lb.length); i++) {
        if (la[i] !== lb[i]) diff++;
    }
    return diff;
}

describe('parseActionItems', () => {
    it('parses the legacy default file with one unchecked item', () => {
        const items = parseActionItems(DEFAULT_ACTION_ITEMS);
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('Example: Add your first action item');
        expect(items[0].checked).toBe(false);
        expect(items[0].id).toMatch(/^[0-9a-f]{12}$/);
        expect(items[0].person).toBeUndefined();
    });

    it('parses checked and unchecked items', () => {
        const content = '# Action Items\n- [ ] todo\n- [x] done\n- [X] also done\n';
        const items = parseActionItems(content);
        expect(items.map((i) => i.checked)).toEqual([false, true, true]);
    });

    it('excludes items under a ## Archive section', () => {
        const content = '# Action Items\n- [ ] active\n\n## Archive\n- [x] old\n- [x] older\n';
        const items = parseActionItems(content);
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('active');
    });

    it('keeps items under non-archive ## Synced sections active', () => {
        const content = '# Action Items\n- [ ] a\n\n## Synced Jun 5\n- [ ] b\n';
        const items = parseActionItems(content);
        expect(items.map((i) => i.text)).toEqual(['a', 'b']);
    });

    it('passes malformed / non-checkbox lines through (parsed out, not crashing)', () => {
        const content = '# Action Items\nrandom prose\n- not a checkbox\n* [ ] wrong bullet\n- [ ] real one\n';
        const items = parseActionItems(content);
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('real one');
    });

    it('parses unicode text', () => {
        const content = '# Action Items\n- [ ] 日本語のタスク 🎉 café\n';
        const items = parseActionItems(content);
        expect(items[0].text).toBe('日本語のタスク 🎉 café');
    });

    it('assigns distinct ids to duplicate text via the tiebreaker', () => {
        const content = '# Action Items\n- [ ] dup\n- [ ] dup\n';
        const items = parseActionItems(content);
        expect(items[0].id).not.toBe(items[1].id);
    });

    it('parses CRLF files without leaking the carriage return into text', () => {
        const content = '# Action Items\r\n- [ ] windows item\r\n';
        const items = parseActionItems(content);
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('windows item');
    });
});

describe('parseFollowUps', () => {
    it('parses the legacy default file grouped by person', () => {
        const items = parseFollowUps(DEFAULT_FOLLOW_UPS);
        expect(items).toHaveLength(1);
        expect(items[0].person).toBe('Example Person');
        expect(items[0].text).toBe('Waiting on reply about project timeline');
        expect(items[0].checked).toBe(false);
    });

    it('ignores the h1 title and groups under ## / ### headings', () => {
        const content = '# Follow Ups\n## Alice\n- [ ] a1\n### Bob\n- [ ] b1\n';
        const items = parseFollowUps(content);
        expect(items.map((i) => i.person)).toEqual(['Alice', 'Bob']);
    });

    it('gives duplicate text under different people distinct ids', () => {
        const content = '# Follow Ups\n## Alice\n- [ ] ping\n## Bob\n- [ ] ping\n';
        const items = parseFollowUps(content);
        expect(items[0].id).not.toBe(items[1].id);
    });
});

describe('addedAt from ## Synced headings', () => {
    // Fixed "today" so the year inference for the year-less `Mon D` format is
    // deterministic regardless of when the suite runs.
    const NOW = new Date(2026, 7, 12); // Aug 12, 2026 (local)

    it('stamps action items with the most recent sync date above them', () => {
        const content =
            '# Action Items\n- [ ] hand added\n\n## Synced Aug 3\n- [ ] older\n\n## Synced Aug 11\n- [ ] newer\n';
        const items = parseActionItems(content, NOW);
        expect(items.map((i) => [i.text, i.addedAt])).toEqual([
            ['hand added', undefined],
            ['older', '2026-08-03'],
            ['newer', '2026-08-11'],
        ]);
    });

    it('rolls a future-looking bare Mon D back to the previous year', () => {
        // Dec 20 read on Aug 12 can only mean last December.
        const items = parseActionItems('## Synced Dec 20\n- [ ] a\n', NOW);
        expect(items[0].addedAt).toBe('2025-12-20');
    });

    it('accepts an explicit year and an ISO date', () => {
        expect(parseActionItems('## Synced Aug 3, 2024\n- [ ] a\n', NOW)[0].addedAt).toBe(
            '2024-08-03',
        );
        expect(parseActionItems('## Synced 2023-01-09\n- [ ] a\n', NOW)[0].addedAt).toBe(
            '2023-01-09',
        );
    });

    it('leaves items undated when no sync heading precedes them', () => {
        const items = parseActionItems(DEFAULT_ACTION_ITEMS, NOW);
        expect(items[0].addedAt).toBeUndefined();
    });

    it('stamps follow-ups written as ### person under a ## Synced batch', () => {
        const content =
            '# Follow Ups\n## Synced Aug 5\n### Alice\n- [ ] a1\n### Bob\n- [ ] b1\n## Synced Aug 11\n### Alice\n- [ ] a2\n';
        const items = parseFollowUps(content, NOW);
        expect(items.map((i) => [i.person, i.text, i.addedAt])).toEqual([
            ['Alice', 'a1', '2026-08-05'],
            ['Bob', 'b1', '2026-08-05'],
            ['Alice', 'a2', '2026-08-11'],
        ]);
    });

    it('never treats a Synced heading as a person', () => {
        const content = '# Follow Ups\n## Synced Aug 9\n- [ ] no person heading\n';
        const items = parseFollowUps(content, NOW);
        expect(items[0].person).toBeUndefined();
        expect(items[0].addedAt).toBe('2026-08-09');
    });

    it('keeps an unparseable "Synced …" heading as a person', () => {
        // A real person could be headed `## Synced Systems Team`; only readable
        // dates are treated as batch boundaries.
        const content = '# Follow Ups\n## Synced Systems Team\n- [ ] a\n';
        const items = parseFollowUps(content, NOW);
        expect(items[0].person).toBe('Synced Systems Team');
        expect(items[0].addedAt).toBeUndefined();
    });

    it('does not stamp follow-ups that precede the first sync heading', () => {
        const items = parseFollowUps(DEFAULT_FOLLOW_UPS, NOW);
        expect(items[0].addedAt).toBeUndefined();
        expect(items[0].person).toBe('Example Person');
    });

    it('reads the sync date off a CRLF heading', () => {
        const items = parseActionItems('## Synced Aug 9\r\n- [ ] a\r\n', NOW);
        expect(items[0].addedAt).toBe('2026-08-09');
    });

    it('does not change the bytes written back by a patch under a sync heading', () => {
        const content = '# Action Items\n\n## Synced Aug 9\n- [ ] a\n- [ ] b\n';
        const id = parseActionItems(content, NOW)[0].id;
        const next = patchActionItem(content, id, { checked: true })!;
        expect(next).toBe('# Action Items\n\n## Synced Aug 9\n- [x] a\n- [ ] b\n');
    });
});

describe('parse (combined)', () => {
    it('returns both action items and follow-ups', () => {
        const result = parse(DEFAULT_ACTION_ITEMS, DEFAULT_FOLLOW_UPS);
        expect(result.actionItems).toHaveLength(1);
        expect(result.followUps).toHaveLength(1);
    });
});

describe('patchActionItem — minimal diff', () => {
    it('toggling one checkbox changes exactly one line', () => {
        const content = '# Action Items\n- [ ] a\n- [ ] b\n- [ ] c\n';
        const id = parseActionItems(content)[1].id;
        const next = patchActionItem(content, id, { checked: true })!;
        expect(next).not.toBeNull();
        expect(changedLineCount(content, next)).toBe(1);
        expect(parseActionItems(next)[1].checked).toBe(true);
    });

    it('toggling back restores the original bytes', () => {
        const content = '# Action Items\n- [ ] a\n- [ ] b\n';
        const id = parseActionItems(content)[0].id;
        const on = patchActionItem(content, id, { checked: true })!;
        const backId = parseActionItems(on)[0].id;
        const off = patchActionItem(on, backId, { checked: false })!;
        expect(off).toBe(content);
    });

    it('preserves CRLF endings when toggling', () => {
        const content = '# Action Items\r\n- [ ] a\r\n- [ ] b\r\n';
        const id = parseActionItems(content)[0].id;
        const next = patchActionItem(content, id, { checked: true })!;
        expect(next).toBe('# Action Items\r\n- [x] a\r\n- [ ] b\r\n');
    });

    it('edits text on exactly one line, preserving checkbox state', () => {
        const content = '# Action Items\n- [x] old text\n- [ ] other\n';
        const id = parseActionItems(content)[0].id;
        const next = patchActionItem(content, id, { text: 'new text' })!;
        expect(next).toBe('# Action Items\n- [x] new text\n- [ ] other\n');
    });

    it('returns null for an unknown id', () => {
        expect(patchActionItem(DEFAULT_ACTION_ITEMS, 'deadbeef0000', { checked: true })).toBeNull();
    });
});

describe('patchFollowUp', () => {
    it('toggles a follow-up by id, one line changed', () => {
        const content = '# Follow Ups\n## Alice\n- [ ] a1\n- [ ] a2\n';
        const id = parseFollowUps(content)[1].id;
        const next = patchFollowUp(content, id, { checked: true })!;
        expect(changedLineCount(content, next)).toBe(1);
        expect(parseFollowUps(next)[1].checked).toBe(true);
    });

    it('returns null for an unknown id', () => {
        expect(patchFollowUp(DEFAULT_FOLLOW_UPS, 'nope00000000', { checked: true })).toBeNull();
    });
});

describe('addActionItem', () => {
    it('appends a new unchecked item into the active region', () => {
        const { content, id } = addActionItem(DEFAULT_ACTION_ITEMS, 'brand new');
        const items = parseActionItems(content);
        expect(items.map((i) => i.text)).toContain('brand new');
        expect(items.find((i) => i.id === id)!.checked).toBe(false);
        // Preserves the existing item byte-for-byte.
        expect(content).toContain('- [ ] Example: Add your first action item');
    });

    it('inserts before an existing ## Archive section', () => {
        const content = '# Action Items\n- [ ] a\n\n## Archive\n- [x] old\n';
        const { content: next } = addActionItem(content, 'fresh');
        const archiveIdx = next.indexOf('## Archive');
        expect(next.indexOf('- [ ] fresh')).toBeLessThan(archiveIdx);
        expect(parseActionItems(next).map((i) => i.text)).toEqual(['a', 'fresh']);
    });

    it('preserves CRLF style for the inserted line', () => {
        const content = '# Action Items\r\n- [ ] a\r\n';
        const { content: next } = addActionItem(content, 'b');
        expect(next).toBe('# Action Items\r\n- [ ] a\r\n- [ ] b\r\n');
    });
});

describe('addFollowUp', () => {
    it('appends under an existing person', () => {
        const { content } = addFollowUp(DEFAULT_FOLLOW_UPS, 'Example Person', 'new ask');
        const items = parseFollowUps(content).filter((i) => i.person === 'Example Person');
        expect(items.map((i) => i.text)).toEqual(['Waiting on reply about project timeline', 'new ask']);
    });

    it('creates a new person heading when absent', () => {
        const { content, id } = addFollowUp(DEFAULT_FOLLOW_UPS, 'Dana', 'kickoff notes');
        expect(content).toContain('## Dana');
        const item = parseFollowUps(content).find((i) => i.id === id)!;
        expect(item.person).toBe('Dana');
        expect(item.text).toBe('kickoff notes');
    });
});

describe('archiveCheckedActionItems', () => {
    it('moves only checked items into ## Archive', () => {
        const content = '# Action Items\n- [ ] keep me\n- [x] archive me\n- [ ] keep me too\n- [x] and me\n';
        const { content: next, archived } = archiveCheckedActionItems(content);
        expect(archived).toBe(2);
        const active = parseActionItems(next);
        expect(active.map((i) => i.text)).toEqual(['keep me', 'keep me too']);
        expect(next).toContain('## Archive');
        // The archived lines are present after the archive header.
        const archiveSection = next.slice(next.indexOf('## Archive'));
        expect(archiveSection).toContain('- [x] archive me');
        expect(archiveSection).toContain('- [x] and me');
    });

    it('is a no-op when nothing is checked', () => {
        const content = '# Action Items\n- [ ] a\n- [ ] b\n';
        const { content: next, archived } = archiveCheckedActionItems(content);
        expect(archived).toBe(0);
        expect(next).toBe(content);
    });

    it('appends to an existing archive section', () => {
        const content = '# Action Items\n- [x] new done\n\n## Archive\n- [x] previously done\n';
        const { content: next, archived } = archiveCheckedActionItems(content);
        expect(archived).toBe(1);
        expect(parseActionItems(next)).toHaveLength(0);
        const archiveSection = next.slice(next.indexOf('## Archive'));
        expect(archiveSection).toContain('- [x] previously done');
        expect(archiveSection).toContain('- [x] new done');
    });
});

// ============================================================================
// Inline metadata — `@due(...)`, `#tag`, `[↗](url)`
// ============================================================================

describe('inline metadata', () => {
    const LINE = '- [ ] Send revised cutover plan @due(2026-08-14) #contoso [↗](https://teams.microsoft.com/l/message/19:abc)';

    it('extracts due, tags and source link, and keeps them out of the text', () => {
        const [item] = parseActionItems(`# Action Items\n${LINE}\n`);
        expect(item.text).toBe('Send revised cutover plan');
        expect(item.due).toBe('2026-08-14');
        expect(item.tags).toEqual(['contoso']);
        expect(item.sourceUrl).toBe('https://teams.microsoft.com/l/message/19:abc');
    });

    it('reads the same metadata on follow-up lines', () => {
        const content = '# Follow Ups\n## Priya\n- [ ] cutover sign-off #contoso @due(2026-09-01)\n';
        const [item] = parseFollowUps(content);
        expect(item.person).toBe('Priya');
        expect(item.text).toBe('cutover sign-off');
        expect(item.due).toBe('2026-09-01');
        expect(item.tags).toEqual(['contoso']);
    });

    it('collects several tags in order and drops duplicates', () => {
        const [item] = parseActionItems('- [ ] triage #alpha #beta #alpha\n');
        expect(item.tags).toEqual(['alpha', 'beta']);
        expect(item.text).toBe('triage');
    });

    it('reads metadata written anywhere on the line, not just at the end', () => {
        const [item] = parseActionItems('- [ ] @due(2026-01-02) ping #ops Priya\n');
        expect(item.due).toBe('2026-01-02');
        expect(item.tags).toEqual(['ops']);
        expect(item.text).toBe('ping Priya');
    });

    it('leaves items with no metadata exactly as before (fields absent)', () => {
        const [item] = parseActionItems(DEFAULT_ACTION_ITEMS);
        expect(item.text).toBe('Example: Add your first action item');
        expect(item.due).toBeUndefined();
        expect(item.tags).toBeUndefined();
        expect(item.sourceUrl).toBeUndefined();
    });

    it('preserves the exact spacing of a line that carries no metadata', () => {
        const [item] = parseActionItems('- [ ] two  spaces   kept\n');
        expect(item.text).toBe('two  spaces   kept');
    });

    it('ignores a url fragment and an email-ish @ that are not metadata', () => {
        const [item] = parseActionItems('- [ ] read https://example.com/doc#section with a@b.com\n');
        expect(item.tags).toBeUndefined();
        expect(item.due).toBeUndefined();
        expect(item.text).toBe('read https://example.com/doc#section with a@b.com');
    });

    it('leaves an ordinary markdown link in the text — only `↗` is a source link', () => {
        const [item] = parseActionItems('- [ ] see [the doc](https://example.com/d)\n');
        expect(item.sourceUrl).toBeUndefined();
        expect(item.text).toBe('see [the doc](https://example.com/d)');
    });

    it('ignores a malformed due date, leaving it in the text', () => {
        const [item] = parseActionItems('- [ ] ship it @due(next tuesday)\n');
        expect(item.due).toBeUndefined();
        expect(item.text).toBe('ship it @due(next tuesday)');
    });

    it('carries metadata and the sync date together', () => {
        const content = '# Action Items\n\n## Synced Aug 10, 2026\n- [ ] nudge Priya @due(2026-08-14) #contoso\n';
        const [item] = parseActionItems(content, new Date('2026-08-12T12:00:00Z'));
        expect(item.addedAt).toBe('2026-08-10');
        expect(item.due).toBe('2026-08-14');
    });

    it('reads metadata on CRLF lines without swallowing the carriage return', () => {
        const content = '# Action Items\r\n- [ ] plan @due(2026-08-14) #contoso [↗](https://x.test/a)\r\n';
        const [item] = parseActionItems(content);
        expect(item.text).toBe('plan');
        expect(item.due).toBe('2026-08-14');
        expect(item.sourceUrl).toBe('https://x.test/a');
        // Toggling rewrites one line and keeps CRLF endings intact.
        const next = patchActionItem(content, item.id, { checked: true })!;
        expect(next).toBe('# Action Items\r\n- [x] plan @due(2026-08-14) #contoso [↗](https://x.test/a)\r\n');
    });
});

describe('metadata round-trip through patch', () => {
    const CONTENT = '# Action Items\n- [ ] cutover plan @due(2026-08-14) #contoso [↗](https://x.test/t)\n';

    it('toggling preserves the raw metadata byte-for-byte', () => {
        const [item] = parseActionItems(CONTENT);
        const next = patchActionItem(CONTENT, item.id, { checked: true })!;
        expect(next).toBe('# Action Items\n- [x] cutover plan @due(2026-08-14) #contoso [↗](https://x.test/t)\n');
        expect(changedLineCount(CONTENT, next)).toBe(1);

        const [after] = parseActionItems(next);
        expect(after.checked).toBe(true);
        expect(after.due).toBe('2026-08-14');
        expect(after.tags).toEqual(['contoso']);
        expect(after.sourceUrl).toBe('https://x.test/t');
    });

    it('editing the text re-attaches the metadata rather than dropping it', () => {
        const [item] = parseActionItems(CONTENT);
        // The client only ever has the stripped display text to send back.
        const next = patchActionItem(CONTENT, item.id, { text: 'revised cutover plan' })!;
        expect(next).toBe('# Action Items\n- [ ] revised cutover plan @due(2026-08-14) #contoso [↗](https://x.test/t)\n');

        const [after] = parseActionItems(next);
        expect(after.text).toBe('revised cutover plan');
        expect(after.sourceUrl).toBe('https://x.test/t');
    });

    it('metadata typed into the replacement text wins field by field', () => {
        const [item] = parseActionItems(CONTENT);
        const next = patchActionItem(CONTENT, item.id, { text: 'cutover plan @due(2026-09-01)' })!;
        const [after] = parseActionItems(next);
        // The typed due date replaces the old one...
        expect(after.due).toBe('2026-09-01');
        // ...but the fields it said nothing about survive. Merging per field
        // rather than wholesale is what keeps inline edit from silently
        // throwing away the source link — the one thing on the line that makes
        // the item actionable without going to hunt for its thread.
        expect(after.sourceUrl).toBe('https://x.test/t');
        expect(after.tags).toEqual(['contoso']);
    });

    it('lets an edit add a tag to an item without disturbing its due date', () => {
        const [item] = parseActionItems(CONTENT);
        const next = patchActionItem(CONTENT, item.id, { text: 'cutover plan #urgent' })!;
        const [after] = parseActionItems(next);
        expect(after.due).toBe('2026-08-14');
        expect(after.tags).toEqual(['urgent']);
        expect(after.sourceUrl).toBe('https://x.test/t');
    });

    it('editing a plain item is unchanged — no metadata appears from nowhere', () => {
        const content = '# Action Items\n- [ ] plain item\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { text: 'renamed item' })!;
        expect(next).toBe('# Action Items\n- [ ] renamed item\n');
    });

    it('archiving moves the line with its metadata intact', () => {
        const { content: next } = archiveCheckedActionItems(
            '# Action Items\n- [x] done thing @due(2026-08-01) #ops [↗](https://x.test/d)\n',
        );
        const archiveSection = next.slice(next.indexOf('## Archive'));
        expect(archiveSection).toContain('- [x] done thing @due(2026-08-01) #ops [↗](https://x.test/d)');
    });
});

describe('snooze — the `due` patch', () => {
    // Snooze is a `@due()` bump and nothing else: the text, the tags and the
    // link are the user's, so a deferral must not touch them. It exists so an
    // item can leave the list without being ticked — the same files are what
    // the weekly summary reads `- [x]` lines out of, and a box ticked for
    // something undone writes a false "Completed" into that report.

    it('adds a due date to a line that has none', () => {
        const content = '# Action Items\n- [ ] chase the cutover sign-off\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { due: '2026-08-13' })!;
        expect(next).toBe('# Action Items\n- [ ] chase the cutover sign-off @due(2026-08-13)\n');
        expect(changedLineCount(content, next)).toBe(1);
        expect(parseActionItems(next)[0].due).toBe('2026-08-13');
    });

    it('moves an existing due date without duplicating the token', () => {
        const content = '- [ ] ship @due(2026-08-12)\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { due: '2026-08-19' })!;
        expect(next).toBe('- [ ] ship @due(2026-08-19)\n');
        expect(next.match(/@due\(/g)).toHaveLength(1);
    });

    it('keeps the text, tags and source link intact across a bump', () => {
        const content = '- [ ] cutover plan @due(2026-08-14) #contoso [↗](https://x.test/t)\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { due: '2026-08-21' })!;
        const [after] = parseActionItems(next);
        expect(after.text).toBe('cutover plan');
        expect(after.due).toBe('2026-08-21');
        expect(after.tags).toEqual(['contoso']);
        expect(after.sourceUrl).toBe('https://x.test/t');
    });

    it('clears the due date with null', () => {
        const content = '- [ ] ship @due(2026-08-12) #ops\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { due: null })!;
        expect(next).toBe('- [ ] ship #ops\n');
        expect(parseActionItems(next)[0].due).toBeUndefined();
    });

    it('drops the item out of the urgent bucket — the whole point', () => {
        // Bucketing lives in the client, but the server side of it is that the
        // date on disk is the one the client will read back.
        const content = '- [ ] nudge Priya @due(2026-08-10)\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { due: '2026-08-19' })!;
        expect(parseActionItems(next)[0].due).toBe('2026-08-19');
    });

    it('changes the id, and the pre-bump id no longer resolves', () => {
        const content = '- [ ] ship @due(2026-08-12)\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { due: '2026-08-19' })!;
        const [after] = parseActionItems(next);
        expect(after.id).not.toBe(item.id);
        // Stale id → null, not a silent write to the wrong line. The client
        // refetches after every mutation, which is what keeps this safe.
        expect(patchActionItem(next, item.id, { due: '2026-09-01' })).toBeNull();
    });

    it('snoozes a follow-up the same way', () => {
        const content = '# Follow Ups\n## Priya\n- [ ] cutover sign-off\n';
        const [item] = parseFollowUps(content);
        const next = patchFollowUp(content, item.id, { due: '2026-08-19' })!;
        expect(next).toBe('# Follow Ups\n## Priya\n- [ ] cutover sign-off @due(2026-08-19)\n');
        expect(parseFollowUps(next)[0].person).toBe('Priya');
    });

    it('preserves CRLF and every other line byte-for-byte', () => {
        const content = '# Action Items\r\n- [ ] first\r\n- [ ] second @due(2026-08-12)\r\n- [x] third\r\n';
        const target = parseActionItems(content)[1];
        const next = patchActionItem(content, target.id, { due: '2026-08-20' })!;
        expect(next).toBe('# Action Items\r\n- [ ] first\r\n- [ ] second @due(2026-08-20)\r\n- [x] third\r\n');
        expect(changedLineCount(content, next)).toBe(1);
    });

    it('preserves indentation on a nested item', () => {
        const content = '- [ ] parent\n    - [ ] nested item\n';
        const target = parseActionItems(content)[1];
        const next = patchActionItem(content, target.id, { due: '2026-08-20' })!;
        expect(next).toBe('- [ ] parent\n    - [ ] nested item @due(2026-08-20)\n');
    });

    it('combines with a check in one write', () => {
        const content = '- [ ] ship\n';
        const [item] = parseActionItems(content);
        const next = patchActionItem(content, item.id, { checked: true, due: '2026-08-20' })!;
        expect(next).toBe('- [x] ship @due(2026-08-20)\n');
    });
});

describe('id hashing over metadata', () => {
    // The id hashes the RAW line, metadata included. These tests pin that
    // choice: it keeps otherwise-identical items distinct, at the cost of the
    // id changing when metadata changes — which is fine, because an id is a
    // within-snapshot addressing token and the client refetches after a write.

    it('gives distinct ids to items that differ only in their source link', () => {
        const items = parseActionItems(
            '- [ ] follow up on cutover [↗](https://x.test/a)\n- [ ] follow up on cutover [↗](https://x.test/b)\n',
        );
        expect(items).toHaveLength(2);
        expect(items[0].id).not.toBe(items[1].id);
        // Both show the same display text; only the link tells them apart.
        expect(items.map((i) => i.text)).toEqual(['follow up on cutover', 'follow up on cutover']);
        // And each id still addresses its own line.
        const next = patchActionItem(
            '- [ ] follow up on cutover [↗](https://x.test/a)\n- [ ] follow up on cutover [↗](https://x.test/b)\n',
            items[1].id,
            { checked: true },
        )!;
        expect(next).toBe('- [ ] follow up on cutover [↗](https://x.test/a)\n- [x] follow up on cutover [↗](https://x.test/b)\n');
    });

    it('keeps ids byte-identical to the no-metadata baseline', () => {
        // Same file, parsed before and after this feature: an item with no
        // metadata must keep the id it always had.
        const [item] = parseActionItems(DEFAULT_ACTION_ITEMS);
        expect(item.id).toBe(
            parseActionItems('- [ ] Example: Add your first action item\n')[0].id,
        );
    });

    it('changes the id when the due date changes, and the new id addresses the line', () => {
        const before = '- [ ] ship @due(2026-08-14)\n';
        const after = '- [ ] ship @due(2026-09-01)\n';
        const idBefore = parseActionItems(before)[0].id;
        const idAfter = parseActionItems(after)[0].id;
        expect(idAfter).not.toBe(idBefore);
        // The stale id is simply not found — the caller refetches, it does not
        // silently patch the wrong line.
        expect(patchActionItem(after, idBefore, { checked: true })).toBeNull();
        expect(patchActionItem(after, idAfter, { checked: true })).toBe('- [x] ship @due(2026-09-01)\n');
    });
});

describe('formatTaskLine', () => {
    it('writes a bare line when there is no metadata', () => {
        expect(formatTaskLine('Send the spec')).toBe('- [ ] Send the spec');
    });

    it('writes metadata in canonical order', () => {
        expect(
            formatTaskLine('Send the spec', {
                due: '2026-08-14',
                tags: ['contoso', 'urgent'],
                sourceUrl: 'https://x.test/a',
            }),
        ).toBe('- [ ] Send the spec @due(2026-08-14) #contoso #urgent [↗](https://x.test/a)');
    });

    it('round-trips back through the parser', () => {
        const line = formatTaskLine('Send the spec', {
            due: '2026-08-14',
            tags: ['contoso'],
            sourceUrl: 'https://x.test/a',
        });
        const [item] = parseActionItems(`${line}\n`);
        expect(item.text).toBe('Send the spec');
        expect(item.due).toBe('2026-08-14');
        expect(item.tags).toEqual(['contoso']);
        expect(item.sourceUrl).toBe('https://x.test/a');
    });

    it('collapses newlines so one item cannot become two lines', () => {
        expect(formatTaskLine('first\nsecond')).toBe('- [ ] first second');
        expect(formatTaskLine('sneaky\n## Archive')).toBe('- [ ] sneaky ## Archive');
    });

    it('percent-encodes parens in a url so the link cannot be terminated early', () => {
        const line = formatTaskLine('doc', { sourceUrl: 'https://x.test/a(b)c' });
        expect(line).toBe('- [ ] doc [↗](https://x.test/a%28b%29c)');
        expect(parseActionItems(`${line}\n`)[0].sourceUrl).toBe('https://x.test/a%28b%29c');
    });

    it('strips a leading # a caller left on a tag', () => {
        expect(formatTaskLine('x', { tags: ['#ops'] })).toBe('- [ ] x #ops');
    });
});
