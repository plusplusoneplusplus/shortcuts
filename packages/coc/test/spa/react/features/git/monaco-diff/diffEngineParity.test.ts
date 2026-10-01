/**
 * Classic ↔ Monaco parity for persisted diff-comment coordinates (AC-08).
 * Real `git diff` output feeds both engines through the shared fixtures in
 * `diffEngineParityFixtures.ts`; no browser or Monaco runtime is involved.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { relocateDiffAnchor } from '../../../../../../src/server/spa/client/react/utils/relocateDiffAnchor';
import {
    createDiffLineIndexResolver,
    monacoToSelection,
    selectionToMonaco,
    sideForSelection,
    textInRange,
} from '../../../../../../src/server/spa/client/react/features/git/diff/diffCoords';
import type { DiffCommentSelection } from '../../../../../../src/server/spa/client/comments/diff-comment-types';
import { createGitDiffFixture } from './gitDiffFixture';
import {
    PARITY_CASES,
    buildParityContext,
    classicSelection,
    enumerateRowSelections,
    equivalentMonacoRange,
    expectSelectionParity,
    persistedFields,
    type ParityContext,
} from '../../../diffEngineParityFixtures';

const git = createGitDiffFixture('diff-engine-parity-');
afterAll(() => git.dispose());

/** Row text as the Classic viewer shows it: no `+`/`-`/` ` prefix, no CR. */
function visibleText(content: string): string {
    return content.slice(1).replace(/\r$/, '');
}

describe('diff-engine parity fixtures', () => {
    it('cover every required case', () => {
        const names = PARITY_CASES.map(c => c.name).join('|');
        for (const needed of ['added', 'removed', 'context', 'CRLF', 'trailing newline', 'unicode']) {
            expect(names).toContain(needed);
        }
        const context = buildParityContext(git, PARITY_CASES.find(c => c.name === 'CRLF')!);
        expect(context.original).toContain('\r\n');
        expect(context.sources.original.getLineContent(1)).toBe('alpha');
    });
});

describe.each(PARITY_CASES)('parity: $name', (testCase) => {
    let context: ParityContext;
    const ctx = () => (context ??= buildParityContext(git, testCase));

    it('persists identical fields for every single- and multi-line selection', () => {
        const selections = enumerateRowSelections(ctx());
        expect(selections.some(s => s.end > s.start)).toBe(true);
        const kinds = new Set(selections.map(s => ctx().rows[s.start].type));
        expect(kinds.size).toBeGreaterThan(1);
        for (const selection of selections) {
            expectSelectionParity(ctx(), selection);
        }
    });

    it('selects the same text in both engines (UTF-16 columns)', () => {
        for (const selection of enumerateRowSelections(ctx()).filter(s => s.start === s.end)) {
            const range = equivalentMonacoRange(ctx().rows, selection)!;
            const classicText = visibleText(ctx().rows[selection.start].content).slice(selection.startColumn, selection.endColumn);
            expect(textInRange(ctx().sources[range.side], range)).toBe(classicText);
        }
    });

    it('recovers legacy anchors to the same source line in both engines', () => {
        const { rows, sources, lineChanges } = ctx();
        for (const text of testCase.legacyAnchors ?? []) {
            const matches = rows.filter(row => row.type !== 'hunk-header' && visibleText(row.content).includes(text));
            expect(matches, text).toHaveLength(1);
            const target = matches[0];
            const legacy: DiffCommentSelection = {
                diffLineStart: 0, diffLineEnd: 0,
                side: target.type as DiffCommentSelection['side'],
                oldLineStart: NaN, oldLineEnd: NaN, newLineStart: NaN, newLineEnd: NaN,
                startColumn: 0, endColumn: text.length,
            };
            const anchor = { selectedText: text, contextBefore: '', contextAfter: '', originalLine: 0, textHash: 'stale' };

            // Classic: re-match against rendered rows.
            const classicIndex = relocateDiffAnchor({ anchor, selection: legacy }, rows);
            expect(classicIndex, text).toBe(target.index);

            // Monaco: recover from the side's text.
            const placed = selectionToMonaco(legacy, { ...sources, anchor });
            expect(placed.status, text).toBe('recovered');
            if (placed.status !== 'recovered') {continue;}
            const side = sideForSelection(legacy);
            expect(placed.range.side).toBe(side);
            expect(placed.range.startLineNumber).toBe(side === 'original' ? target.oldLine : target.newLine);
            expect(textInRange(sources[side], placed.range)).toBe(text);

            const monaco = monacoToSelection(side, placed.range, { lineChanges, diffLineIndexOf: createDiffLineIndexResolver(rows) });
            const classic = classicSelection(rows, { start: classicIndex!, end: classicIndex!, startColumn: placed.range.startColumn - 1, endColumn: placed.range.endColumn - 1 });
            expect(persistedFields(monaco), text).toEqual(persistedFields(classic));
        }
    });
});

describe('parity negative fixtures', () => {
    const testCase = PARITY_CASES.find(c => c.name === 'added, removed and context')!;

    it('fails the parity assertion when the Monaco range is off by one line', () => {
        const context = buildParityContext(git, testCase);
        const failures = enumerateRowSelections(context).filter((selection) => {
            try {
                expectSelectionParity(context, selection, {
                    mapRange: range => ({ ...range, startLineNumber: range.startLineNumber + 1, endLineNumber: range.endLineNumber + 1 }),
                });
                return false;
            } catch {
                return true;
            }
        });
        expect(failures).toHaveLength(enumerateRowSelections(context).length);
    });

    it('fails the parity assertion when the line changes are shifted by one', () => {
        const context = buildParityContext(git, testCase);
        const shifted = context.lineChanges.map(c => ({
            ...c, modifiedStartLineNumber: c.modifiedStartLineNumber + 1, modifiedEndLineNumber: c.modifiedEndLineNumber + 1,
        }));
        expect(() => {
            for (const selection of enumerateRowSelections(context)) {
                expectSelectionParity(context, selection, { lineChanges: shifted });
            }
        }).toThrow();
    });

    it('fails the parity assertion when the Classic rows come from a patch off by one line', () => {
        const context = buildParityContext(git, testCase);
        const offset = { ...context, rows: context.rows.map(row => ({ ...row, newLine: row.newLine === undefined ? undefined : row.newLine + 1 })) };
        expect(() => {
            for (const selection of enumerateRowSelections(offset)) {
                expectSelectionParity({ ...offset, sources: context.sources }, selection);
            }
        }).toThrow();
    });
});

describe('AC-08 source assertions', () => {
    const ROOT = join(__dirname, '../../../../../..');
    const SRC = join(ROOT, 'src/server/spa/client/react');
    const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

    it('defaults the working-tree engine to monaco', () => {
        expect(read('features/git/hooks/useDiffEngine.ts')).toMatch(/DEFAULT_DIFF_ENGINE: DiffEngine = 'monaco'/);
    });

    it('keeps the classic viewer while Monaco stays inside the shared file surfaces', () => {
        const importsClassic = (rel: string) => /from '[^']*\/UnifiedDiffViewer'|from '\.\/UnifiedDiffViewer'|from '\.\.\/diff\/UnifiedDiffViewer'/.test(read(rel));
        for (const rel of [
            'features/git/working-tree/WorkingTreeFileDiff.tsx',
            'features/git/diff/FileDiffPanel.tsx',
            'features/git/commits/CommitDetail.tsx',
            'features/pull-requests/PrFilesPanel.tsx',
        ]) {
            expect(importsClassic(rel), rel).toBe(true);
        }
        expect(read('features/git/diff/FileDiffPanel.tsx')).toMatch(/useDiffEngine|MonacoFileDiffViewer/);
        for (const rel of ['features/git/commits/CommitDetail.tsx', 'features/pull-requests/PrFilesPanel.tsx']) {
            expect(read(rel), rel).not.toMatch(/useDiffEngine|MonacoFileDiffViewer/);
        }
    });

    it('adds no Playwright spec for the Monaco diff viewer', () => {
        const specs = readdirSync(join(ROOT, 'test/e2e')).filter(f => f.endsWith('.spec.ts'));
        expect(specs.filter(f => /monaco.*diff|diff.*monaco/i.test(f))).toEqual([]);
        for (const spec of specs) {
            expect(readFileSync(join(ROOT, 'test/e2e', spec), 'utf8'), spec).not.toMatch(/MonacoFileDiffViewer|diff-engine-toggle/);
        }
    });

    it('adds no TODOs in the parity fixtures', () => {
        expect(readFileSync(join(ROOT, 'test/spa/react/diffEngineParityFixtures.ts'), 'utf8')).not.toMatch(/\bTODO\b|FIXME/);
    });
});
