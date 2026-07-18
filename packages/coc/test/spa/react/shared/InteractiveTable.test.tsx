/**
 * Tests for InteractiveTable — TanStack Table component for sorted,
 * filtered, paginated markdown tables with aggregation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { InteractiveTable, isNumericColumn, tableToCsv } from '../../../../src/server/spa/client/react/shared/InteractiveTable';

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
});
