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
 * table cell element. Handles both forge's class-based approach
 * (`align-center`, `align-right`) and `marked`'s inline style approach
 * (`style="text-align: center"`).
 */
function inferAlignment(cell: HTMLElement): ColumnAlignment {
    if (cell.classList.contains('align-center')) return 'center';
    if (cell.classList.contains('align-right')) return 'right';
    const style = cell.getAttribute('style') ?? '';
    if (/text-align:\s*center/i.test(style)) return 'center';
    if (/text-align:\s*right/i.test(style)) return 'right';
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
 * Try to extract data from a single `<table>` element.
 * Returns null if the table doesn't meet eligibility criteria.
 */
function extractFromTable(
    tableEl: HTMLTableElement,
    wrapperEl: HTMLElement,
): ExtractedTable | null {
    // Extract headers
    const headerCells = tableEl.querySelectorAll<HTMLTableCellElement>('thead th');
    if (headerCells.length < MIN_COLS) return null;

    const headers: string[] = [];
    const alignments: ColumnAlignment[] = [];
    headerCells.forEach(th => {
        headers.push(th.innerHTML);
        alignments.push(inferAlignment(th));
    });

    // Extract body rows
    const bodyRows = tableEl.querySelectorAll<HTMLTableRowElement>('tbody tr');
    if (bodyRows.length < MIN_ROWS) return null;

    const rows: string[][] = [];
    bodyRows.forEach(tr => {
        const cells = tr.querySelectorAll<HTMLTableCellElement>('td');
        const row: string[] = [];
        cells.forEach(td => row.push(td.innerHTML));
        rows.push(row);
    });

    // Recover original markdown from copy button (forge renderTable path)
    const copyBtn = wrapperEl.querySelector<HTMLElement>('.md-table-copy-btn');
    const rawMarkdown = copyBtn?.getAttribute('data-table-markdown') ?? '';
    const originalMarkdown = rawMarkdown ? decodeAttr(rawMarkdown) : '';

    return {
        containerEl: wrapperEl,
        data: { headers, alignments, rows, originalMarkdown },
    };
}

/**
 * Reconstruct markdown from extracted table data when no copy button is
 * present (e.g. tables rendered by `marked` rather than forge's
 * `renderTable`).
 */
function reconstructMarkdown(headers: string[], alignments: ColumnAlignment[], rows: string[][]): string {
    const stripTags = (html: string): string => {
        if (!html.includes('<')) return html;
        return html.replace(/<[^>]*>/g, '');
    };
    const headerLine = '| ' + headers.map(h => stripTags(h)).join(' | ') + ' |';
    const sepLine = '| ' + alignments.map(a => {
        if (a === 'center') return ':---:';
        if (a === 'right') return '---:';
        return '---';
    }).join(' | ') + ' |';
    const bodyLines = rows.map(row =>
        '| ' + row.map(c => stripTags(c)).join(' | ') + ' |'
    );
    return [headerLine, sepLine, ...bodyLines].join('\n');
}

/**
 * Scan a container element for eligible tables and extract their data.
 *
 * Supports two HTML shapes:
 * 1. Forge's `renderTable()`: `<div class="md-table-container"><table class="md-table">…</table></div>`
 * 2. Standard `marked` output: bare `<table><thead>…</thead><tbody>…</tbody></table>`
 *
 * Tables inside code blocks or failing the eligibility heuristic are skipped.
 */
export function extractTablesFromHtml(container: HTMLElement): ExtractedTable[] {
    const results: ExtractedTable[] = [];
    const seen = new Set<HTMLTableElement>();

    // Pass 1: forge-wrapped tables (`.md-table-container`)
    const tableContainers = container.querySelectorAll<HTMLElement>('.md-table-container');
    for (const wrapperEl of tableContainers) {
        if (wrapperEl.closest('.code-block-container')) continue;

        const tableEl = wrapperEl.querySelector<HTMLTableElement>('table');
        if (!tableEl) continue;
        seen.add(tableEl);

        const result = extractFromTable(tableEl, wrapperEl);
        if (result) results.push(result);
    }

    // Pass 2: bare `<table>` elements (e.g. from `marked`)
    const allTables = container.querySelectorAll<HTMLTableElement>('table');
    for (const tableEl of allTables) {
        if (seen.has(tableEl)) continue;
        if (tableEl.closest('.code-block-container')) continue;

        // Use the table itself as the container element
        const result = extractFromTable(tableEl, tableEl);
        if (result) {
            // If no originalMarkdown was recovered (no copy button), reconstruct it
            if (!result.data.originalMarkdown) {
                result.data.originalMarkdown = reconstructMarkdown(
                    result.data.headers,
                    result.data.alignments,
                    result.data.rows,
                );
            }
            results.push(result);
        }
    }

    return results;
}
