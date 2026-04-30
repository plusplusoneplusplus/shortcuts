/**
 * extractTablesFromHtml — scrapes rendered `<table>` elements produced by
 * forge's `renderTable()` and extracts structured data for interactive
 * table upgrade via TanStack Table.
 *
 * Eligibility heuristic: ≥ MIN_ROWS data rows, ≥ 2 columns, not inside
 * a code block.
 */

/** Minimum data rows for a table to be eligible for interactive upgrade. */
export const MIN_ROWS = 5;

/** Minimum columns for upgrade eligibility. */
export const MIN_COLS = 2;

export type ColumnAlignment = 'left' | 'center' | 'right';

export interface ExtractedTableData {
    headers: string[];
    alignments: ColumnAlignment[];
    /** Each row is an array of innerHTML strings (may contain inline-markdown HTML). */
    rows: string[][];
    /** Original markdown recovered from the copy button's data attribute. */
    originalMarkdown: string;
}

export interface ExtractedTable {
    /** The original `<div class="md-table-container">` element. */
    containerEl: HTMLElement;
    data: ExtractedTableData;
}

/**
 * Infer alignment from the computed `text-align` style or CSS class on a
 * table cell element.
 */
function inferAlignment(cell: HTMLElement): ColumnAlignment {
    if (cell.classList.contains('align-center')) return 'center';
    if (cell.classList.contains('align-right')) return 'right';
    return 'left';
}

/**
 * Decode HTML-entity-encoded text from a `data-table-markdown` attribute.
 */
function decodeAttr(raw: string): string {
    return raw
        .replace(/&#10;/g, '\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
}

/**
 * Scan a container element for eligible tables and extract their data.
 *
 * Tables are identified by the `.md-table-container` wrapper emitted by
 * forge's `renderTable()`. Tables inside code blocks or failing the
 * eligibility heuristic are skipped.
 */
export function extractTablesFromHtml(container: HTMLElement): ExtractedTable[] {
    const results: ExtractedTable[] = [];
    const tableContainers = container.querySelectorAll<HTMLElement>('.md-table-container');

    for (const containerEl of tableContainers) {
        // Skip tables inside code blocks
        if (containerEl.closest('.code-block-container')) continue;

        const tableEl = containerEl.querySelector<HTMLTableElement>('table.md-table');
        if (!tableEl) continue;

        // Extract headers
        const headerCells = tableEl.querySelectorAll<HTMLTableCellElement>('thead th');
        if (headerCells.length < MIN_COLS) continue;

        const headers: string[] = [];
        const alignments: ColumnAlignment[] = [];
        headerCells.forEach(th => {
            headers.push(th.innerHTML);
            alignments.push(inferAlignment(th));
        });

        // Extract body rows
        const bodyRows = tableEl.querySelectorAll<HTMLTableRowElement>('tbody tr');
        if (bodyRows.length < MIN_ROWS) continue;

        const rows: string[][] = [];
        bodyRows.forEach(tr => {
            const cells = tr.querySelectorAll<HTMLTableCellElement>('td');
            const row: string[] = [];
            cells.forEach(td => row.push(td.innerHTML));
            rows.push(row);
        });

        // Recover original markdown from copy button
        const copyBtn = containerEl.querySelector<HTMLElement>('.md-table-copy-btn');
        const rawMarkdown = copyBtn?.getAttribute('data-table-markdown') ?? '';
        const originalMarkdown = rawMarkdown ? decodeAttr(rawMarkdown) : '';

        results.push({
            containerEl,
            data: { headers, alignments, rows, originalMarkdown },
        });
    }

    return results;
}
