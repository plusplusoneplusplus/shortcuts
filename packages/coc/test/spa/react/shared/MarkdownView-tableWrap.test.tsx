/**
 * @vitest-environment jsdom
 *
 * Per-table "Wrap text" toggle on AI-response Markdown tables. Layout itself
 * is proven in the browser (test/e2e/chat-table-wrap.spec.ts); this covers the
 * state contract: opt-in, independence and streaming re-renders.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownView } from '../../../../src/server/spa/client/react/shared/MarkdownView';
import { chatMarkdownToHtml } from '../../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';

const LONG_URL = 'https://example.com/a/very/long/path/that/does/not/contain/any/spaces/at/all/index.html';

/** A table large enough (≥ 5 rows) to be upgraded to an interactive one. */
function bigTable(label: string): string {
    return [
        `| ${label} | Location |`,
        '| --- | ---: |',
        `| [docs](${LONG_URL}) | \`packages/coc/src/server/spa/client/react/shared/MarkdownView.tsx\` |`,
        ...Array.from({ length: 5 }, (_, i) => `| ${label}-${i} | /very/long/path/segment-${i}/with/no/spaces/file.ts |`),
    ].join('\n');
}
const SMALL = ['| A | B |', '| --- | --- |', '| x | y |'].join('\n');

function wrapButtons(): HTMLElement[] {
    return screen.queryAllByRole('button', { name: 'Wrap text' });
}

function tableOf(btn: HTMLElement): HTMLElement {
    return btn.closest<HTMLElement>('.interactive-table')!;
}

afterEach(cleanup);

describe('MarkdownView table wrap toggle', () => {
    it('is not shown unless the surface opts in', () => {
        render(<MarkdownView html={chatMarkdownToHtml(bigTable('First'))} />);
        expect(screen.getByText('6 rows')).toBeTruthy();
        expect(wrapButtons()).toHaveLength(0);
    });

    it('only appears on interactive tables; static ones already wrap via prose styles', () => {
        const { container } = render(<MarkdownView html={chatMarkdownToHtml(SMALL)} tableWrapToggle />);
        expect(container.querySelector('table')).not.toBeNull();
        expect(wrapButtons()).toHaveLength(0);
    });

    it('defaults off and toggles with an accessible pressed button', () => {
        render(<MarkdownView html={chatMarkdownToHtml(bigTable('First'))} tableWrapToggle />);
        const [btn] = wrapButtons();
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(btn.getAttribute('title')).toBe('Wrap text to fit the pane');
        const table = tableOf(btn);
        expect(table.classList.contains('interactive-table-wrapped')).toBe(false);

        fireEvent.click(btn);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.getAttribute('title')).toMatch(/Stop wrapping/);
        expect(table.classList.contains('interactive-table-wrapped')).toBe(true);

        fireEvent.click(btn);
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(table.classList.contains('interactive-table-wrapped')).toBe(false);
    });

    it('keeps rich cell content and the rest of the toolbar when wrapped', () => {
        render(<MarkdownView html={chatMarkdownToHtml(bigTable('First'))} tableWrapToggle />);
        const [btn] = wrapButtons();
        const table = tableOf(btn);
        const alignBefore = Array.from(table.querySelectorAll('th, td')).map(c => c.className);
        fireEvent.click(btn);
        expect(Array.from(table.querySelectorAll('th, td')).map(c => c.className)).toEqual(alignBefore);
        expect(table.querySelectorAll('thead th')).toHaveLength(2);
        expect(table.querySelectorAll('tbody tr')).toHaveLength(6);
        expect(table.querySelector(`a[href="${LONG_URL}"]`)).not.toBeNull();
        expect(table.querySelector('code')?.textContent).toContain('MarkdownView.tsx');
        for (const name of ['Copy as Markdown', 'Copy as CSV', 'Expand table', 'Show filters']) {
            expect(within(table).getByTitle(name)).toBeTruthy();
        }
    });

    it('keeps independent tables independent', () => {
        render(
            <MarkdownView html={chatMarkdownToHtml(`${bigTable('First')}\n\ntext\n\n${bigTable('Second')}`)} tableWrapToggle />,
        );
        const [first, second] = wrapButtons();
        fireEvent.click(second);
        expect(first.getAttribute('aria-pressed')).toBe('false');
        expect(second.getAttribute('aria-pressed')).toBe('true');
        expect(tableOf(first).classList.contains('interactive-table-wrapped')).toBe(false);
    });

    it('keeps the toggle state across streaming html updates', () => {
        const { rerender } = render(
            <MarkdownView html={chatMarkdownToHtml(`Intro\n\n${bigTable('First')}\n\nMore`)} tableWrapToggle />,
        );
        fireEvent.click(wrapButtons()[0]);

        // A new chunk arrives: the html string changes and every table portal remounts.
        const grown = chatMarkdownToHtml(`Intro\n\n${bigTable('First')}\n\nMore text arriving\n\n${bigTable('Second')}`);
        rerender(<MarkdownView html={grown} tableWrapToggle />);

        const [first, second] = wrapButtons();
        expect(wrapButtons()).toHaveLength(2);
        expect(first.getAttribute('aria-pressed')).toBe('true');
        expect(tableOf(first).classList.contains('interactive-table-wrapped')).toBe(true);
        expect(second.getAttribute('aria-pressed')).toBe('false');
    });

    it('carries the state over when section actions re-enable after streaming', () => {
        const html = chatMarkdownToHtml(bigTable('First'));
        const { rerender } = render(<MarkdownView html={html} tableWrapToggle />);
        fireEvent.click(wrapButtons()[0]);
        rerender(<MarkdownView html={html} hideSectionCopy tableWrapToggle />);
        expect(wrapButtons()).toHaveLength(0);
        rerender(<MarkdownView html={html} tableWrapToggle />);
        expect(wrapButtons()[0].getAttribute('aria-pressed')).toBe('true');
    });
});
