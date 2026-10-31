import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'postcss';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Canvas, CanvasVersion } from '@plusplusoneplusplus/coc-client';
import { CanvasBodyRenderer } from '../../../src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer';
import { canvasKind } from '../../../src/server/spa/client/react/features/canvas/canvas-panel-model';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';
import { MarkdownView } from '../../../src/server/spa/client/react/shared/MarkdownView';
import { UnifiedPanelHostProvider } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';

vi.mock('../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/canvas/ExtensionCanvasView', () => ({
    ExtensionCanvasView: () => null,
}));
vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: () => null }));

const LONG_URL = `https://example.com/${'long-segment/'.repeat(20)}index.html`;
const LONG_CODE = `someLongFunctionName(${'unbrokenArgument'.repeat(15)})`;
const LONG_TEXT = 'Long words and details that need to fit in a narrow panel. '.repeat(10);
const CONTENT = [
    '| Resource<br>details | Count |',
    '| :---: | ---: |',
    `| **bold<br>continued**<br/>*italic*<br />[${LONG_URL}](${LONG_URL}) \`${LONG_CODE}\` | 10 |`,
    '| `<br>` &lt;br/&gt; \\<br /> <br onclick=alert(1)> <img src=x onerror=alert(1)> | 20 |',
    `| ${LONG_TEXT} | 30 |`,
    '| third | 40 |',
    '| fourth | 50 |',
].join('\n');
const SMALL = `| Resource | Value |\n| --- | --- |\n| \`${LONG_CODE}\` | ${LONG_TEXT} |`;

const onDraftChange = vi.fn();
const onCanvasSaved = vi.fn();
function canvasBody(content = CONTENT, options: {
    id?: string;
    workspaceId?: string;
    routingRef?: string | null;
    revision?: number;
    mode?: 'preview' | 'edit';
    viewingVersion?: CanvasVersion;
} = {}) {
    const canvas: Canvas = {
        id: options.id ?? 'report', workspaceId: options.workspaceId ?? 'ws-a',
        type: 'markdown', title: 'Report', content, revision: options.revision ?? 1,
        lastEditor: 'ai', createdAt: '', updatedAt: '',
    };
    return <CanvasBodyRenderer
        workspaceId={canvas.workspaceId} routingRef={options.routingRef}
        canvasId={canvas.id} canvas={canvas} kind={canvasKind(canvas, content)}
        loading={false} loadError={null} viewingVersion={options.viewingVersion ?? null}
        viewingRevision={options.viewingVersion?.revision ?? canvas.revision}
        displayedContent={content} draft={content} mode={options.mode ?? 'preview'}
        onDraftChange={onDraftChange} onCanvasSaved={onCanvasSaved}
        onSelectionChange={() => {}} onImageMenu={() => {}} notify={() => {}}
    />;
}
function interactive(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>('.interactive-table')!;
}
function wrap(root: HTMLElement): HTMLElement {
    return within(root).getByRole('button', { name: 'Wrap text' });
}

// jsdom has no layout. Apply the real shared rules to verify the cascade and
// break/scroll contracts, not pixel measurements or container-query evaluation.
const css = parse(readFileSync(resolve(__dirname, '../../../src/server/spa/client/tailwind.css'), 'utf8'));
let sharedStyles: HTMLStyleElement;
beforeEach(() => {
    vi.clearAllMocks();
    sharedStyles = document.createElement('style');
    sharedStyles.textContent = css.nodes.filter(node =>
        node.type === 'rule' && (
            node.selector.includes('interactive-') ||
            /\.markdown-body (?:table|th|td|code)\b/.test(node.selector)
        ),
    ).map(node => node.toString()).join('\n');
    document.head.append(sharedStyles);
});
afterEach(() => {
    cleanup();
    sharedStyles.remove();
});

describe('Markdown canvas shares response table wrapping', () => {
    it.each([280, 320, 400, 1280])('uses the same wrap controls and shared layout rules in a %ipx panel', width => {
        const { container } = render(<div style={{ width }}>
            <div data-testid="answer" className="chat-message-content">
                <MarkdownView html={chatMarkdownToHtml(CONTENT, 'ws-a')} tableWrapToggle />
            </div>
            {canvasBody()}
        </div>);
        const answer = interactive(within(container).getByTestId('answer'));
        const canvas = interactive(within(container).getByTestId('canvas-panel-preview'));
        expect(canvas).not.toBeNull();
        expect(canvas.querySelector('table')?.innerHTML).toBe(answer.querySelector('table')?.innerHTML);
        for (const root of [answer, canvas]) {
            const button = wrap(root);
            expect(button).toHaveAttribute('type', 'button');
            expect(button).toHaveAttribute('aria-pressed', 'false');
            expect(button).toHaveAttribute('title', 'Wrap text to fit the pane');
            expect(root.querySelector('colgroup')).not.toBeNull();
            expect(getComputedStyle(root.querySelector('table')!).minWidth).toBe('380px');
            expect(getComputedStyle(root.querySelector('.interactive-table-scroll')!).overflowX).toBe('auto');
            expect(getComputedStyle(root.querySelector('.interactive-table-toolbar')!).flexWrap).toBe('wrap');
            expect(getComputedStyle(root.querySelector('.interactive-table-actions')!).flexWrap).toBe('wrap');
            const cell = root.querySelector('tbody td')!;
            const code = cell.querySelector('code')!;
            const original = cell.innerHTML;
            expect(cell).toHaveTextContent(LONG_CODE);
            expect(root).toHaveTextContent(LONG_TEXT.trim());
            expect(cell.querySelector('a')).toHaveAttribute('href', LONG_URL);
            expect(getComputedStyle(cell).whiteSpace).toBe('nowrap');

            fireEvent.click(button);
            expect(button).toHaveAttribute('aria-pressed', 'true');
            expect(root).toHaveClass('interactive-table-wrapped');
            expect(root.querySelector('colgroup')).toBeNull();
            expect(getComputedStyle(root.querySelector('table')!).minWidth).toBe('0');
            expect(getComputedStyle(root.querySelector('table')!).tableLayout).toBe('auto');
            for (const text of [cell, cell.querySelector('.interactive-table-cell-text')!, code]) {
                expect(getComputedStyle(text).whiteSpace).toBe('normal');
                expect(getComputedStyle(text).overflowWrap).toBe('anywhere');
            }
            expect(cell.innerHTML).toBe(original);
            expect(root.querySelectorAll('thead th')).toHaveLength(2);
            expect(root.querySelectorAll('tbody tr')).toHaveLength(5);
            expect(root.querySelectorAll('tbody td br')).toHaveLength(3);
            expect(root.querySelector('thead th br')).not.toBeNull();
            expect(root.querySelector('tbody tr:nth-child(2) code')).toHaveTextContent('<br>');
            expect(root.querySelector('img, [onclick]')).toBeNull();
            for (const title of ['Copy as Markdown', 'Copy as CSV', 'Show filters', 'Expand table', 'Toggle column visibility']) {
                expect(within(root).getByTitle(title)).toBeEnabled();
            }
            fireEvent.click(button);
            expect(button).toHaveAttribute('aria-pressed', 'false');
            expect(root.querySelector('colgroup')).not.toBeNull();
        }
        expect(onDraftChange).not.toHaveBeenCalled();
        expect(onCanvasSaved).not.toHaveBeenCalled();
    });

    it('keeps wrapping local to each table and each response/canvas surface', () => {
        const content = `${CONTENT}\n\nBetween\n\n${CONTENT}`;
        const { container } = render(<>
            <div data-testid="answer"><MarkdownView html={chatMarkdownToHtml(content)} tableWrapToggle /></div>
            {canvasBody(content)}
        </>);
        const canvases = container.querySelectorAll<HTMLElement>('[data-testid="canvas-panel-preview"] .interactive-table');
        fireEvent.click(wrap(canvases[1]));
        expect(wrap(canvases[0])).toHaveAttribute('aria-pressed', 'false');
        expect(wrap(canvases[1])).toHaveAttribute('aria-pressed', 'true');
        for (const button of within(within(container).getByTestId('answer')).getAllByRole('button', { name: 'Wrap text' })) {
            expect(button).toHaveAttribute('aria-pressed', 'false');
        }
    });

    it('retains wrapping through content/history revisions and cleans up replaced portals', () => {
        const { container, rerender, unmount } = render(canvasBody());
        fireEvent.click(wrap(interactive(container)));
        const oldMount = container.querySelector('.interactive-table-mount')!;
        const updated = `${CONTENT}\n| latest | 60 |`;
        rerender(canvasBody(updated, { revision: 2 }));
        expect(oldMount.isConnected).toBe(false);
        expect(container.querySelectorAll('.interactive-table-mount')).toHaveLength(1);
        expect(wrap(interactive(container))).toHaveAttribute('aria-pressed', 'true');
        expect(interactive(container).querySelectorAll('tbody tr')).toHaveLength(6);
        const viewingVersion: CanvasVersion = { revision: 1, title: 'Report', editor: 'ai', content: CONTENT, updatedAt: '' };
        rerender(canvasBody(CONTENT, { revision: 2, viewingVersion }));
        expect(wrap(interactive(container))).toHaveAttribute('aria-pressed', 'true');
        expect(interactive(container).querySelectorAll('tbody tr')).toHaveLength(5);
        unmount();
        expect(document.querySelector('.interactive-table-mount')).toBeNull();
        expect(onCanvasSaved).not.toHaveBeenCalled();
    });

    it.each([
        { id: 'another' },
        { workspaceId: 'ws-b' },
        { routingRef: null },
        { routingRef: 'remote:server-b:ws-a' },
    ])('resets wrapping when the canvas owner/document changes: %j', options => {
        const { container, rerender } = render(canvasBody());
        fireEvent.click(wrap(interactive(container)));
        rerender(canvasBody(CONTENT, options));
        expect(wrap(interactive(container))).toHaveAttribute('aria-pressed', 'false');
        expect(container.querySelectorAll('.interactive-table-mount')).toHaveLength(1);
    });

    it('restores static content and removes portals when switching to small tables, edit mode or empty content', () => {
        const { container, rerender } = render(canvasBody());
        rerender(canvasBody(SMALL));
        expect(container.querySelector('.interactive-table-mount')).toBeNull();
        expect(container.querySelector('table')).toBeVisible();
        expect(container.querySelector('code')).toHaveTextContent(LONG_CODE);
        expect(within(container).queryByRole('button', { name: 'Wrap text' })).toBeNull();
        rerender(canvasBody(CONTENT, { mode: 'edit' }));
        expect(container.querySelector('textarea')).toHaveValue(CONTENT);
        expect(container.querySelector('table')).toBeNull();
        rerender(canvasBody(''));
        expect(container).toHaveTextContent('Empty canvas.');
        expect(container.querySelector('.interactive-table-mount')).toBeNull();
    });

    it('preserves sorting and filtering while wrapped in a hosting panel', () => {
        const { container } = render(<UnifiedPanelHostProvider host={{ workspaceId: 'ws-a', chatId: 'chat-a' }}>
            {canvasBody()}
        </UnifiedPanelHostProvider>);
        const root = interactive(container);
        fireEvent.click(wrap(root));
        fireEvent.click(root.querySelector('th[data-col-id="col_1"]')!);
        expect(root.querySelector('tbody td:nth-child(2)')).toHaveTextContent('10');
        fireEvent.click(within(root).getByTitle('Show filters'));
        fireEvent.change(within(root).getAllByRole('textbox')[0], { target: { value: 'fourth' } });
        expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(wrap(root)).toHaveAttribute('aria-pressed', 'true');
        expect(root).toHaveTextContent('1 of 5 rows');
    });
});
