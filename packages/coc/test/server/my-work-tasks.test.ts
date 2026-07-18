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
