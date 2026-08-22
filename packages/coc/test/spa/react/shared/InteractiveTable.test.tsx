/**
 * Tests for InteractiveTable — TanStack Table component for sorted,
 * filtered, paginated markdown tables with aggregation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { InteractiveTable, isNumericColumn, tableToCsv, computeColumnWeights } from '../../../../src/server/spa/client/react/shared/InteractiveTable';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('isNumericColumn', () => {
    it('returns true for all-numeric cells', () => {
        expect(isNumericColumn(['1', '2', '3'])).toBe(true);
    });

    it('returns true for numeric cells with commas', () => {
        expect(isNumericColumn(['1,000', '2,500.50'])).toBe(true);
    });

    it('returns true when some cells are empty or dashes', () => {
        expect(isNumericColumn(['10', '', '-', '20'])).toBe(true);
    });

    it('returns false for non-numeric cells', () => {
        expect(isNumericColumn(['hello', '42'])).toBe(false);
    });

    it('returns false for all-empty cells', () => {
        expect(isNumericColumn(['', '', ''])).toBe(false);
    });

    it('handles HTML-wrapped numbers', () => {
        // stripHtml is used inside isNumericColumn
        expect(isNumericColumn(['<strong>42</strong>', '<code>100</code>'])).toBe(true);
    });
});

describe('tableToCsv', () => {
    it('produces correct CSV output', () => {
        const csv = tableToCsv(['Name', 'Value'], [['Alice', '10'], ['Bob', '20']]);
        expect(csv).toBe('Name,Value\nAlice,10\nBob,20');
    });

    it('quotes values containing commas', () => {
        const csv = tableToCsv(['A'], [['hello, world']]);
        expect(csv).toBe('A\n"hello, world"');
    });

    it('escapes double quotes', () => {
        const csv = tableToCsv(['A'], [['say "hi"']]);
        expect(csv).toBe('A\n"say ""hi"""');
    });

    it('strips HTML from cell values', () => {
        const csv = tableToCsv(['A'], [['<strong>bold</strong>']]);
        expect(csv).toBe('A\nbold');
    });
});

describe('computeColumnWeights', () => {
    const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

    it('gives the short column a smaller share than the long one', () => {
        const w = computeColumnWeights(
            ['Module', 'Owns'],
            [
                ['src/server/spa/client.tsx', 'Serves the dashboard SPA and its static assets'],
                ['src/server/routes/api.ts', 'REST endpoints for processes, memory and search'],
            ]
        );
        expect(w[0]).toBeLessThan(w[1]);
        expect(sum(w)).toBeCloseTo(100, 5);
    });

    it('lets a header longer than every cell drive the weight', () => {
        const w = computeColumnWeights(['A', 'Description'], [['x', 'y'], ['x', 'y']]);
        // The "Description" header is 11 chars against a 1-char header, so the
        // second column stays wide instead of collapsing to the floor.
        expect(w[1]).toBeGreaterThan(w[0]);
        expect(w[1]).toBeGreaterThan(50);
        expect(sum(w)).toBeCloseTo(100, 5);
    });

    it('does not let one outlier row dominate (p90, not max)', () => {
        const short = Array.from({ length: 20 }, () => ['a', 'b']);
        const withOutlier = short.map(r => [...r]);
        withOutlier[0] = ['a', 'z'.repeat(500)];

        const base = computeColumnWeights(['A', 'B'], short);
        const outlier = computeColumnWeights(['A', 'B'], withOutlier);
        expect(outlier[1]).toBeCloseTo(base[1], 5);
    });

    it('clamps an extreme ratio to the 8% floor and 70% ceiling', () => {
        const w = computeColumnWeights(['A', 'B'], [['ab', 'z'.repeat(400)]]);
        expect(w[0]).toBeCloseTo(30, 5);
        expect(w[1]).toBeCloseTo(70, 5);
        expect(sum(w)).toBeCloseTo(100, 5);
    });

    it('holds the 8% floor for a tiny column among many wide ones', () => {
        const headers = ['A', 'B', 'C', 'D', 'E'];
        const rows = [['x', 'y'.repeat(200), 'y'.repeat(200), 'y'.repeat(200), 'y'.repeat(200)]];
        const w = computeColumnWeights(headers, rows);
        expect(w[0]).toBeCloseTo(8, 5);
        expect(sum(w)).toBeCloseTo(100, 5);
    });

    it('falls back to an even split for degenerate input', () => {
        expect(computeColumnWeights([], [])).toEqual([]);
        expect(computeColumnWeights(['Only'], [])).toEqual([100]);
        expect(computeColumnWeights(['A', 'B'], [])).toEqual([50, 50]);
        expect(computeColumnWeights(['', ''], [['', '']])).toEqual([50, 50]);
    });

    it('handles a single column with content', () => {
        expect(computeColumnWeights(['Name'], [['Alice'], ['Bob']])).toEqual([100]);
    });

    it('strips HTML before counting characters', () => {
        const plain = computeColumnWeights(['A', 'B'], [['x', 'abcdefghij']]);
        const tagged = computeColumnWeights(['A', 'B'], [['<code>x</code>', '<em>abcdefghij</em>']]);
        expect(tagged).toEqual(plain);
    });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe('InteractiveTable', () => {
    const defaultProps = {
        headers: ['Name', 'Score'],
        alignments: ['left' as const, 'right' as const],
        rows: [
            ['Alice', '90'],
            ['Bob', '85'],
            ['Charlie', '95'],
            ['Diana', '70'],
            ['Eve', '88'],
        ],
        originalMarkdown: '| Name | Score |\n| --- | ---: |\n| Alice | 90 |',
        tableKey: 'test-1',
    };

    it('renders all rows', () => {
        render(<InteractiveTable {...defaultProps} />);
        expect(screen.getByText('5 rows')).toBeTruthy();
    });

    it('renders header cells', () => {
        const { container } = render(<InteractiveTable {...defaultProps} />);
        const ths = container.querySelectorAll('th');
        expect(ths.length).toBe(2);
    });

    it('renders body cells', () => {
        const { container } = render(<InteractiveTable {...defaultProps} />);
        const tds = container.querySelectorAll('td');
        // 5 rows * 2 cols = 10 body cells
        // aggregation footer adds 2 more cells (Score is numeric)
        expect(tds.length).toBeGreaterThanOrEqual(10);
    });

    it('shows aggregation footer for numeric columns', () => {
        const { container } = render(<InteractiveTable {...defaultProps} />);
        const tfoot = container.querySelector('tfoot');
        expect(tfoot).not.toBeNull();

        // Should show sum symbol
        const aggLabels = tfoot!.querySelectorAll('.interactive-table-agg-label');
        expect(aggLabels.length).toBeGreaterThan(0);
    });

    it('does not show aggregation for non-numeric columns', () => {
        const props = {
            ...defaultProps,
            rows: [
                ['Alice', 'A'],
                ['Bob', 'B'],
                ['Charlie', 'C'],
                ['Diana', 'D'],
                ['Eve', 'E'],
            ],
        };
        const { container } = render(<InteractiveTable {...props} />);
        const tfoot = container.querySelector('tfoot');
        // No tfoot when no numeric columns
        expect(tfoot).toBeNull();
    });

    describe('header text selection', () => {
        it('does not apply select-none to sortable headers so text can be selected', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const ths = container.querySelectorAll('th');
            ths.forEach(th => {
                expect(th.classList.contains('select-none')).toBe(false);
            });
        });

        it('applies cursor-pointer to sortable headers', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const ths = container.querySelectorAll('th');
            ths.forEach(th => {
                expect(th.classList.contains('cursor-pointer')).toBe(true);
            });
        });
    });

    describe('chrome excluded from text selection', () => {
        it('marks the toolbar non-selectable', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const toolbar = container.querySelector('.interactive-table-toolbar');
            expect(toolbar?.classList.contains('select-none')).toBe(true);
        });

        it('marks the aggregation footer row non-selectable', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const aggRow = container.querySelector('.interactive-table-agg-row');
            expect(aggRow?.classList.contains('select-none')).toBe(true);
        });

        it('marks the sort indicator non-selectable', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(container.querySelectorAll('th')[0]);
            const indicator = container.querySelector('.interactive-table-sort-indicator');
            expect(indicator?.classList.contains('select-none')).toBe(true);
        });

        it('marks the filter inputs non-selectable', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Show filters'));
            const inputs = container.querySelectorAll('.interactive-table-filter-input');
            expect(inputs.length).toBeGreaterThan(0);
            inputs.forEach(input => {
                expect(input.classList.contains('select-none')).toBe(true);
            });
        });

        it('marks the column-picker dropdown non-selectable', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker = screen.getByTestId('col-picker');
            expect(picker.classList.contains('select-none')).toBe(true);
        });

        it('marks pagination controls non-selectable', () => {
            const rows = Array.from({ length: 30 }, (_, i) => [`Item ${i}`, `${i}`]);
            const { container } = render(<InteractiveTable {...defaultProps} rows={rows} />);
            const pagination = container.querySelector('.interactive-table-pagination');
            expect(pagination?.classList.contains('select-none')).toBe(true);
        });

        it('keeps body data cells selectable', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const tds = container.querySelectorAll('tbody td');
            expect(tds.length).toBeGreaterThan(0);
            tds.forEach(td => {
                expect(td.classList.contains('select-none')).toBe(false);
            });
        });

        it('keeps header cells selectable so the label text can be copied', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const ths = container.querySelectorAll('th');
            ths.forEach(th => {
                expect(th.classList.contains('select-none')).toBe(false);
            });
        });
    });

    describe('sorting', () => {
        it('sorts ascending on first click', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const nameHeader = container.querySelectorAll('th')[0];
            fireEvent.click(nameHeader);

            const firstCell = container.querySelector('tbody tr td');
            expect(firstCell?.textContent).toBe('Alice');
        });

        it('shows sort indicator after clicking header', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const nameHeader = container.querySelectorAll('th')[0];
            fireEvent.click(nameHeader);

            const indicator = nameHeader.querySelector('.interactive-table-sort-indicator');
            expect(indicator).not.toBeNull();
        });
    });

    describe('filtering', () => {
        it('shows filter inputs after clicking Filter button', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);

            // Click the Filter button
            const filterBtn = screen.getByTitle('Show filters');
            fireEvent.click(filterBtn);

            const inputs = container.querySelectorAll('.interactive-table-filter-input');
            expect(inputs.length).toBe(2);
        });

        it('narrows visible rows when typing in filter', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);

            // Show filters
            fireEvent.click(screen.getByTitle('Show filters'));

            const filterInputs = container.querySelectorAll('.interactive-table-filter-input');
            fireEvent.change(filterInputs[0], { target: { value: 'Alice' } });

            // Only one row should remain
            const bodyRows = container.querySelectorAll('tbody tr');
            expect(bodyRows.length).toBe(1);
        });

        it('updates row count display when filtering', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);

            fireEvent.click(screen.getByTitle('Show filters'));
            const filterInputs = container.querySelectorAll('.interactive-table-filter-input');
            fireEvent.change(filterInputs[0], { target: { value: 'Alice' } });

            expect(screen.getByText('1 of 5 rows')).toBeTruthy();
        });
    });

    describe('pagination', () => {
        it('does not show pagination for small tables', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const pagination = container.querySelector('.interactive-table-pagination');
            expect(pagination).toBeNull();
        });

        it('shows pagination for tables with > 25 rows', () => {
            const rows = Array.from({ length: 30 }, (_, i) => [`Item ${i}`, `${i}`]);
            const props = {
                ...defaultProps,
                rows,
            };
            const { container } = render(<InteractiveTable {...props} />);
            const pagination = container.querySelector('.interactive-table-pagination');
            expect(pagination).not.toBeNull();
        });

        it('shows correct page info', () => {
            const rows = Array.from({ length: 30 }, (_, i) => [`Item ${i}`, `${i}`]);
            const props = { ...defaultProps, rows };
            render(<InteractiveTable {...props} />);

            expect(screen.getByText(/Page 1 of 2/)).toBeTruthy();
        });
    });

    describe('copy buttons', () => {
        it('renders Copy as Markdown button', () => {
            render(<InteractiveTable {...defaultProps} />);
            expect(screen.getByTitle('Copy as Markdown')).toBeTruthy();
        });

        it('renders Copy as CSV button', () => {
            render(<InteractiveTable {...defaultProps} />);
            expect(screen.getByTitle('Copy as CSV')).toBeTruthy();
        });
    });

    describe('toolbar overflow (AC-05)', () => {
        const TOOLBAR_TITLES = [
            'Show filters',
            'Toggle column visibility',
            'Copy as Markdown',
            'Copy as CSV',
            'Expand table',
        ];

        it('renders all five toolbar buttons with their current titles', () => {
            render(<InteractiveTable {...defaultProps} />);
            for (const title of TOOLBAR_TITLES) {
                expect(screen.getByTitle(title).tagName).toBe('BUTTON');
            }
        });

        it('wraps each button label so it can be hidden when the toolbar is narrow', () => {
            render(<InteractiveTable {...defaultProps} />);
            for (const title of TOOLBAR_TITLES) {
                const label = screen.getByTitle(title).querySelector('.interactive-table-btn-label');
                expect(label, `${title} should have a collapsible label`).toBeTruthy();
                expect(label?.textContent?.trim()).not.toBe('');
            }
        });

        it('keeps the row count and the actions in a single toolbar row container', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const toolbar = container.querySelector('.interactive-table-toolbar');
            expect(toolbar).toBeTruthy();
            expect(toolbar?.querySelector('.interactive-table-row-count')).toBeTruthy();
            const actions = toolbar?.querySelector('.interactive-table-actions');
            expect(actions).toBeTruthy();
            expect(actions?.querySelectorAll('button.interactive-table-btn').length).toBe(5);
        });
    });

    describe('column resizing (AC-06)', () => {
        it('renders a resize handle for every header', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const handles = container.querySelectorAll('.interactive-table-resizer');
            expect(handles.length).toBe(defaultProps.headers.length);
            expect(screen.getByTestId('interactive-table-resizer-col_0')).toBeTruthy();
            expect(screen.getByTestId('interactive-table-resizer-col_1')).toBeTruthy();
        });

        it('puts the handle inside its own header cell', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const ths = container.querySelectorAll('thead th');
            expect(ths[0].querySelector('.interactive-table-resizer')).toBeTruthy();
            expect(ths[0].getAttribute('data-col-id')).toBe('col_0');
        });

        it('does not toggle sorting when the handle is pressed', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const nameCells = () =>
                Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
                    td => td.textContent
                );
            const before = nameCells();

            const handle = screen.getByTestId('interactive-table-resizer-col_0');
            fireEvent.mouseDown(handle, { clientX: 100 });
            fireEvent.click(handle);

            // No sort indicator appeared and the row order is untouched.
            expect(container.querySelector('.interactive-table-sort-indicator')).toBeNull();
            expect(nameCells()).toEqual(before);
        });

        it('leaves widths to the colgroup until a column is actually resized', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const table = container.querySelector('table');
            expect(table?.classList.contains('interactive-md-table')).toBe(true);
            expect(table?.classList.contains('interactive-md-table-resized')).toBe(false);
            expect(container.querySelector('thead th')?.getAttribute('style')).toBeNull();
            // No inline table width either — that is only set from the summed
            // column widths once the columns have been seeded.
            expect(table?.getAttribute('style')).toBeNull();
        });

        it('swaps the colgroup for explicit px widths once a drag seeds sizes', () => {
            // jsdom lays nothing out, so the seeding pass needs real widths.
            const spy = vi
                .spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect')
                .mockReturnValue({ width: 140, height: 20 } as DOMRect);
            try {
                const { container } = render(<InteractiveTable {...defaultProps} />);
                expect(container.querySelector('colgroup')).toBeTruthy();

                fireEvent.pointerEnter(screen.getByTestId('interactive-table-resizer-col_0'));

                expect(container.querySelector('colgroup')).toBeNull();
                const table = container.querySelector('table');
                expect(table?.classList.contains('interactive-md-table-resized')).toBe(true);
                const ths = Array.from(container.querySelectorAll('thead th')) as HTMLElement[];
                expect(ths.map(th => th.style.width)).toEqual(['140px', '140px']);
                expect((table as HTMLElement).style.width).toBe('280px');
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe('content-proportional column widths', () => {
        it('emits one percentage-width <col> per column', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const cols = Array.from(container.querySelectorAll('colgroup col')) as HTMLElement[];
            expect(cols.length).toBe(defaultProps.headers.length);
            expect(cols.map(c => c.getAttribute('data-col-id'))).toEqual(['col_0', 'col_1']);
            for (const col of cols) {
                expect(col.style.width).toMatch(/^\d+(\.\d+)?%$/);
            }
            const total = cols.reduce((a, c) => a + parseFloat(c.style.width), 0);
            expect(total).toBeCloseTo(100, 1);
        });

        it('gives the wider column a bigger share', () => {
            const { container } = render(
                <InteractiveTable
                    headers={['Module', 'Owns']}
                    alignments={['left', 'left']}
                    rows={[
                        ['client.tsx', 'Serves the dashboard SPA and its static assets'],
                        ['api.ts', 'REST endpoints for processes, memory and search'],
                    ]}
                    originalMarkdown=""
                    tableKey="widths"
                />
            );
            const cols = Array.from(container.querySelectorAll('colgroup col')) as HTMLElement[];
            expect(parseFloat(cols[0].style.width)).toBeLessThan(parseFloat(cols[1].style.width));
        });

        it('drops the <col> for a hidden column', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const checkboxes = within(screen.getByTestId('col-picker')).getAllByRole('checkbox');
            fireEvent.click(checkboxes[0]);

            const cols = Array.from(container.querySelectorAll('colgroup col'));
            expect(cols.length).toBe(1);
            expect(cols[0].getAttribute('data-col-id')).toBe('col_1');
        });
    });

    describe('data-testid', () => {
        it('includes tableKey in data-testid', () => {
            render(<InteractiveTable {...defaultProps} />);
            expect(screen.getByTestId('interactive-table-test-1')).toBeTruthy();
        });
    });

    describe('fullscreen', () => {
        it('renders Expand button', () => {
            render(<InteractiveTable {...defaultProps} />);
            expect(screen.getByTitle('Expand table')).toBeTruthy();
        });

        it('shows backdrop when Expand is clicked', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));
            expect(screen.getByTestId('interactive-table-backdrop')).toBeTruthy();
        });

        it('shows Exit button in fullscreen mode', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));
            expect(screen.getByTitle('Exit fullscreen')).toBeTruthy();
        });

        it('exits fullscreen when Exit is clicked', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));
            expect(screen.getByTestId('interactive-table-backdrop')).toBeTruthy();

            fireEvent.click(screen.getByTitle('Exit fullscreen'));
            expect(container.querySelector('.interactive-table-backdrop')).toBeNull();
        });

        it('exits fullscreen when backdrop is clicked', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));
            const backdrop = screen.getByTestId('interactive-table-backdrop');

            fireEvent.click(backdrop);
            expect(container.querySelector('.interactive-table-backdrop')).toBeNull();
        });

        it('does not exit fullscreen when inner panel is clicked', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));

            // Click on the table itself (inside the panel)
            const table = screen.getByTestId('interactive-table-test-1');
            fireEvent.click(table);
            // Should still be in fullscreen
            expect(screen.getByTestId('interactive-table-backdrop')).toBeTruthy();
        });

        it('exits fullscreen on Escape key', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));
            expect(screen.getByTestId('interactive-table-backdrop')).toBeTruthy();

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(container.querySelector('.interactive-table-backdrop')).toBeNull();
        });

        it('preserves table data in fullscreen mode', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Expand table'));

            expect(screen.getByText('5 rows')).toBeTruthy();
        });
    });

    describe('column visibility', () => {
        it('renders Columns button', () => {
            render(<InteractiveTable {...defaultProps} />);
            expect(screen.getByTitle('Toggle column visibility')).toBeTruthy();
        });

        it('shows column picker dropdown when Columns is clicked', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            expect(screen.getByTestId('col-picker')).toBeTruthy();
        });

        it('lists all columns with checkboxes', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker = screen.getByTestId('col-picker');
            const checkboxes = within(picker).getAllByRole('checkbox');
            expect(checkboxes.length).toBe(2);
            // All initially checked
            checkboxes.forEach(cb => {
                expect((cb as HTMLInputElement).checked).toBe(true);
            });
        });

        it('hides a column when its checkbox is unchecked', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker = screen.getByTestId('col-picker');
            const checkboxes = within(picker).getAllByRole('checkbox');

            // Uncheck "Name" (first column)
            fireEvent.click(checkboxes[0]);

            // Should have only 1 header column
            const ths = container.querySelectorAll('th');
            expect(ths.length).toBe(1);
        });

        it('disables the last visible column checkbox', () => {
            render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker = screen.getByTestId('col-picker');
            const checkboxes = within(picker).getAllByRole('checkbox');

            // Hide first column — now only second is visible
            fireEvent.click(checkboxes[0]);

            // Re-open picker to get fresh checkboxes
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker2 = screen.getByTestId('col-picker');
            const checkboxes2 = within(picker2).getAllByRole('checkbox');

            // The second checkbox (last visible) should be disabled
            const visibleCheckbox = checkboxes2.find(cb => (cb as HTMLInputElement).checked);
            expect((visibleCheckbox as HTMLInputElement).disabled).toBe(true);
        });

        it('closes dropdown on outside click', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            expect(screen.getByTestId('col-picker')).toBeTruthy();

            // Click outside
            fireEvent.mouseDown(document.body);
            expect(container.querySelector('[data-testid="col-picker"]')).toBeNull();
        });

        it('shows plain text labels (strips HTML)', () => {
            const props = {
                ...defaultProps,
                headers: ['<strong>Name</strong>', '<em>Score</em>'],
            };
            render(<InteractiveTable {...props} />);
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker = screen.getByTestId('col-picker');
            const labels = within(picker).getAllByRole('checkbox');
            // The label text should be stripped of HTML
            expect(labels[0].parentElement?.textContent).toContain('Name');
            expect(labels[0].parentElement?.textContent).not.toContain('<strong>');
        });

        it('hides aggregation footer cells for hidden columns', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);

            // Initially there's a tfoot
            expect(container.querySelector('tfoot')).not.toBeNull();

            // Hide Score column (the numeric one, col index 1)
            fireEvent.click(screen.getByTitle('Toggle column visibility'));
            const picker = screen.getByTestId('col-picker');
            const checkboxes = within(picker).getAllByRole('checkbox');
            fireEvent.click(checkboxes[1]); // hide Score

            // Footer should have only 1 cell now (Name, which is non-numeric = empty)
            const footerCells = container.querySelectorAll('tfoot td');
            expect(footerCells.length).toBe(1);
        });
    });

    describe('self-contained styling and numeric alignment', () => {
        it('carries the interactive-table cell class on body cells with no .markdown-body ancestor', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            expect(container.closest('.markdown-body')).toBeNull();
            const tds = container.querySelectorAll('tbody td');
            expect(tds.length).toBeGreaterThan(0);
            tds.forEach(td => {
                expect(td.classList.contains('interactive-table-cell')).toBe(true);
            });
            container.querySelectorAll('th').forEach(th => {
                expect(th.classList.contains('interactive-table-cell')).toBe(true);
            });
        });

        it('wraps body cell content in the width-capped text block', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const firstCell = container.querySelector('tbody td')!;
            const inner = firstCell.querySelector('.interactive-table-cell-text');
            // The 320px cap only works on a block child — a max-width on the <td>
            // is ignored by the auto table layout, which floors each column at
            // its nowrap min-content width.
            expect(inner).toBeTruthy();
            expect(inner!.textContent).toBe('Alice');
        });

        it('sets title to the plain-text cell value', () => {
            const long = 'a-very-long-value-that-will-not-fit-in-the-column-at-all';
            const props = {
                ...defaultProps,
                rows: [[long, '90'], ['Bob', '85']],
            };
            const { container } = render(<InteractiveTable {...props} />);
            const firstCell = container.querySelector('tbody td')!;
            expect(firstCell.getAttribute('title')).toBe(long);
        });

        it('strips HTML from the title attribute', () => {
            const props = {
                ...defaultProps,
                rows: [['<strong>Alice</strong>', '90'], ['Bob', '85']],
            };
            const { container } = render(<InteractiveTable {...props} />);
            const firstCell = container.querySelector('tbody td')!;
            expect(firstCell.getAttribute('title')).toBe('Alice');
        });

        it('omits title on empty cells', () => {
            const props = {
                ...defaultProps,
                rows: [['', '90'], ['Bob', '85']],
            };
            const { container } = render(<InteractiveTable {...props} />);
            const firstCell = container.querySelector('tbody td')!;
            expect(firstCell.getAttribute('title')).toBeNull();
        });

        it('right-aligns numeric columns even when alignments say left', () => {
            const props = {
                ...defaultProps,
                alignments: ['left' as const, 'left' as const],
            };
            const { container } = render(<InteractiveTable {...props} />);
            const ths = container.querySelectorAll('th');
            expect(ths[0].classList.contains('text-left')).toBe(true);
            expect(ths[1].classList.contains('text-right')).toBe(true);
            expect(ths[1].classList.contains('interactive-table-numeric')).toBe(true);

            const firstRowCells = container.querySelectorAll('tbody tr')[0].querySelectorAll('td');
            expect(firstRowCells[0].classList.contains('text-left')).toBe(true);
            expect(firstRowCells[1].classList.contains('text-right')).toBe(true);
            expect(firstRowCells[1].classList.contains('interactive-table-numeric')).toBe(true);
        });

        it('lets an explicit non-left alignment win over the numeric default', () => {
            const props = {
                ...defaultProps,
                alignments: ['left' as const, 'center' as const],
            };
            const { container } = render(<InteractiveTable {...props} />);
            const ths = container.querySelectorAll('th');
            expect(ths[1].classList.contains('text-center')).toBe(true);
            expect(ths[1].classList.contains('text-right')).toBe(false);
        });

        it('keeps the aggregation footer cell right-aligned', () => {
            const { container } = render(<InteractiveTable {...defaultProps} />);
            const aggCell = container.querySelector('tfoot td.interactive-table-agg-cell.text-right');
            expect(aggCell).not.toBeNull();
            expect(aggCell!.classList.contains('interactive-table-cell')).toBe(true);
        });
    });

    describe('fill height', () => {
        it('does not opt into fill height by default', () => {
            render(<InteractiveTable {...defaultProps} />);
            const root = screen.getByTestId('interactive-table-test-1');
            expect(root.classList.contains('interactive-table-fill')).toBe(false);
        });

        it('adds the fill-height class when fillHeight is set', () => {
            render(<InteractiveTable {...defaultProps} fillHeight />);
            const root = screen.getByTestId('interactive-table-test-1');
            expect(root.classList.contains('interactive-table-fill')).toBe(true);
        });

        it('keeps the scroll container as a direct child so it owns the scroll', () => {
            render(<InteractiveTable {...defaultProps} fillHeight />);
            const root = screen.getByTestId('interactive-table-test-1');
            const scroll = root.querySelector(':scope > .interactive-table-scroll');
            expect(scroll).not.toBeNull();
            expect(scroll!.querySelector('table.interactive-md-table')).not.toBeNull();
        });
    });

});
