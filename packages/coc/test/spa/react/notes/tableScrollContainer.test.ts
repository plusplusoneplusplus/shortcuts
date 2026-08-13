/**
 * tableScrollContainer.test.ts — the horizontal scroll container for a table
 * wider than the note body (AC-12).
 *
 * `noteEditorCss.test.ts` already asserts that a `.tableWrapper { overflow-x:
 * auto }` rule exists, but a CSS rule is only worth anything if its selector
 * matches something real. The element it targets is not written by us — it is
 * built by a tiptap node view. So the rule can silently stop applying without
 * any test noticing: rename a class, or mount the editor outside
 * `.note-editor`, and a wide table goes back to overflowing the page with every
 * existing test still green.
 *
 * This file closes that gap from the DOM side. It builds a real headless editor
 * configured exactly as `RichEditorCore.tsx` configures it, mounts it inside the
 * `.note-editor` wrapper the app uses, and feeds the *actual selector text* out
 * of `noteEditor.css` to `querySelector`.
 *
 * What it deliberately does not check: that the wrapper actually scrolls. jsdom
 * does no layout — every box is 0×0 and `overflow-x` has no observable effect —
 * so the visual half of AC-12 stays a manual browser check.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

const css = readFileSync(
    resolve(
        __dirname,
        '../../../../src/server/spa/client/react/features/notes/editor/noteEditor.css',
    ),
    'utf-8',
);

/** Mirrors RichEditorCore.tsx. */
const TABLE_CONFIG = {
    resizable: true,
    handleWidth: 5,
    cellMinWidth: 60,
    lastColumnResizable: true,
};

const TABLE_HTML = `
<table><tbody>
<tr><th colwidth="400">A</th><th colwidth="400">B</th></tr>
<tr><td colwidth="400">1</td><td colwidth="400">2</td></tr>
</tbody></table>`;

let editor: Editor | null = null;
let host: HTMLElement | null = null;

/**
 * Mounts an editor inside the same `.note-editor` wrapper the app renders, so
 * the descendant selectors in noteEditor.css have their full ancestor chain.
 */
function mount(config: Record<string, unknown> = TABLE_CONFIG): HTMLElement {
    host = document.createElement('div');
    host.className = 'note-editor';
    document.body.appendChild(host);
    editor = new Editor({
        element: host,
        extensions: [
            StarterKit.configure({ link: false }),
            Table.configure(config),
            TableRow,
            TableHeader,
            TableCell,
        ],
        content: TABLE_HTML,
    });
    return host;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
    host?.remove();
    host = null;
});

/** The selector list of the `.tableWrapper` rule, as written in the stylesheet. */
function wrapperRuleSelector(): string {
    const rule = css.match(/([^{}]*\.tableWrapper[^{}]*)\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    // It is the scroll container or this test is pointing at the wrong rule.
    expect(rule![2]).toMatch(/overflow-x:\s*auto/);
    return rule![1].trim();
}

describe('note table horizontal scroll container (AC-12)', () => {
    it('renders the .tableWrapper the scroll rule targets, wrapping the table', () => {
        mount();
        const wrapper = host!.querySelector('div.tableWrapper');
        expect(wrapper).not.toBeNull();
        // The table must be *inside* the scroll container, not a sibling —
        // otherwise overflow-x on the wrapper never sees the overflow.
        expect(wrapper!.querySelector('table')).not.toBeNull();
    });

    it("the CSS rule's own selector matches that wrapper in a mounted editor", () => {
        mount();
        const selector = wrapperRuleSelector();
        // Read straight out of noteEditor.css: if anyone renames a class in the
        // rule, or the app stops wrapping the editor in `.note-editor`, this
        // stops matching and AC-12 regresses silently.
        expect(selector).toContain('.tableWrapper');
        expect(document.querySelector(selector)).toBe(
            host!.querySelector('div.tableWrapper'),
        );
    });

    it('scrolls the wrapper rather than the table, which stays clipped', () => {
        // `overflow: hidden` on the table is what clips the absolutely
        // positioned cell-selection tint and the resize handle to it, so the
        // scrolling has to happen one level out.
        const tableRule = css.match(
            /\.note-editor\s+\.ProseMirror\s+table\s*\{[^}]+\}/,
        )?.[0];
        expect(tableRule).toBeDefined();
        expect(tableRule).toMatch(/overflow:\s*hidden/);
        expect(tableRule).not.toMatch(/overflow-x:\s*auto/);
        expect(wrapperRuleSelector()).not.toMatch(/table\s*$/);
    });

    it('keeps the wrapper even with resizable off, so the rule does not hinge on AC-01', () => {
        // The wrapper is not our markup — it comes from a tiptap node view. That
        // node view is the resizing plugin's TableView when `resizable` is true
        // and tiptap's own TableView when it is false, and *both* emit
        // div.tableWrapper. So the scroll container survives a config change;
        // pinning that here means a future `resizable` tweak does not have to
        // re-derive whether AC-12 still holds.
        mount({ ...TABLE_CONFIG, resizable: false });
        const wrapper = host!.querySelector('div.tableWrapper');
        expect(wrapper).not.toBeNull();
        expect(wrapper!.querySelector('table')).not.toBeNull();
    });
});
