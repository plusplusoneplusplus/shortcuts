// @vitest-environment jsdom
/**
 * AC-04 of repo-content-search: content-search hits render grouped by file, with
 * the matched span highlighted and each row clickable to open the file at its line.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';
import {
    ContentSearchResults,
    groupMatchesByFile,
    splitMatchText,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchResults';

function match(overrides: Partial<ExplorerContentMatch> = {}): ExplorerContentMatch {
    return {
        path: 'src/app.ts',
        line: 1,
        text: 'const needle = 1;',
        startColumn: 6,
        endColumn: 12,
        before: [],
        after: [],
        ...overrides,
    };
}

describe('groupMatchesByFile', () => {
    it('returns an empty list for no matches', () => {
        expect(groupMatchesByFile([])).toEqual([]);
    });

    it('collects consecutive matches for the same file into one group', () => {
        const groups = groupMatchesByFile([
            match({ path: 'a.ts', line: 1 }),
            match({ path: 'a.ts', line: 7 }),
            match({ path: 'b.ts', line: 2 }),
        ]);
        expect(groups.map(g => g.path)).toEqual(['a.ts', 'b.ts']);
        expect(groups[0].matches.map(m => m.line)).toEqual([1, 7]);
        expect(groups[1].matches).toHaveLength(1);
    });

    it('preserves the server ordering: first sighting of a path fixes its position', () => {
        const groups = groupMatchesByFile([
            match({ path: 'z.ts', line: 1 }),
            match({ path: 'a.ts', line: 1 }),
        ]);
        expect(groups.map(g => g.path)).toEqual(['z.ts', 'a.ts']);
    });
});

describe('splitMatchText', () => {
    it('splits a line into before / hit / after on the UTF-16 columns', () => {
        expect(splitMatchText(match())).toEqual({
            before: 'const ',
            hit: 'needle',
            after: ' = 1;',
        });
    });

    it('uses UTF-16 offsets, so a non-ASCII prefix still highlights exactly the match', () => {
        // 'héllo 🌍 needle' — the emoji is a surrogate pair, so 'needle' starts at 9.
        const text = 'héllo 🌍 needle';
        expect(text.indexOf('needle')).toBe(9);
        expect(splitMatchText(match({ text, startColumn: 9, endColumn: 15 })).hit).toBe('needle');
    });

    it('clamps out-of-range columns instead of rendering a blank row', () => {
        const { before, hit, after } = splitMatchText(match({ startColumn: 99, endColumn: 200 }));
        expect(before).toBe('const needle = 1;');
        expect(hit).toBe('');
        expect(after).toBe('');
    });

    it('clamps an inverted range to an empty highlight', () => {
        expect(splitMatchText(match({ startColumn: 10, endColumn: 2 })).hit).toBe('');
    });
});

describe('ContentSearchResults', () => {
    const groups = groupMatchesByFile([
        match({ path: 'src/app.ts', line: 3 }),
        match({ path: 'src/app.ts', line: 9 }),
        match({ path: 'README.md', line: 1 }),
    ]);

    it('renders one header per file with its match count', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} />);
        const headers = screen.getAllByTestId('content-search-file-header');
        expect(headers.map(h => h.getAttribute('data-path'))).toEqual(['src/app.ts', 'README.md']);
        expect(screen.getAllByTestId('content-search-file-count').map(c => c.textContent)).toEqual(['2', '1']);
    });

    it('renders one row per match, labelled with its line number', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} />);
        const rows = screen.getAllByTestId('content-search-match');
        expect(rows).toHaveLength(3);
        expect(rows.map(r => r.getAttribute('data-line'))).toEqual(['3', '9', '1']);
    });

    it('highlights only the matched span', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} />);
        const marks = document.querySelectorAll('mark');
        expect(marks).toHaveLength(3);
        expect([...marks].every(m => m.textContent === 'needle')).toBe(true);
    });

    it('reports the clicked match path and line to the owner', () => {
        const onOpenMatch = vi.fn();
        render(<ContentSearchResults groups={groups} onOpenMatch={onOpenMatch} />);
        fireEvent.click(screen.getAllByTestId('content-search-match')[1]);
        expect(onOpenMatch).toHaveBeenCalledWith('src/app.ts', 9);
    });

    it('keeps a very long line inside its own horizontally scrolling row', () => {
        const long = `${'x'.repeat(4000)}needle${'y'.repeat(4000)}`;
        render(
            <ContentSearchResults
                groups={groupMatchesByFile([match({ text: long, startColumn: 4000, endColumn: 4006 })])}
                onOpenMatch={vi.fn()}
            />,
        );
        const row = screen.getByTestId('content-search-match');
        const textSpan = row.querySelector('span.flex-1');
        expect(textSpan?.className).toContain('overflow-x-auto');
        expect(textSpan?.className).toContain('min-w-0');
        expect(row.querySelector('mark')?.textContent).toBe('needle');
    });

    it('renders 500 matches without dropping any', () => {
        const many = Array.from({ length: 500 }, (_, i) =>
            match({ path: `src/f${i % 25}.ts`, line: i + 1 }));
        render(<ContentSearchResults groups={groupMatchesByFile(many)} onOpenMatch={vi.fn()} />);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(500);
        expect(screen.getAllByTestId('content-search-file-header')).toHaveLength(25);
    });
});
