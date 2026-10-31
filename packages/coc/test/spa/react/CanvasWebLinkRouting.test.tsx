// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CanvasBodyRenderer } from '../../../src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer';
import { UnifiedPanelHostProvider } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import '../../../src/server/spa/client/react/shared/file-path/file-path-preview';

vi.mock('@plusplusoneplusplus/forge/editor/rendering', () => import('../../../../forge/src/editor/rendering'));

const OPEN_EVENT = 'coc-open-browser-url';
const ROUTE = 'remote:server-b:member';
const host = { workspaceId: 'group', chatId: 'chat-1' };

type Detail = { url: string; owner?: unknown; handled?: boolean };
let events: Detail[] = [];
let panelTakes = true;
const listener = (event: Event) => {
    const detail = (event as CustomEvent<Detail>).detail;
    events.push({ ...detail });
    if (panelTakes) detail.handled = true;
};

function renderCanvas(content: string, options: { hosted?: boolean; routingRef?: string | null } = {}) {
    const body = (
        <CanvasBodyRenderer workspaceId="member" routingRef={'routingRef' in options ? options.routingRef : ROUTE} canvasId="plan"
            canvas={{ id: 'plan', type: 'markdown', content } as any}
            kind={{ isCode: false, isSvg: false, isExtension: false, isExcalidraw: false, isKusto: false } as any}
            loading={false} loadError={null} viewingVersion={null} viewingRevision={1}
            displayedContent={content} draft={content} mode="preview"
            onDraftChange={vi.fn()} onCanvasSaved={vi.fn()} onSelectionChange={vi.fn()}
            onImageMenu={vi.fn()} notify={vi.fn()} />
    );
    render(options.hosted === false ? body : <UnifiedPanelHostProvider host={host}>{body}</UnifiedPanelHostProvider>);
}

function click(text: string | HTMLElement, init: MouseEventInit = {}) {
    const link = typeof text === 'string' ? screen.getByText(text) : text;
    // Stop jsdom navigation for anything the code under test leaves alone.
    const guard = (event: Event) => event.preventDefault();
    window.addEventListener('click', guard);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    let preventedBeforeGuard = false;
    const probe = (e: Event) => { preventedBeforeGuard = e.defaultPrevented; };
    document.addEventListener('click', probe);
    link.dispatchEvent(event);
    document.removeEventListener('click', probe);
    window.removeEventListener('click', guard);
    return { prevented: preventedBeforeGuard };
}

describe('canvas web links open in the panel browser tab', () => {
    beforeEach(() => {
        events = [];
        panelTakes = true;
        Object.defineProperty(window, 'cocDesktop', { value: { isDesktop: true, browser: { open: vi.fn() } }, configurable: true });
        window.addEventListener(OPEN_EVENT, listener);
    });
    afterEach(() => {
        cleanup();
        window.removeEventListener(OPEN_EVENT, listener);
        delete (window as { cocDesktop?: unknown }).cocDesktop;
        localStorage.clear();
    });

    it('routes a plain click to the panel with the canvas owner and panel scope', () => {
        renderCanvas('[Docs](https://example.com/docs)');
        expect(click('Docs').prevented).toBe(true);
        expect(events).toEqual([{
            url: 'https://example.com/docs',
            owner: { scopeWorkspaceId: 'group', workspaceId: 'member', routingRef: ROUTE, chatId: 'chat-1' },
        }]);
    });

    it('keeps a local owner pinned with a null route, and handles http links', () => {
        renderCanvas('[Plain](http://example.org/)', { routingRef: null });
        expect(click('Plain').prevented).toBe(true);
        expect(events[0]).toMatchObject({ url: 'http://example.org/', owner: { workspaceId: 'member', routingRef: null } });
    });

    it('routes keyboard activation (a click with no pointer detail) the same way', () => {
        renderCanvas('[Docs](https://example.com/docs)');
        expect(click('Docs', { detail: 0 }).prevented).toBe(true);
        expect(events).toHaveLength(1);
    });

    it('keeps owner-qualified browser routing on links inside a wrapped interactive table', () => {
        renderCanvas([
            '| Link | Count |',
            '| --- | ---: |',
            '| [Docs](https://example.com/docs) | 1 |',
            '| second | 2 |',
            '| third | 3 |',
            '| fourth | 4 |',
            '| fifth | 5 |',
        ].join('\n'));
        const table = screen.getByTestId('canvas-panel-preview').querySelector<HTMLElement>('.interactive-table')!;
        const wrap = within(table).getByRole('button', { name: 'Wrap text' });
        fireEvent.click(wrap);
        expect(wrap).toHaveAttribute('aria-pressed', 'true');
        expect(events).toHaveLength(0);
        const docs = within(table).getByRole('link', { name: 'Docs' });
        expect(click(docs).prevented).toBe(true);
        expect(events).toEqual([{
            url: 'https://example.com/docs',
            owner: { scopeWorkspaceId: 'group', workspaceId: 'member', routingRef: ROUTE, chatId: 'chat-1' },
        }]);
        expect(click(docs, { ctrlKey: true }).prevented).toBe(false);
        expect(events).toHaveLength(1);
    });

    it('keeps the default when no panel takes it, outside the desktop app, or without a hosting panel', () => {
        panelTakes = false;
        renderCanvas('[Docs](https://example.com/docs)');
        expect(click('Docs').prevented).toBe(false);
        expect(events).toHaveLength(1);
        cleanup();

        panelTakes = true;
        events = [];
        delete (window as { cocDesktop?: unknown }).cocDesktop;
        renderCanvas('[Docs](https://example.com/docs)');
        expect(click('Docs').prevented).toBe(false);
        expect(events).toHaveLength(0);
        cleanup();

        Object.defineProperty(window, 'cocDesktop', { value: { isDesktop: true, browser: { open: vi.fn() } }, configurable: true });
        renderCanvas('[Docs](https://example.com/docs)', { hosted: false });
        expect(click('Docs').prevented).toBe(false);
        expect(events).toHaveLength(0);
    });

    it.each([
        ['ctrl', { ctrlKey: true }],
        ['meta', { metaKey: true }],
        ['shift', { shiftKey: true }],
        ['alt', { altKey: true }],
    ])('leaves %s-click to the browser default', (_name, init) => {
        renderCanvas('[Docs](https://example.com/docs)');
        expect(click('Docs', init).prevented).toBe(false);
        expect(events).toHaveLength(0);
    });

    it.each([
        ['fragment anchor', '[Jump](#section)'],
        ['mailto', '[Mail](mailto:a@example.com)'],
        ['internal app route', `[App](${window.location.origin}/#repos/member)`],
        ['link-handler URL', '[Teams](https://teams.microsoft.com/l/chat/1)'],
    ])('does not send a %s to the browser tab', (_name, content) => {
        renderCanvas(content);
        click(screen.getByRole('link').textContent!);
        expect(events).toHaveLength(0);
    });

    it('leaves managed file links to the file-reference path', () => {
        renderCanvas('[Code](src/main.ts#L12)');
        click('Code');
        expect(events).toHaveLength(0);
    });
});
