/**
 * @vitest-environment jsdom
 *
 * File-mention suggestion menu (AC-02).
 *
 * The menu is a dumb list — selection lives in the composer — so the test drives
 * it through the same `moveFileMentionHighlight` helper the composer key chain
 * uses, and asserts what the menu itself owns: ranked rows, repo labels, the
 * scorer's match indices rendered as highlights, and click/dismiss behaviour.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
    FileMentionMenu,
    moveFileMentionHighlight,
} from '../../../../../src/server/spa/client/react/features/chat/FileMentionMenu';
import type { FileMentionResult } from '../../../../../src/server/spa/client/react/features/chat/hooks/useFileMentionSearch';

// jsdom doesn't implement scrollIntoView, which the menu calls to keep the
// highlighted row in view.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

/** `packages/coc/src/index.ts` with `index` matched in the file name. */
const RESULTS: FileMentionResult[] = [
    {
        path: 'packages/coc/src/index.ts',
        score: 90,
        indices: [17, 18, 19, 20, 21],
        workspaceId: 'ws-a',
        repoName: 'alpha',
    },
    {
        path: 'src/indexer.ts',
        score: 70,
        indices: [4, 5, 6, 7, 8],
        workspaceId: 'ws-b',
        repoName: 'beta',
    },
    { path: 'index.md', score: 50, indices: [0, 1], workspaceId: 'ws-a', repoName: 'alpha' },
];

/**
 * Wraps the menu with the selection state the composer would own, wired through
 * the exported navigation helper so the keyboard behaviour under test is the
 * production one.
 */
function Harness({ onSelect }: { onSelect?: (r: FileMentionResult) => void }) {
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [visible, setVisible] = useState(true);
    return (
        <div
            data-testid="composer"
            tabIndex={0}
            onKeyDown={e => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    setHighlightIndex(i => moveFileMentionHighlight(i, RESULTS.length, e.key as 'ArrowDown' | 'ArrowUp'));
                } else if (e.key === 'Escape') {
                    setVisible(false);
                }
            }}
        >
            <FileMentionMenu
                results={RESULTS}
                visible={visible}
                highlightIndex={highlightIndex}
                onSelect={r => onSelect?.(r)}
                onDismiss={() => setVisible(false)}
            />
        </div>
    );
}

function selectedRow(): number {
    const rows = screen.getAllByRole('option');
    return rows.findIndex(r => r.getAttribute('aria-selected') === 'true');
}

describe('FileMentionMenu', () => {
    it('renders one row per match with its repo label', () => {
        render(<Harness />);
        expect(screen.getAllByRole('option')).toHaveLength(3);
        expect(screen.getByTestId('file-mention-name-0').textContent).toBe('index.ts');
        expect(screen.getByTestId('file-mention-dir-0').textContent).toBe('packages/coc/src');
        expect(screen.getByTestId('file-mention-repo-0').textContent).toBe('alpha');
        expect(screen.getByTestId('file-mention-repo-1').textContent).toBe('beta');
        // A path with no directory renders no dir segment.
        expect(screen.queryByTestId('file-mention-dir-2')).toBeNull();
    });

    it('highlights the character ranges the scorer reported', () => {
        render(<Harness />);
        // indices 17..21 of `packages/coc/src/index.ts` = "index", which lives in
        // the file-name segment and must be rebased onto it.
        const marks = Array.from(
            screen.getByTestId('file-mention-name-0').querySelectorAll('span'),
        ).map(s => s.textContent);
        expect(marks.join('')).toBe('index');
        // indices 4..8 of `src/indexer.ts` = "index" after the `src/` directory.
        const nameMarks = Array.from(
            screen.getByTestId('file-mention-name-1').querySelectorAll('span'),
        ).map(s => s.textContent);
        expect(nameMarks.join('')).toBe('index');
        // Nothing in the directory segment matched for that row.
        expect(screen.getByTestId('file-mention-dir-1').querySelectorAll('span')).toHaveLength(0);
    });

    it('moves the selection with ArrowDown and wraps with ArrowUp', () => {
        render(<Harness />);
        expect(selectedRow()).toBe(0);

        fireEvent.keyDown(screen.getByTestId('composer'), { key: 'ArrowDown' });
        expect(selectedRow()).toBe(1);

        fireEvent.keyDown(screen.getByTestId('composer'), { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByTestId('composer'), { key: 'ArrowDown' });
        expect(selectedRow()).toBe(0);

        fireEvent.keyDown(screen.getByTestId('composer'), { key: 'ArrowUp' });
        expect(selectedRow()).toBe(2);
    });

    it('closes on Escape', () => {
        render(<Harness />);
        expect(screen.getByTestId('file-mention-menu')).toBeTruthy();
        fireEvent.keyDown(screen.getByTestId('composer'), { key: 'Escape' });
        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
    });

    it('selects a row on click without stealing composer focus', () => {
        const onSelect = vi.fn();
        render(<Harness onSelect={onSelect} />);
        const row = screen.getByTestId('file-mention-item-1');
        // mousedown, not click: the handler preventDefaults so the contentEditable
        // keeps its caret while the path is inserted.
        fireEvent.mouseDown(row);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0].path).toBe('src/indexer.ts');
    });

    it('renders nothing when closed or empty', () => {
        const { rerender } = render(
            <FileMentionMenu
                results={RESULTS}
                visible={false}
                highlightIndex={0}
                onSelect={() => {}}
                onDismiss={() => {}}
            />,
        );
        expect(screen.queryByTestId('file-mention-menu')).toBeNull();

        rerender(
            <FileMentionMenu
                results={[]}
                visible={true}
                highlightIndex={0}
                onSelect={() => {}}
                onDismiss={() => {}}
            />,
        );
        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
    });

    it('dismisses on an outside mousedown', () => {
        render(<Harness />);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('file-mention-menu')).toBeNull();
    });
});

describe('moveFileMentionHighlight', () => {
    it('wraps in both directions and stays at 0 for an empty list', () => {
        expect(moveFileMentionHighlight(0, 3, 'ArrowDown')).toBe(1);
        expect(moveFileMentionHighlight(2, 3, 'ArrowDown')).toBe(0);
        expect(moveFileMentionHighlight(0, 3, 'ArrowUp')).toBe(2);
        expect(moveFileMentionHighlight(0, 0, 'ArrowDown')).toBe(0);
    });
});
