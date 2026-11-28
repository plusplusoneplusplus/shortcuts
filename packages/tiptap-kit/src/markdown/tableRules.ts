import type TurndownService from 'turndown';
import { escapeAttr } from './htmlAttrs.js';

/** GFM pipe tables, with a raw-HTML fallback for tables a pipe table cannot express. */
export function addTableRules(turndown: TurndownService): void {
    // GFM table: <table>/<thead>/<tbody>/<tr>/<th>/<td> → pipe-table markdown
    turndown.addRule('tableCell', {
        filter: ['th', 'td'],
        replacement(content) {
            // Collapse in-cell breaks to GFM <br> (a pipe-table cell must be one
            // physical line); trim first so edge breaks don't leave a stray <br>.
            const cell = content.trim().replace(/\n+/g, '<br>');
            const escaped = cell.replace(/\|/g, '\\|');
            return `| ${escaped} `;
        },
    });

    turndown.addRule('tableRow', {
        filter: 'tr',
        replacement(content, node) {
            const row = `${content}|\n`;
            const isInThead = node.parentNode && node.parentNode.nodeName === 'THEAD';
            const thCells = Array.from(node.querySelectorAll('th'));

            let needsSeparator = isInThead || thCells.length > 0;

            // td-only tables (e.g. pasted content): first row still needs a GFM separator.
            // "First" means first in the whole table, not first in its section: a
            // <thead>+<tbody> table (what `markdownToHtml` emits) would otherwise get a
            // second separator after the first body row, splitting the table in two on the
            // way back to markdown.
            if (!needsSeparator && node.parentNode) {
                const table = (node as Element).closest?.('table');
                const firstTr = table
                    ? allTableRows(table)[0]
                    : Array.from(node.parentNode.childNodes).find(c => c.nodeName === 'TR');
                needsSeparator = firstTr === node;
            }

            if (needsSeparator) {
                const cells = thCells.length > 0 ? thCells : Array.from(node.querySelectorAll('td'));
                const separators = cells.map((cell) => {
                    const style = (cell as Element).getAttribute('style') ?? '';
                    // Tiptap writes alignment as `style="text-align: …"`; `marked` writes it
                    // as the HTML `align` attribute. Both have to be read or an aligned
                    // table loses its markers the first time it round-trips.
                    const align =
                        style.match(/text-align:\s*(\w+)/i)?.[1]
                        ?? (cell as Element).getAttribute('align')
                        ?? '';
                    if (align === 'center') return '| :---: ';
                    if (align === 'right') return '| ---: ';
                    return '| --- ';
                });
                const separator = separators.join('') + '|\n';
                return row + separator;
            }
            return row;
        },
    });

    turndown.addRule('tableSectionPassthrough', {
        filter: ['thead', 'tbody'],
        replacement(content) {
            return content;
        },
    });

    turndown.addRule('table', {
        filter: 'table',
        replacement(content) {
            const normalized = content.trim().replace(/\n{2,}/g, '\n');
            return `\n\n${normalized}\n\n`;
        },
    });

    // A table takes the pipe-table path above only when GFM syntax can express it in
    // full; otherwise it is emitted as a raw single-line HTML block that marked passes
    // through unchanged and Tiptap re-parses on reload — the same escape hatch
    // `indentedList` / `mathDisplay` use for content markdown cannot express. Two
    // things push a table off the pipe path:
    //
    //  1. Per-cell state with no pipe syntax: a dragged column width (`colwidth`, from
    //     ProseMirror's columnResizing plugin), a cell fill (`data-bg`, from the
    //     tableCellBackground extension) or a no-wrap column (`data-wrap`, from the
    //     tableColumnWrap extension).
    //  2. A header layout that is not GFM-shaped — see `isGfmShapedTable`. A pipe table
    //     is exactly one header row on top, so a header column, a lone header cell, or
    //     no header at all has no faithful pipe form.
    //
    // Everything a plain insert-and-type produces is still GFM-shaped with no per-cell
    // state, so only notes that actually used one of those features pay the cost of an
    // unreadable line-level diff.
    // NOTE: addRule() unshifts, so this must stay registered AFTER the plain `table`
    // rule for it to be checked (and win) first.
    const RAW_TABLE_CELL_SELECTOR =
        'th[colwidth], td[colwidth], th[data-bg], td[data-bg], th[data-wrap], td[data-wrap]';

    function tableRowChildren(parent: Element): Element[] {
        return Array.from(parent.children).filter(child => child.nodeName === 'TR');
    }

    function tableCellChildren(row: Element): Element[] {
        return Array.from(row.children).filter(
            child => child.nodeName === 'TH' || child.nodeName === 'TD',
        );
    }

    /**
     * Every `<tr>` under a table, in document order, whether it sits in a section
     * (`<thead>`/`<tbody>`/`<tfoot>`) or directly under `<table>` — Tiptap emits a
     * single `<tbody>` with no `<thead>`, pasted HTML may use either, and a DOM parser
     * can leave a bare `<tr>` in rare cases.
     */
    function allTableRows(table: Element): Element[] {
        const rows: Element[] = [];
        for (const child of Array.from(table.children)) {
            if (child.nodeName === 'TR') rows.push(child);
            else if (
                child.nodeName === 'THEAD' ||
                child.nodeName === 'TBODY' ||
                child.nodeName === 'TFOOT'
            ) {
                rows.push(...tableRowChildren(child));
            }
        }
        return rows;
    }

    /**
     * A GFM pipe table is exactly one header row across the top, so a table can take
     * the pipe path only when its first row is all `<th>` and no later row holds one.
     * Anything else — no header row, a header column, a single header cell — has no
     * pipe form and must serialize as raw HTML instead, or reload would silently
     * change its shape: a header-less table gets its first data row promoted by the
     * `tableRow` fallback, and a header column emits a separator line after *every*
     * row, which is not a table at all.
     *
     * A table with no rows, or whose first row has no cells, counts as GFM-shaped so
     * degenerate markup keeps its current output rather than churning into HTML.
     */
    function isGfmShapedTable(table: Element): boolean {
        const rows = allTableRows(table);
        if (rows.length === 0) return true;

        const headerCells = tableCellChildren(rows[0]);
        if (headerCells.length === 0) return true;
        if (!headerCells.every(cell => cell.nodeName === 'TH')) return false;

        return rows
            .slice(1)
            .every(row => tableCellChildren(row).every(cell => cell.nodeName !== 'TH'));
    }

    function cellColspan(cell: Element): number {
        return parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1;
    }

    /** First entry of a cell's `colwidth` array (one entry per spanned column). */
    function cellFirstColwidth(cell: Element): string | null {
        const first = (cell.getAttribute('colwidth') ?? '').split(',')[0]?.trim() ?? '';
        return /^\d+$/.test(first) ? first : null;
    }

    function serializeRawTableCell(cell: Element): string {
        const tag = cell.nodeName.toLowerCase();
        const attrs: string[] = [];
        for (const name of ['colspan', 'rowspan']) {
            const value = cell.getAttribute(name);
            if (value && value !== '1') attrs.push(`${name}="${escapeAttr(value)}"`);
        }
        const colwidth = cell.getAttribute('colwidth');
        if (colwidth) attrs.push(`colwidth="${escapeAttr(colwidth)}"`);
        // `data-bg` is the fill's primary carrier — an inert data attribute, so it
        // survives anything that might one day strip `style`. The style below is only
        // what makes the fill visible in renderers that are not the editor.
        const backgroundColor = cell.getAttribute('data-bg');
        if (backgroundColor) attrs.push(`data-bg="${escapeAttr(backgroundColor)}"`);
        // `data-wrap` is only ever emitted for a no-wrap cell — the default renders no
        // attribute — so its mere presence is the setting. Whitelisted like the rest:
        // the raw path copies the attributes it knows, never arbitrary pasted ones.
        const wrap = cell.getAttribute('data-wrap');
        if (wrap) attrs.push(`data-wrap="${escapeAttr(wrap)}"`);
        // A cell's `style` carries its text-align and its fill, both authored content —
        // only the *computed* style Table.renderHTML puts on <table>/<col> is dropped.
        const style = cell.getAttribute('style');
        if (style) attrs.push(`style="${escapeAttr(style)}"`);
        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
        // innerHTML keeps inline formatting (<strong>, <a>, …) as HTML; it is not
        // re-run through turndown, Tiptap parses it back directly.
        return `<${tag}${attrStr}>${cell.innerHTML}</${tag}>`;
    }

    /**
     * `<colgroup>` is a redundant convenience — the per-cell `colwidth` arrays are the
     * lossless record. One `<col>` per first-row cell is only correct when no cell in
     * that row is merged, so a `colspan > 1` first row drops the colgroup entirely
     * rather than emitting a mis-aligned one. A table that took the raw path for a
     * cell fill alone has no widths at all, and an all-bare `<col>` list would be
     * pure noise, so that case drops the colgroup too.
     */
    function serializeRawTableColgroup(firstRow: Element | null): string {
        if (!firstRow) return '';
        const cells = tableCellChildren(firstRow);
        if (cells.length === 0 || cells.some(cell => cellColspan(cell) > 1)) return '';
        if (cells.every(cell => cellFirstColwidth(cell) === null)) return '';
        const cols = cells.map(cell => {
            const width = cellFirstColwidth(cell);
            // `width` as an attribute, not a style: Tiptap's parseColgroupWidth reads
            // only the attribute, so a style-only colgroup round trip loses widths.
            return width ? `<col width="${width}">` : '<col>';
        });
        return `<colgroup>${cols.join('')}</colgroup>`;
    }

    function serializeRawTable(table: Element): string {
        const sections: string[] = [];
        let firstRow: Element | null = null;

        const pushSection = (tag: string, rows: Element[]): void => {
            if (rows.length === 0) return;
            if (!firstRow) firstRow = rows[0];
            sections.push(`<${tag}>${rows.map(serializeRawTableRow).join('')}</${tag}>`);
        };

        for (const child of Array.from(table.children)) {
            if (child.nodeName === 'THEAD' || child.nodeName === 'TBODY' || child.nodeName === 'TFOOT') {
                pushSection(child.nodeName.toLowerCase(), tableRowChildren(child));
            }
        }
        // Defensive: a <tr> parsed directly under <table> (DOM parsers normally insert
        // an implicit <tbody>, so this is rare) still needs a home.
        pushSection('tbody', tableRowChildren(table));

        return `<table>${serializeRawTableColgroup(firstRow)}${sections.join('')}</table>`;
    }

    function serializeRawTableRow(row: Element): string {
        return `<tr>${tableCellChildren(row).map(serializeRawTableCell).join('')}</tr>`;
    }

    turndown.addRule('rawTable', {
        filter(node) {
            if (node.nodeName !== 'TABLE') return false;
            const table = node as Element;
            // Truthiness, not `!== null`: turndown runs on the browser DOM in the app but
            // on domino under Node, and domino's querySelector returns `undefined` rather
            // than `null` for a miss — so `!== null` sent *every* table down the raw path.
            return (
                Boolean(table.querySelector(RAW_TABLE_CELL_SELECTOR)) ||
                !isGfmShapedTable(table)
            );
        },
        replacement(_content, node) {
            // The block must be a single physical line with no interior blank line, or
            // marked terminates the HTML block early and mangles the rest of the note.
            const html = serializeRawTable(node as Element).replace(/\s*\r?\n\s*/g, ' ');
            return `\n\n${html}\n\n`;
        },
    });
}
