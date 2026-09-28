/**
 * Tests for comment placement and view-zone bookkeeping in the Monaco diff
 * editor (AC-05). Cross-engine parity uses real `git diff` output for the
 * classic rows and `git diff -U0` for Monaco-shaped line changes.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeDiffLines, type DiffLine } from '../../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import {
    createDiffLineIndexResolver,
    monacoToSelection,
    textInRange,
    createLineSource,
    threadZoneAnchor,
    type DiffLineChange,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import {
    buildCommentDecorations,
    createCommentZoneManager,
    INITIAL_THREAD_ZONE_HEIGHT,
    isThreadInitiallyExpanded,
    placeDiffComments,
    type PlacedCommentThread,
} from '../../../../../../src/server/spa/client/react/features/git/diff/monacoCommentThreads';
import type { DiffComment, DiffCommentSelection } from '../../../../../../src/server/spa/client/comments/diff-comment-types';
import { createFakeDiffEditor } from './fakeDiffEditorAdapter';
import { createGitDiffFixture } from './gitDiffFixture';

/** The anchor hash `relocateDiffAnchor` compares against (djb2, base 36). */
function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

const fixture = createGitDiffFixture('monaco-comments-');
afterAll(() => fixture.dispose());

const ORIGINAL = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'].join('\n') + '\n';
const MODIFIED = ['alpha', 'BETA', 'gamma', 'delta', 'epsilon', 'new-1', 'new-2', 'zeta', 'eta', 'iota', 'kappa'].join('\n') + '\n';

function comment(id: string, selection: Partial<DiffCommentSelection>, extra: Partial<DiffComment> = {}): DiffComment {
    return {
        id,
        context: { repositoryId: 'ws', filePath: '/r/f.ts', oldRef: 'INDEX', newRef: 'working-tree' },
        selection: {
            diffLineStart: -1, diffLineEnd: -1, side: 'context',
            oldLineStart: NaN, oldLineEnd: NaN, newLineStart: NaN, newLineEnd: NaN,
            startColumn: 0, endColumn: 1,
            ...selection,
        },
        selectedText: 'x',
        comment: `comment ${id}`,
        status: 'open',
        createdAt: `2026-01-01T00:00:0${id.length % 10}Z`,
        updatedAt: '2026-01-01T00:00:00Z',
        ...extra,
    };
}

/** The selection the classic viewer stores for a single rendered row. */
function classicSelection(row: DiffLine): DiffCommentSelection {
    return {
        diffLineStart: row.index,
        diffLineEnd: row.index,
        side: row.type as 'added' | 'removed' | 'context',
        oldLineStart: row.oldLine ?? NaN,
        oldLineEnd: row.oldLine ?? NaN,
        newLineStart: row.newLine ?? NaN,
        newLineEnd: row.newLine ?? NaN,
        startColumn: 0,
        endColumn: row.content.length,
    };
}

function classicRows(original: string, modified: string): DiffLine[] {
    return computeDiffLines(fixture.gitDiff(original, modified, 3))
        .filter(line => line.oldLine !== undefined || line.newLine !== undefined);
}

const FIXTURES: Record<string, [string, string]> = {
    'added, removed and context': [ORIGINAL, MODIFIED],
    'CRLF': [ORIGINAL.replace(/\n/g, '\r\n'), MODIFIED.replace(/\n/g, '\r\n')],
    'no trailing newline': [ORIGINAL.trimEnd(), MODIFIED.trimEnd()],
    'unicode': ['a\n😀 smile\nc\nd\n', 'a\n😀 smiles\nc\né\n'],
    'deletion at top': ['one\ntwo\nthree\nfour\n', 'three\nfour\n'],
};

describe('cross-engine placement', () => {
    for (const [name, [original, modified]] of Object.entries(FIXTURES)) {
        it(`classic rows land on the same source line in Monaco and back (${name})`, () => {
            const rows = classicRows(original, modified);
            const lineChanges = fixture.lineChangesFromGit(original, modified);
            const resolver = createDiffLineIndexResolver(rows);
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                // Classic → Monaco
                const [placed] = placeDiffComments({
                    comments: [comment('c', classicSelection(row))], original, modified, lineChanges, viewMode: 'split',
                });
                expect(placed.status).toBe('exact');
                const { range } = placed as PlacedCommentThread;
                const expectedSide = row.type === 'removed' ? 'original' : 'modified';
                const expectedLine = row.type === 'removed' ? row.oldLine : row.newLine;
                expect({ side: range.side, line: range.startLineNumber }).toEqual({ side: expectedSide, line: expectedLine });

                // Monaco → Classic
                const back = monacoToSelection(range.side, range, { lineChanges, diffLineIndexOf: resolver });
                expect({ side: back.side, row: back.diffLineStart }).toEqual({ side: row.type, row: row.index });
                expect(back.oldLineStart ?? NaN).toEqual(row.oldLine ?? NaN);
                expect(back.newLineStart ?? NaN).toEqual(row.newLine ?? NaN);
            }
        });
    }

    it('an off-by-one in the line changes is detected', () => {
        const rows = classicRows(ORIGINAL, MODIFIED);
        const shifted: DiffLineChange[] = fixture.lineChangesFromGit(ORIGINAL, MODIFIED).map(c => ({
            ...c, modifiedStartLineNumber: c.modifiedStartLineNumber + 1, modifiedEndLineNumber: c.modifiedEndLineNumber + 1,
        }));
        const resolver = createDiffLineIndexResolver(rows);
        const mismatches = rows.filter(row => {
            const side = row.type === 'removed' ? 'original' : 'modified';
            const line = (side === 'original' ? row.oldLine : row.newLine)!;
            const back = monacoToSelection(side, { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, { lineChanges: shifted, diffLineIndexOf: resolver });
            return back.side !== row.type;
        });
        expect(mismatches.length).toBeGreaterThan(0);
    });
});

describe('placeDiffComments', () => {
    const lineChanges = () => fixture.lineChangesFromGit(ORIGINAL, MODIFIED);

    it('puts a thread below the last line of its range on its own side in split view', () => {
        const [p] = placeDiffComments({
            comments: [comment('r', { side: 'removed', oldLineStart: 2, oldLineEnd: 2 })],
            original: ORIGINAL, modified: MODIFIED, lineChanges: lineChanges(), viewMode: 'split',
        }) as PlacedCommentThread[];
        expect(p.zone).toEqual({ side: 'original', afterLineNumber: 2 });
    });

    it('moves original-side threads onto the modified editor in unified view', () => {
        const placed = placeDiffComments({
            comments: [
                // removed "beta", replaced by "BETA" (modified line 2)
                comment('r', { side: 'removed', oldLineStart: 2, oldLineEnd: 2 }),
                // removed "theta" (original line 8), a pure deletion after modified line 9
                comment('d', { side: 'removed', oldLineStart: 8, oldLineEnd: 8 }),
            ],
            original: ORIGINAL, modified: MODIFIED, lineChanges: lineChanges(), viewMode: 'unified',
        }) as PlacedCommentThread[];
        expect(placed.map(p => [p.comment.id, p.range.side, p.zone])).toEqual([
            ['r', 'original', { side: 'modified', afterLineNumber: 2 }],
            ['d', 'original', { side: 'modified', afterLineNumber: 9 }],
        ]);
    });

    it('orders threads by side, line and age, and lists orphans last', () => {
        const placed = placeDiffComments({
            comments: [
                comment('m9', { side: 'context', newLineStart: 9, newLineEnd: 9 }),
                comment('orph', { side: 'context', newLineStart: 1, newLineEnd: 1 }, { status: 'orphaned' }),
                comment('m1', { side: 'context', newLineStart: 1, newLineEnd: 1 }),
                comment('o2', { side: 'removed', oldLineStart: 2, oldLineEnd: 2 }),
            ],
            original: ORIGINAL, modified: MODIFIED, lineChanges: lineChanges(), viewMode: 'split',
        });
        expect(placed.map(p => [p.comment.id, p.status])).toEqual([
            ['o2', 'exact'], ['m1', 'exact'], ['m9', 'exact'], ['orph', 'orphaned'],
        ]);
    });

    it('recovers a legacy comment by fingerprint and orphans one whose text is gone', () => {
        const anchor = (text: string) => ({
            selectedText: text, contextBefore: '', contextAfter: '', originalLine: 1, textHash: 'h',
        });
        const placed = placeDiffComments({
            comments: [
                comment('legacy', { diffLineStart: 3, diffLineEnd: 3 }, { anchor: { ...anchor('epsilon'), textHash: hashText('epsilon') } }),
                comment('gone', { diffLineStart: 3, diffLineEnd: 3 }, { anchor: anchor('no such text') as DiffComment['anchor'] }),
            ],
            original: ORIGINAL, modified: MODIFIED, lineChanges: lineChanges(), viewMode: 'split',
        });
        expect(placed.map(p => [p.comment.id, p.status])).toEqual([['legacy', 'recovered'], ['gone', 'orphaned']]);
        expect((placed[0] as PlacedCommentThread).range.startLineNumber).toBe(5);
    });

    it('never throws for a comment past the end of the file (working-tree change)', () => {
        const [p] = placeDiffComments({
            comments: [comment('far', { side: 'added', newLineStart: 500, newLineEnd: 501 })],
            original: ORIGINAL, modified: MODIFIED, lineChanges: lineChanges(), viewMode: 'split',
        }) as PlacedCommentThread[];
        expect(p.status).toBe('exact');
        expect(p.range.endLineNumber).toBe(createLineSource(MODIFIED).getLineCount());
    });

    it('does not change the persisted selection', () => {
        const c = comment('keep', { side: 'added', newLineStart: 6, newLineEnd: 7, diffLineStart: 9, diffLineEnd: 10 });
        const before = JSON.stringify(c);
        placeDiffComments({ comments: [c], original: ORIGINAL, modified: MODIFIED, lineChanges: lineChanges(), viewMode: 'unified' });
        expect(JSON.stringify(c)).toBe(before);
    });
});

describe('threadZoneAnchor', () => {
    it('puts a removed line with no counterpart at the top when nothing precedes it', () => {
        const changes = fixture.lineChangesFromGit('one\ntwo\nthree\n', 'three\n');
        expect(threadZoneAnchor({ side: 'original', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, 'unified', changes))
            .toEqual({ side: 'modified', afterLineNumber: 0 });
    });
});

describe('textInRange', () => {
    it('slices single- and multi-line ranges by UTF-16 columns', () => {
        const source = createLineSource('ab😀cd\nxyz\n');
        expect(textInRange(source, { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 5 })).toBe('😀');
        expect(textInRange(source, { startLineNumber: 1, startColumn: 5, endLineNumber: 2, endColumn: 3 })).toBe('cd\nxy');
    });
});

describe('buildCommentDecorations / expansion', () => {
    it('marks open, resolved and recovered ranges and skips orphans', () => {
        const decorations = buildCommentDecorations([
            { comment: comment('a', {}), status: 'exact', range: { side: 'modified', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 }, zone: { side: 'modified', afterLineNumber: 1 } },
            { comment: comment('b', {}, { status: 'resolved' }), status: 'exact', range: { side: 'original', startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 3 }, zone: { side: 'original', afterLineNumber: 2 } },
            { comment: comment('c', {}), status: 'recovered', range: { side: 'modified', startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 3 }, zone: { side: 'modified', afterLineNumber: 3 } },
            { comment: comment('d', {}), status: 'orphaned' },
        ]);
        expect(decorations.map(d => [d.side, d.range.startLineNumber, d.kind])).toEqual([
            ['modified', 1, 'open'], ['original', 2, 'resolved'], ['modified', 3, 'recovered'],
        ]);
    });

    it('opens unresolved threads and collapses resolved ones', () => {
        expect(isThreadInitiallyExpanded({ status: 'open' })).toBe(true);
        expect(isThreadInitiallyExpanded({ status: 'resolved' })).toBe(false);
    });
});

describe('createCommentZoneManager', () => {
    const setup = () => {
        const fake = createFakeDiffEditor();
        const createNode = vi.fn(() => document.createElement('div'));
        const manager = createCommentZoneManager(fake.adapter, createNode);
        return { fake, manager, createNode };
    };
    const adds = (fake: ReturnType<typeof createFakeDiffEditor>) => fake.zoneLog.filter(e => e.op === 'add').length;

    it('adds one zone per thread and is idempotent', () => {
        const { fake, manager } = setup();
        const entries = [
            { id: 'a', anchor: { side: 'modified' as const, afterLineNumber: 3 } },
            { id: 'b', anchor: { side: 'original' as const, afterLineNumber: 1 } },
        ];
        const first = manager.sync(entries);
        const second = manager.sync(entries);
        expect(second).toBe(first);
        expect(adds(fake)).toBe(2);
        expect([...fake.zones.values()].map(z => [z.side, z.afterLineNumber, z.heightInPx]))
            .toEqual([['modified', 3, INITIAL_THREAD_ZONE_HEIGHT], ['original', 1, INITIAL_THREAD_ZONE_HEIGHT]]);
        expect([...fake.zones.values()].map(z => z.domNode)).toEqual([first.get('a'), first.get('b')]);
    });

    it('moves a zone (view-mode switch) while keeping its DOM node and height', () => {
        const { fake, manager, createNode } = setup();
        const nodes = manager.sync([{ id: 'a', anchor: { side: 'original', afterLineNumber: 2 } }]);
        manager.setHeight('a', 120);
        const moved = manager.sync([{ id: 'a', anchor: { side: 'modified', afterLineNumber: 2 } }]);
        expect(moved.get('a')).toBe(nodes.get('a'));
        expect(createNode).toHaveBeenCalledTimes(1);
        expect(fake.zones.size).toBe(1);
        expect([...fake.zones.values()][0]).toMatchObject({ side: 'modified', heightInPx: 120 });
    });

    it('relayouts only when the measured height changes', () => {
        const { fake, manager } = setup();
        manager.sync([{ id: 'a', anchor: { side: 'modified', afterLineNumber: 1 } }]);
        manager.setHeight('a', 80);
        manager.setHeight('a', 80);
        manager.setHeight('unknown', 50);
        expect(fake.zoneLog.filter(e => e.op === 'layout')).toEqual([{ op: 'layout', id: 'zone-1', side: 'modified', heightInPx: 80 }]);
    });

    it('re-adds zones after a model swap without removing ids the editor already dropped', () => {
        const { fake, manager } = setup();
        const entries = [{ id: 'a', anchor: { side: 'modified' as const, afterLineNumber: 1 } }];
        manager.sync(entries);
        fake.adapter.setModels(fake.models[0] ?? ({} as never));
        manager.invalidate();
        manager.sync(entries);
        expect(fake.zoneLog.map(e => e.op)).toEqual(['add', 'add']);
        expect(fake.zones.size).toBe(1);
    });

    it('removes zones for deleted threads and all zones on dispose', () => {
        const { fake, manager } = setup();
        manager.sync([
            { id: 'a', anchor: { side: 'modified', afterLineNumber: 1 } },
            { id: 'b', anchor: { side: 'modified', afterLineNumber: 2 } },
        ]);
        const after = manager.sync([{ id: 'b', anchor: { side: 'modified', afterLineNumber: 2 } }]);
        expect([...after.keys()]).toEqual(['b']);
        expect(fake.zones.size).toBe(1);
        manager.dispose();
        manager.dispose();
        expect(fake.zones.size).toBe(0);
        expect(manager.sync([{ id: 'c', anchor: { side: 'modified', afterLineNumber: 1 } }]).size).toBe(0);
        expect(fake.zones.size).toBe(0);
    });
});

describe('source assertions', () => {
    const diffDir = join(__dirname, '../../../../../../src/server/spa/client/react/features/git/diff');
    const read = (file: string) => readFileSync(join(diffDir, file), 'utf8');

    it('keeps line arithmetic in diffCoords: comment modules only call it', () => {
        for (const file of ['monacoCommentThreads.ts', 'MonacoDiffCommentLayer.tsx']) {
            const src = read(file);
            expect(src).not.toMatch(/LineNumber\s*[+-]\s*\d/);
            expect(src).not.toMatch(/\b(oldLine|newLine)(Start|End)\b\s*[+-]/);
            expect(src).not.toMatch(/TODO|FIXME/);
        }
    });

    it('has no runtime Monaco import in the comment modules', () => {
        for (const file of ['monacoCommentThreads.ts', 'MonacoDiffCommentLayer.tsx']) {
            expect(read(file).split('\n').some(l => /^import\s+(?!type\b).*['"]monaco-editor/.test(l))).toBe(false);
        }
    });
});
