import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TABLE_CELL_COLORS } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableCellBackground';

const cssPath = resolve(
    __dirname,
    '../../../../src/server/spa/client/react/features/notes/editor/noteEditor.css',
);
const css = readFileSync(cssPath, 'utf-8');

describe('noteEditor.css theme consistency', () => {
    it('does not use @media (prefers-color-scheme) — all dark mode must use .dark class', () => {
        expect(css).not.toContain('prefers-color-scheme');
    });

    // --- Fenced code blocks (pre) ---

    it('light-mode pre uses a light background', () => {
        // The default (non-.dark) pre rule should have a light bg like #f6f8fa
        const preBlock = css.match(
            /\.note-editor\s+\.ProseMirror\s+pre\s*\{[^}]+\}/,
        );
        expect(preBlock).not.toBeNull();
        const bg = preBlock![0].match(/background:\s*(#[0-9a-fA-F]{6})/);
        expect(bg).not.toBeNull();
        // light backgrounds have high channel values; #f6f8fa → r=0xf6
        const r = parseInt(bg![1].slice(1, 3), 16);
        expect(r).toBeGreaterThan(0xc0);
    });

    it('dark-mode pre uses a dark background', () => {
        const darkPre = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+pre\s*\{[^}]+\}/,
        );
        expect(darkPre).not.toBeNull();
        expect(darkPre![0]).toContain('#1e1e1e');
    });

    it('dark-mode pre sets border-color', () => {
        const darkPre = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+pre\s*\{[^}]+\}/,
        );
        expect(darkPre).not.toBeNull();
        expect(darkPre![0]).toContain('border-color');
    });

    // --- Inline code ---

    it('light-mode inline code has an explicit text color', () => {
        const codeBlock = css.match(
            /\.note-editor\s+\.ProseMirror\s+code\s*\{[^}]+\}/,
        );
        expect(codeBlock).not.toBeNull();
        expect(codeBlock![0]).toMatch(/color:\s*#/);
    });

    it('dark-mode inline code has both background and text color', () => {
        const darkCode = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+code\s*\{[^}]+\}/,
        );
        expect(darkCode).not.toBeNull();
        expect(darkCode![0]).toContain('background');
        expect(darkCode![0]).toMatch(/color:\s*#/);
    });

    // --- pre code reset ---

    it('pre code inherits color and removes background', () => {
        const preCode = css.match(
            /\.note-editor\s+\.ProseMirror\s+pre\s+code\s*\{[^}]+\}/,
        );
        expect(preCode).not.toBeNull();
        expect(preCode![0]).toContain('background: none');
        expect(preCode![0]).toContain('color: inherit');
    });

    // --- Base content text color ---

    it('light-mode content area sets an explicit dark text color', () => {
        // The base .ProseMirror rule must set an explicit color so text does
        // not depend on an inherited value.
        const base = css.match(
            /\.note-editor\s+\.ProseMirror\s*\{[^}]+\}/,
        );
        expect(base).not.toBeNull();
        const color = base![0].match(/color:\s*(#[0-9a-fA-F]{6})/);
        expect(color).not.toBeNull();
        // A dark text color for light backgrounds → low red channel.
        const r = parseInt(color![1].slice(1, 3), 16);
        expect(r).toBeLessThan(0x40);
    });

    it('dark-mode content area sets a light text color', () => {
        // Without this rule, note body/heading text stays near-black and is
        // unreadable on the dark editor background.
        const darkBase = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s*\{[^}]+\}/,
        );
        expect(darkBase).not.toBeNull();
        const color = darkBase![0].match(/color:\s*(#[0-9a-fA-F]{6})/);
        expect(color).not.toBeNull();
        // A light text color for dark backgrounds → high red channel.
        const r = parseInt(color![1].slice(1, 3), 16);
        expect(r).toBeGreaterThan(0xc0);
    });

    // --- Links ---

    it('note editor links always use a pointer cursor', () => {
        const linkRule = css.match(
            /\.note-editor\s+\.ProseMirror\s+a\s*\{[^}]+\}/,
        );
        expect(linkRule).not.toBeNull();
        expect(linkRule![0]).toContain('cursor: pointer');
    });

    it('dark-mode links use a brighter color than the light-mode link', () => {
        const darkLink = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+a\s*\{[^}]+\}/,
        );
        expect(darkLink).not.toBeNull();
        const color = darkLink![0].match(/color:\s*(#[0-9a-fA-F]{6})/);
        expect(color).not.toBeNull();
        // The dark link blue should be lighter than the light-mode #0078d4.
        const g = parseInt(color![1].slice(3, 5), 16);
        expect(g).toBeGreaterThan(0x78);
    });

    // --- Highlight marks ---

    it('dark-mode highlight marks use dark text on the pale highlight swatch', () => {
        // Highlight backgrounds are drawn from a fixed pale palette in both
        // themes. A light text color here made highlighted text unreadable on
        // the pale swatch, so the dark-mode rule must set a dark ink color.
        const darkMark = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+mark\s*\{[^}]+\}/,
        );
        expect(darkMark).not.toBeNull();
        const color = darkMark![0].match(/color:\s*(#[0-9a-fA-F]{6})/);
        expect(color).not.toBeNull();
        // A dark ink color for the pale highlight → low red channel.
        const r = parseInt(color![1].slice(1, 3), 16);
        expect(r).toBeLessThan(0x40);
    });

    // --- Mermaid block toolbar button ---

    it('mermaid toolbar button has a visible border at rest', () => {
        const btnBlock = css.match(
            /\.mermaid-node-view-toolbar\s+button\s*\{[^}]+\}/,
        );
        expect(btnBlock).not.toBeNull();
        expect(btnBlock![0]).toMatch(/border:\s*1px solid #c0c0c0/);
    });

    it('mermaid toolbar button has a visible background at rest', () => {
        const btnBlock = css.match(
            /\.mermaid-node-view-toolbar\s+button\s*\{[^}]+\}/,
        );
        expect(btnBlock).not.toBeNull();
        expect(btnBlock![0]).toContain('background: #f5f5f5');
    });

    it('dark mode mermaid toolbar button has dark border and background', () => {
        const darkBtn = css.match(
            /\.dark\s+\.mermaid-node-view-toolbar\s+button\s*\{[^}]+\}/,
        );
        expect(darkBtn).not.toBeNull();
        expect(darkBtn![0]).toContain('border-color: #555');
        expect(darkBtn![0]).toContain('background: #2d2d2d');
    });
});

describe('noteEditor.css resizable tables', () => {
    const tableRule = () =>
        css.match(/\.note-editor\s+\.ProseMirror\s+table\s*\{[^}]+\}/)?.[0];
    const handleRule = () =>
        css.match(
            /\.note-editor\s+\.ProseMirror\s+\.column-resize-handle\s*\{[^}]+\}/,
        )?.[0];

    it('lays tables out with table-layout: fixed, which column resizing requires (AC-10)', () => {
        // With `auto` the browser recomputes column widths from cell content and
        // treats the plugin's <colgroup> widths as suggestions, so a drag
        // appears to do nothing or snaps back.
        expect(tableRule()).toBeDefined();
        expect(tableRule()).toMatch(/table-layout:\s*fixed/);
    });

    it('does not pin the table to width: 100%, which would redistribute every dragged pixel (AC-10)', () => {
        expect(tableRule()).not.toMatch(/[^-]width:\s*100%/);
        // …but an unsized table should still fill the note body.
        expect(tableRule()).toMatch(/min-width:\s*100%/);
    });

    it('keeps the resize handle visible instead of the old opacity: 0 stub (AC-02)', () => {
        expect(handleRule()).toBeDefined();
        expect(handleRule()).not.toMatch(/opacity:\s*0\s*;/);
        expect(handleRule()).toMatch(/cursor:\s*col-resize/);
    });

    it('keeps the col-resize cursor for the whole drag via the plugin .resize-cursor class (AC-02)', () => {
        const rule = css.match(
            /\.note-editor\s+\.ProseMirror\.resize-cursor\s*\{[^}]+\}/,
        );
        expect(rule).not.toBeNull();
        expect(rule![0]).toMatch(/cursor:\s*col-resize/);
    });

    it('gives the resize handle a dark-mode color (AC-11)', () => {
        const rule = css.match(
            /\.dark\s+\.note-editor\s+\.ProseMirror\s+\.column-resize-handle\s*\{[^}]+\}/,
        );
        expect(rule).not.toBeNull();
        expect(rule![0]).toMatch(/background:\s*#/);
    });

    it('scrolls a table wider than the note body inside the plugin tableWrapper (AC-12)', () => {
        const rule = css.match(
            /\.note-editor\s+\.ProseMirror\s+\.tableWrapper\s*\{[^}]+\}/,
        );
        expect(rule).not.toBeNull();
        expect(rule![0]).toMatch(/overflow-x:\s*auto/);
    });

    it('keeps cells position: relative and border-box so the handle anchors and dragged px match rendered px', () => {
        const cellRule = css.match(
            /\.note-editor\s+\.ProseMirror\s+th,\s*\.note-editor\s+\.ProseMirror\s+td\s*\{[^}]+\}/,
        );
        expect(cellRule).not.toBeNull();
        expect(cellRule![0]).toMatch(/position:\s*relative/);
        expect(cellRule![0]).toMatch(/box-sizing:\s*border-box/);
    });
});

describe('noteEditor.css indentation scale (data-indent)', () => {
    // The Notes indentation feature reuses ONE CSS scale for paragraphs,
    // headings, AND block-level visual embeds (image, pdfBlock, mapBlock,
    // mermaidBlock, mathDisplay): a `[data-indent="N"]` descendant of the editor
    // gets N × 2rem of left padding. The rule targets ANY descendant carrying the
    // attribute, so the same scale shifts an embed's NodeView wrapper without an
    // embed-specific system. Because the padding sits on an auto-width block, the
    // content box shrinks with the indent instead of overflowing the pane — the
    // responsiveness contract behind AC-03. These assertions lock the scale so
    // commands, parsing, and styling cannot drift.

    it('defines a 2rem-per-level left-padding step for every level 1 through 8', () => {
        for (let level = 1; level <= 8; level++) {
            const rule = css.match(
                new RegExp(
                    `\\.note-editor\\s+\\.ProseMirror\\s+\\[data-indent="${level}"\\]\\s*\\{[^}]+\\}`,
                ),
            );
            expect(rule, `missing rule for data-indent="${level}"`).not.toBeNull();
            expect(rule![0]).toContain(`padding-left: ${level * 2}rem`);
        }
    });

    it('scopes the indent rule as a descendant of the editor content area', () => {
        // A descendant combinator under `.ProseMirror` (not e.g. `p[data-indent]`)
        // is what lets an embed NodeView wrapper carrying the attribute be shifted
        // by the same rule as a paragraph or heading.
        expect(css).toMatch(/\.note-editor\s+\.ProseMirror\s+\[data-indent="1"\]/);
    });

    it('stops the scale at the shared MAX_INDENT of 8 (no level-9 rule)', () => {
        // The increase/decrease commands clamp at 8, so there must be a level-8
        // rule and no level-9 rule to keep in sync.
        expect(css).toMatch(/\[data-indent="8"\]/);
        expect(css).not.toMatch(/\[data-indent="9"\]/);
    });

    it('caps the resizable-image container at the available width so an indented image cannot overflow', () => {
        // A custom-width image is the one fixed-pixel embed. Its container and
        // <img> both carry `max-width: 100%`, so when a deep indent shrinks the
        // content box the image scales down to fit rather than pushing the pane
        // into horizontal overflow.
        const container = css.match(/\.image-resize-container\s*\{[^}]+\}/);
        expect(container).not.toBeNull();
        expect(container![0]).toContain('max-width: 100%');
        const containerImg = css.match(/\.image-resize-container\s+img\s*\{[^}]+\}/);
        expect(containerImg).not.toBeNull();
        expect(containerImg![0]).toContain('max-width: 100%');
    });
    it('styles find & replace matches, which the extension no longer injects styles for', () => {
        // RichEditorCore sets injectCSS: false because the bundled yellow fill is
        // indistinguishable from the first Highlight mark color. If these rules
        // go away, matches become invisible rather than merely ugly.
        const result = css.match(/\.note-editor\s+\.ProseMirror\s+\.find-and-replace-result\s*\{[^}]+\}/);
        expect(result).not.toBeNull();
        // An outline, not a fill, so a match inside a user highlight still reads.
        expect(result![0]).toContain('outline');

        const current = css.match(/\.note-editor\s+\.ProseMirror\s+\.find-and-replace-result-current\s*\{[^}]+\}/);
        expect(current).not.toBeNull();
    });

    it('gives find & replace matches a dark-mode treatment via the .dark class', () => {
        expect(css).toMatch(/\.dark\s+\.note-editor\s+\.ProseMirror\s+\.find-and-replace-result\s*\{/);
    });
});

describe('noteEditor.css table cell fill palette (AC-08)', () => {
    // `.note-editor .ProseMirror { … }` appears several times in the file (base
    // typography, the dark color override, …); the palette lives in whichever
    // one declares the variables, so match on that rather than on ordering.
    const blocks = (selector: RegExp) =>
        Array.from(css.matchAll(/([^{}]*)\{([^}]*)\}/g))
            // The capture also swallows any preceding comment, so compare on the
            // last line — the selector itself.
            .filter(m => selector.test(m[1].trim().split('\n').pop()!.trim()) && m[2].includes('--note-table-bg-'))
            .map(m => m[2]);
    const light = () => blocks(/^\.note-editor\s+\.ProseMirror$/)[0];
    const dark = () => blocks(/^\.dark\s+\.note-editor\s+\.ProseMirror$/)[0];

    it('defines every palette token in the light block', () => {
        expect(light()).toBeDefined();
        for (const { token } of TABLE_CELL_COLORS) {
            expect(light()).toContain(`--note-table-bg-${token}:`);
        }
    });

    it('redefines every palette token in the .dark block', () => {
        expect(dark()).toBeDefined();
        for (const { token } of TABLE_CELL_COLORS) {
            expect(dark()).toContain(`--note-table-bg-${token}:`);
        }
    });

    it('gives each token a different value per theme, or the fill would be unreadable in one of them', () => {
        const valueOf = (rule: string | undefined, token: string) =>
            rule?.match(new RegExp(`--note-table-bg-${token}:\\s*([^;]+);`))?.[1]?.trim();
        for (const { token, swatch } of TABLE_CELL_COLORS) {
            const lightValue = valueOf(light(), token);
            const darkValue = valueOf(dark(), token);
            expect(lightValue).toBe(swatch);
            expect(darkValue).toBeDefined();
            expect(darkValue).not.toBe(lightValue);
        }
    });

    it('leaves the default header grey as a plain element rule so an inline fill outranks it (AC-07)', () => {
        // The fill is an inline style on the <th>; inline specificity beats this
        // stylesheet rule with no extra CSS. Promoting it to a more specific or
        // !important rule would silently break header fills.
        const rule = css.match(/\.note-editor\s+\.ProseMirror\s+th\s*\{[^}]+\}/);
        expect(rule).not.toBeNull();
        expect(rule![0]).toMatch(/background:\s*#f3f3f3/);
        expect(rule![0]).not.toContain('!important');

        const darkRule = css.match(/\.dark\s+\.note-editor\s+\.ProseMirror\s+th\s*\{[^}]+\}/);
        expect(darkRule).not.toBeNull();
        expect(darkRule![0]).not.toContain('!important');
    });
});
