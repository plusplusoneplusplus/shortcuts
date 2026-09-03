// @vitest-environment jsdom
/**
 * §2.5 of the Explorer Search VS Code parity goal — keyboard navigation of the
 * result rows.
 *
 * Arrows walk file headers, directory rows and match rows as one flat sequence;
 * Left collapses or walks outward, Right expands or walks in; Enter opens the
 * focused match; Delete dismisses the focused row; F4 steps between matches.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';

import {
    ContentSearchResults,
    flattenVisibleRows,
    rowAfterDismissal,
    stepToMatch,
    matchDismissKey,
    dirRowKey,
    fileRowKey,
    matchRowKey,
    toggleCollapsedPath,
    type ContentSearchFileGroup,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchResults';
import type { ContentSearchResultView } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

function match(overrides: Partial<ExplorerContentMatch> = {}): ExplorerContentMatch {
    return {
        path: 'src/app.ts',
        line: 4,
        text: 'const needle = 1;',
        startColumn: 6,
        endColumn: 12,
        before: [],
        after: [],
        ...overrides,
    };
}

const groups: ContentSearchFileGroup[] = [
    {
        path: 'src/a.ts',
        matches: [match({ path: 'src/a.ts', line: 1 }), match({ path: 'src/a.ts', line: 5 })],
    },
    { path: 'lib/b.ts', matches: [match({ path: 'lib/b.ts', line: 2 })] },
];

describe('flattenVisibleRows', () => {
    it('walks the list view as header, matches, header, matches', () => {
        expect(flattenVisibleRows(groups).map(row => [row.kind, row.path])).toEqual([
            ['file', 'src/a.ts'],
            ['match', 'src/a.ts'],
            ['match', 'src/a.ts'],
            ['file', 'lib/b.ts'],
            ['match', 'lib/b.ts'],
        ]);
    });

    it('keeps a collapsed group as one row and drops its matches', () => {
        const rows = flattenVisibleRows(groups, { collapsed: ['src/a.ts'] });
        expect(rows.map(row => row.key)).toEqual([
            fileRowKey('src/a.ts'),
            fileRowKey('lib/b.ts'),
            matchRowKey(match({ path: 'lib/b.ts', line: 2 })),
        ]);
        expect(rows[0].collapsed).toBe(true);
    });

    it('includes directory rows in the tree view, with the files nested under them', () => {
        const rows = flattenVisibleRows(groups, { resultView: 'tree' });
        expect(rows.map(row => [row.kind, row.path, row.depth])).toEqual([
            ['dir', 'src', 0],
            ['file', 'src/a.ts', 1],
            ['match', 'src/a.ts', 1],
            ['match', 'src/a.ts', 1],
            ['dir', 'lib', 0],
            ['file', 'lib/b.ts', 1],
            ['match', 'lib/b.ts', 1],
        ]);
    });

    it('hides everything under a collapsed directory row', () => {
        const rows = flattenVisibleRows(groups, { resultView: 'tree', collapsed: ['src'] });
        expect(rows.map(row => row.path)).toEqual(['src', 'lib', 'lib/b.ts', 'lib/b.ts']);
    });

    it('points a match at its file header and a file at its directory row', () => {
        const rows = flattenVisibleRows(groups, { resultView: 'tree' });
        expect(rows[2].parentKey).toBe(fileRowKey('src/a.ts'));
        expect(rows[1].parentKey).toBe(dirRowKey('src'));
        expect(rows[0].parentKey).toBeNull();
    });

    it('gives matches and file headers a dismiss key, and directories none', () => {
        const rows = flattenVisibleRows(groups, { resultView: 'tree' });
        expect(rows[0].dismissKey).toBeUndefined();
        expect(rows[1].dismissKey).toBe('src/a.ts');
        expect(rows[2].dismissKey).toBe(matchDismissKey(match({ path: 'src/a.ts', line: 1 })));
    });
});

describe('rowAfterDismissal', () => {
    const rows = flattenVisibleRows(groups);

    it('lands on the next row when one match goes', () => {
        expect(rowAfterDismissal(rows, 1)).toBe(rows[2].key);
    });

    it('skips the rest of the group when the whole file goes', () => {
        expect(rowAfterDismissal(rows, 0)).toBe(fileRowKey('lib/b.ts'));
    });

    it('falls back to the row above at the end of the list', () => {
        expect(rowAfterDismissal(rows, rows.length - 1)).toBe(rows[rows.length - 2].key);
    });

    it('has nowhere to go when the list empties', () => {
        expect(rowAfterDismissal(flattenVisibleRows([{ path: 'a.ts', matches: [] }]), 0)).toBeNull();
        expect(rowAfterDismissal([], 0)).toBeNull();
    });
});

describe('stepToMatch', () => {
    const rows = flattenVisibleRows(groups);

    it('skips headers on the way forward', () => {
        expect(stepToMatch(rows, 2, 1)).toBe(rows[4].key);
    });

    it('wraps at the end and at the start', () => {
        expect(stepToMatch(rows, 4, 1)).toBe(rows[1].key);
        expect(stepToMatch(rows, 1, -1)).toBe(rows[4].key);
    });

    it('starts at the first match when nothing is focused', () => {
        expect(stepToMatch(rows, -1, 1)).toBe(rows[1].key);
        expect(stepToMatch(rows, -1, -1)).toBe(rows[4].key);
    });

    it('returns nothing when no match row is visible', () => {
        const collapsed = flattenVisibleRows(groups, { collapsed: ['src/a.ts', 'lib/b.ts'] });
        expect(stepToMatch(collapsed, -1, 1)).toBeNull();
        expect(stepToMatch([], 0, 1)).toBeNull();
    });
});

/** Renders the results with collapse state wired up, as the panel does. */
function Harness({
    onOpenMatch = vi.fn(),
    onDismiss,
    resultView,
    initialCollapsed = [],
}: {
    onOpenMatch?: (path: string, line: number) => void;
    onDismiss?: (key: string) => void;
    resultView?: ContentSearchResultView;
    initialCollapsed?: string[];
}) {
    const [collapsed, setCollapsed] = useState<readonly string[]>(initialCollapsed);
    return (
        <ContentSearchResults
            groups={groups}
            onOpenMatch={onOpenMatch}
            collapsed={collapsed}
            onToggleCollapsed={path => setCollapsed(prev => toggleCollapsedPath(prev, path))}
            resultView={resultView}
            onDismiss={onDismiss}
        />
    );
}

function focusedKey(): string | null {
    return document.activeElement?.getAttribute('data-row-key') ?? null;
}

function press(key: string, init: { shiftKey?: boolean } = {}): void {
    fireEvent.keyDown(screen.getByTestId('content-search-results'), { key, ...init });
}

describe('ContentSearchResults — keyboard navigation', () => {
    afterEach(cleanup);

    it('makes only the first row tabbable, so Tab reaches the results once', () => {
        render(<Harness />);
        const tabbable = Array.from(document.querySelectorAll('[data-row-key]'))
            .filter(el => el.getAttribute('tabindex') === '0')
            .map(el => el.getAttribute('data-row-key'));
        expect(tabbable).toEqual([fileRowKey('src/a.ts')]);
    });

    it('moves down through headers and matches as one flat sequence', () => {
        render(<Harness />);
        press('ArrowDown');
        expect(focusedKey()).toBe(fileRowKey('src/a.ts'));
        press('ArrowDown');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'src/a.ts', line: 1 })));
        press('ArrowDown');
        press('ArrowDown');
        expect(focusedKey()).toBe(fileRowKey('lib/b.ts'));
    });

    it('stops at the ends rather than wrapping', () => {
        render(<Harness />);
        for (let i = 0; i < 10; i++) press('ArrowDown');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'lib/b.ts', line: 2 })));
        for (let i = 0; i < 10; i++) press('ArrowUp');
        expect(focusedKey()).toBe(fileRowKey('src/a.ts'));
    });

    it('starts from the last row when the first press is ArrowUp', () => {
        render(<Harness />);
        press('ArrowUp');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'lib/b.ts', line: 2 })));
    });

    it('collapses an open group with ArrowLeft and expands it with ArrowRight', () => {
        render(<Harness />);
        press('ArrowDown');
        press('ArrowLeft');
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
        press('ArrowRight');
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);
    });

    it('jumps from a match to its file header with ArrowLeft', () => {
        render(<Harness />);
        press('ArrowDown');
        press('ArrowDown');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'src/a.ts', line: 1 })));
        press('ArrowLeft');
        expect(focusedKey()).toBe(fileRowKey('src/a.ts'));
    });

    it('walks out to the directory row when ArrowLeft hits an already-collapsed file', () => {
        render(<Harness resultView="tree" initialCollapsed={['src/a.ts']} />);
        press('ArrowDown');
        press('ArrowDown');
        expect(focusedKey()).toBe(fileRowKey('src/a.ts'));
        press('ArrowLeft');
        expect(focusedKey()).toBe(dirRowKey('src'));
    });

    it('moves onto the next row when ArrowRight has nothing to expand', () => {
        render(<Harness />);
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'src/a.ts', line: 5 })));
    });

    it('opens the focused match on Enter', () => {
        const onOpenMatch = vi.fn();
        render(<Harness onOpenMatch={onOpenMatch} />);
        press('ArrowDown');
        press('ArrowDown');
        press('Enter');
        expect(onOpenMatch).toHaveBeenCalledTimes(1);
        expect(onOpenMatch).toHaveBeenCalledWith('src/a.ts', 1);
    });

    it('toggles the group on Enter over a file header, and opens nothing', () => {
        const onOpenMatch = vi.fn();
        render(<Harness onOpenMatch={onOpenMatch} />);
        press('ArrowDown');
        press('Enter');
        expect(onOpenMatch).not.toHaveBeenCalled();
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
    });

    it('dismisses the focused match on Delete and moves to the next row', () => {
        const onDismiss = vi.fn();
        render(<Harness onDismiss={onDismiss} />);
        press('ArrowDown');
        press('ArrowDown');
        press('Delete');
        expect(onDismiss).toHaveBeenCalledWith(matchDismissKey(match({ path: 'src/a.ts', line: 1 })));
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'src/a.ts', line: 5 })));
    });

    it('dismisses the whole group on Delete over a file header', () => {
        const onDismiss = vi.fn();
        render(<Harness onDismiss={onDismiss} />);
        press('ArrowDown');
        press('Delete');
        expect(onDismiss).toHaveBeenCalledWith('src/a.ts');
    });

    it('leaves Delete inert over a directory row, which is not dismissible', () => {
        const onDismiss = vi.fn();
        render(<Harness resultView="tree" onDismiss={onDismiss} />);
        press('ArrowDown');
        expect(focusedKey()).toBe(dirRowKey('src'));
        press('Delete');
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('does nothing on Delete when the owner passes no dismiss handler', () => {
        render(<Harness />);
        press('ArrowDown');
        press('Delete');
        expect(screen.getAllByTestId('content-search-group')).toHaveLength(2);
    });

    it('steps between matches with F4, skipping headers and wrapping', () => {
        render(<Harness />);
        press('F4');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'src/a.ts', line: 1 })));
        press('F4');
        press('F4');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'lib/b.ts', line: 2 })));
        press('F4');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'src/a.ts', line: 1 })));
    });

    it('steps backwards with Shift+F4', () => {
        render(<Harness />);
        press('F4');
        press('F4', { shiftKey: true });
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'lib/b.ts', line: 2 })));
    });

    it('follows the row a click focused, rather than restarting from the top', () => {
        render(<Harness />);
        fireEvent.focus(screen.getAllByTestId('content-search-file-header')[1]);
        press('ArrowDown');
        expect(focusedKey()).toBe(matchRowKey(match({ path: 'lib/b.ts', line: 2 })));
    });

    it('ignores keys it does not own', () => {
        render(<Harness />);
        press('ArrowDown');
        press('a');
        expect(focusedKey()).toBe(fileRowKey('src/a.ts'));
    });
});
