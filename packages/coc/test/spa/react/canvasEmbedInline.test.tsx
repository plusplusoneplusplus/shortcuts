/**
 * @vitest-environment jsdom
 *
 * Regression coverage for inline canvas:// references. The persisted canvas
 * descriptor is the source of truth: its type decides which viewer mounts.
 */

import React, { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Canvas } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    getExtension: vi.fn(),
    invokeCapability: vi.fn(),
    client: null as unknown,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => mocks.client,
}));

vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: ({ initialData }: { initialData: { elements?: unknown[] } }) => (
        <div
            data-testid="mock-excalidraw"
            data-element-count={Array.isArray(initialData?.elements) ? initialData.elements.length : 0}
        />
    ),
    restoreElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
    convertToExcalidrawElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
}));

import { MarkdownView } from '../../../src/server/spa/client/react/shared/MarkdownView';
import { CanvasEmbed } from '../../../src/server/spa/client/react/shared/CanvasEmbed';
import { ChatRenderContextProvider } from '../../../src/server/spa/client/react/features/chat/conversation/ChatRenderContext';
import { KustoEmbedGroupProvider } from '../../../src/server/spa/client/react/shared/KustoEmbedGroup';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import { ConversationArea } from '../../../src/server/spa/client/react/features/chat/ConversationArea';
import { CANVAS_HOST_VERSION } from '../../../src/server/spa/client/react/features/canvas/canvas-host-contract';

mocks.client = {
    canvases: {
        get: mocks.get,
        getExtension: mocks.getExtension,
        invokeCapability: mocks.invokeCapability,
    },
};

const SCENE = JSON.stringify({
    elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b', type: 'ellipse', x: 20, y: 0, width: 10, height: 10 },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
});

const EXTENSION = {
    manifest: {
        description: 'Notes Chat header redesign',
        capabilities: [{ name: 'set_scope', description: 'Change chat scope' }],
    },
    uiHtml: '<main><header><strong>Notes Chat</strong><button>This note</button><button>Workspace</button></header></main>',
    capabilitiesJs: 'capabilities = { set_scope: function (state) { return state; } };',
};

describe('inline canvas:// embed', () => {
    beforeEach(() => {
        mocks.get.mockReset();
        mocks.getExtension.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('preserves the Excalidraw preview for an Excalidraw canvas', async () => {
        mocks.get.mockResolvedValue({
            id: 'arch',
            workspaceId: 'ws-1',
            title: 'Architecture',
            type: 'excalidraw',
            content: SCENE,
            revision: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        });

        const html = chatMarkdownToHtml('Here it is: canvas://arch', 'ws-1', { canvasEmbedEnabled: true });
        expect(html).toContain('data-canvas-id="arch"');
        expect(html).toContain('md-canvas-embed');

        render(<MarkdownView html={html} />);

        await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('ws-1', 'arch'));
        const viewer = await screen.findByTestId('mock-excalidraw');
        expect(viewer.getAttribute('data-element-count')).toBe('2');
    });

    it('renders an extension canvas through its sandboxed iframe instead of Excalidraw', async () => {
        mocks.get.mockResolvedValue({
            id: 'notes-chat-header-redesign-d68498',
            workspaceId: 'ws-1',
            title: 'Notes Chat Header Redesign',
            type: 'extension',
            content: JSON.stringify({ scope: 'note', pinned: false, compact: true }),
            revision: 11,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'user',
        });
        mocks.getExtension.mockResolvedValue(EXTENSION);

        const html = chatMarkdownToHtml(
            'canvas://notes-chat-header-redesign-d68498',
            'ws-1',
            { canvasEmbedEnabled: true },
        );
        render(<MarkdownView html={html} />);

        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        expect(mocks.get).toHaveBeenCalledWith('ws-1', 'notes-chat-header-redesign-d68498');
        expect(mocks.getExtension).toHaveBeenCalledWith('ws-1', 'notes-chat-header-redesign-d68498');
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
        expect(iframe.getAttribute('srcdoc')).toContain('window.CanvasHost');
        expect(iframe.getAttribute('srcdoc')).toContain('Notes Chat');
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });

    /**
     * The inline embed mounts the same ExtensionCanvasView as the side panel, so
     * the CanvasHost request/response bridge must round-trip here too — an embed
     * that got the v1 fire-and-forget bootstrap would hang every `await`.
     */
    it('round-trips a CanvasHost request through the inline embed', async () => {
        mocks.get.mockResolvedValue({
            id: 'notes-chat-header-redesign-d68498',
            workspaceId: 'ws-1',
            title: 'Notes Chat Header Redesign',
            type: 'extension',
            content: JSON.stringify({ pinned: false }),
            revision: 11,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'user',
        });
        mocks.getExtension.mockResolvedValue(EXTENSION);
        mocks.invokeCapability.mockResolvedValue({
            id: 'notes-chat-header-redesign-d68498',
            workspaceId: 'ws-1',
            title: 'Notes Chat Header Redesign',
            type: 'extension',
            content: JSON.stringify({ pinned: true }),
            revision: 12,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'user',
        });

        const html = chatMarkdownToHtml('canvas://notes-chat-header-redesign-d68498', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        expect(iframe.getAttribute('srcdoc')).toContain(`version: ${CANVAS_HOST_VERSION}`);

        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        const event = new MessageEvent('message', {
            data: { __canvasHost: true, id: 5, type: 'invoke-capability', name: 'toggle_pin', params: {} },
        });
        Object.defineProperty(event, 'source', { value: iframe.contentWindow, enumerable: true });
        act(() => { window.dispatchEvent(event); });

        await waitFor(() => expect(postMessage).toHaveBeenCalledWith({
            __canvasHost: true,
            type: 'response',
            id: 5,
            ok: true,
            result: { revision: 12, state: { pinned: true } },
        }, '*'));
    });

    it('renders a Kusto canvas through the interactive Kusto view', async () => {
        mocks.get.mockResolvedValue({
            id: 'expl-canvas',
            workspaceId: 'ws-1',
            title: 'Storm data',
            type: 'kusto',
            content: JSON.stringify({
                query: 'StormEvents | take 5',
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
                columns: [{ name: 'State', type: 'string' }],
                rows: [['Texas']],
                truncated: false,
                lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 1 },
            }),
            revision: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        });

        const html = chatMarkdownToHtml('canvas://expl-canvas', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const embed = await screen.findByTestId('canvas-embed-kusto');
        expect(mocks.get).toHaveBeenCalledWith('ws-1', 'expl-canvas');
        expect(embed.querySelector('[data-testid="kusto-query"]')).toBeTruthy();
        expect(screen.getByText('Texas')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });

    it.each([
        { type: 'markdown', content: '# Project brief', label: 'markdown' },
        { type: 'code', content: 'const scope = "note";', label: 'typescript', language: 'typescript' },
    ])('renders a $type canvas as a document instead of an empty diagram', async ({ type, content, label, language }) => {
        mocks.get.mockResolvedValue({
            id: `${type}-canvas`,
            workspaceId: 'ws-1',
            title: 'Reference',
            type,
            content,
            language,
            revision: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        });

        const html = chatMarkdownToHtml(`canvas://${type}-canvas`, 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const preview = await screen.findByTestId('canvas-embed-document');
        expect(preview.textContent).toContain(content);
        expect(preview.textContent).toContain(label);
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });

    function kustoCanvas(id: string) {
        return {
            id,
            workspaceId: 'ws-1',
            title: `Query ${id}`,
            type: 'kusto',
            content: JSON.stringify({
                query: 'StormEvents | take 5',
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
                columns: [{ name: 'State', type: 'string' }],
                rows: [['Texas']],
                truncated: false,
                lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 1 },
            }),
            revision: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        };
    }

    const canvasKinds = [
        { type: 'markdown', content: '# Brief' },
        { type: 'code', language: 'typescript', content: 'const x = 1;' },
        { type: 'code', language: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg" />' },
        { type: 'excalidraw', content: SCENE },
        { type: 'extension', content: '{}' },
        { type: 'kusto', content: kustoCanvas('sample').content },
    ];

    it.each(canvasKinds)('defaults $type/$language closed only in Sentinel and retains choices through HTML updates', async kind => {
        mocks.get.mockResolvedValue({ ...kustoCanvas('artifact'), ...kind });
        mocks.getExtension.mockResolvedValue(EXTENSION);
        const fixture = (mode: string, suffix = '') => (
            <ChatRenderContextProvider value={{ wsId: 'ws-1', chatId: 'chat-1', conversationMode: mode }}>
                <KustoEmbedGroupProvider>
                    <MarkdownView html={chatMarkdownToHtml(`canvas://artifact${suffix}`, 'ws-1', { canvasEmbedEnabled: true })} />
                </KustoEmbedGroupProvider>
            </ChatRenderContextProvider>
        );
        const view = render(fixture('sentinel'));
        const toggleId = kind.type === 'kusto' ? 'canvas-embed-kusto-toggle' : 'canvas-embed-toggle';
        await screen.findByRole('button', { name: 'Query artifact' });
        expect(screen.getByTestId(toggleId)).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('canvas-embed-body')).not.toBeVisible();
        expect(screen.getByTestId('canvas-embed-body')).toHaveAttribute('inert');
        expect(screen.getByTestId('canvas-embed-body')).toHaveStyle({ display: 'none' });
        fireEvent.click(screen.getByTestId(toggleId));
        expect(screen.getByTestId('canvas-embed-body')).toBeVisible();
        view.rerender(fixture('sentinel', '\n\nMore response text'));
        await screen.findByRole('button', { name: 'Query artifact' });
        expect(screen.getByTestId(toggleId)).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByTestId(toggleId));
        view.rerender(fixture('sentinel', '\n\nUpdated again'));
        await screen.findByRole('button', { name: 'Query artifact' });
        expect(screen.getByTestId(toggleId)).toHaveAttribute('aria-expanded', 'false');
        view.unmount();
        render(fixture('ask'));
        await screen.findByRole('button', { name: 'Query artifact' });
        await waitFor(() => expect(screen.getByTestId(toggleId)).toHaveAttribute('aria-expanded', 'true'));
    });

    it('keeps every Sentinel Kusto closed as group members arrive, honoring manual expansion', async () => {
        mocks.get.mockImplementation((_ws: string, id: string) => Promise.resolve(kustoCanvas(id)));
        const fixture = (ids: string[]) => (
            <ChatRenderContextProvider value={{ conversationMode: 'sentinel', chatId: 'chat-1' }}>
                <KustoEmbedGroupProvider>
                    {ids.map(id => <CanvasEmbed key={id} workspaceId="ws-1" canvasId={id} />)}
                </KustoEmbedGroupProvider>
            </ChatRenderContextProvider>
        );
        const view = render(fixture(['k1', 'k2']));
        await screen.findByRole('button', { name: 'Query k2' });
        expect(screen.getAllByTestId('canvas-embed-kusto-toggle').map(el => el.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
        fireEvent.click(screen.getByRole('button', { name: 'Query k1' }));
        view.rerender(fixture(['k1', 'k2', 'k3']));
        await screen.findByRole('button', { name: 'Query k3' });
        expect(screen.getAllByTestId('canvas-embed-kusto-toggle').map(el => el.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
    });

    it.each(['workspace', 'chat', 'canvas', 'owner'] as const)('isolates Sentinel choices across %s routing and portal remounts', async scope => {
        mocks.get.mockResolvedValue({ ...kustoCanvas('artifact'), type: 'markdown' });
        const fixture = (next: boolean) => {
            const workspaceId = scope === 'workspace' && next ? 'remote:owner:ws-1' : 'ws-1';
            return <ChatRenderContextProvider value={{ wsId: workspaceId, chatId: scope === 'chat' && next ? 'chat-2' : 'chat-1', conversationMode: 'sentinel', conversationOwnerKey: scope === 'owner' && next ? 'https://remote.example/ws-1' : 'local/ws-1' }}>
                <MarkdownView html={chatMarkdownToHtml(`canvas://${scope === 'canvas' && next ? 'other' : 'artifact'}`, workspaceId, { canvasEmbedEnabled: true })} />
            </ChatRenderContextProvider>;
        };
        const view = render(fixture(false));
        await screen.findByRole('button', { name: 'Query artifact' });
        fireEvent.click(screen.getByTestId('canvas-embed-toggle'));
        view.rerender(fixture(true));
        await waitFor(() => expect(screen.getByTestId('canvas-embed-toggle')).toHaveAttribute('aria-expanded', 'false'));
        expect(mocks.get).toHaveBeenLastCalledWith(scope === 'workspace' ? 'remote:owner:ws-1' : 'ws-1', scope === 'canvas' ? 'other' : 'artifact');
    });

    it('retains separate Sentinel choices for repeated references after HTML replacement', async () => {
        mocks.get.mockResolvedValue({ ...kustoCanvas('same'), type: 'markdown' });
        const fixture = (tail = '') => <ChatRenderContextProvider value={{ wsId: 'ws-1', chatId: 'chat-1', conversationMode: 'sentinel' }}>
            <MarkdownView html={chatMarkdownToHtml(`canvas://same\n\ncanvas://same${tail}`, 'ws-1', { canvasEmbedEnabled: true })} />
        </ChatRenderContextProvider>;
        const view = render(fixture());
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Query same' })).toHaveLength(2));
        fireEvent.click(screen.getAllByTestId('canvas-embed-toggle')[0]);
        view.rerender(fixture('\n\nMore text'));
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Query same' })).toHaveLength(2));
        expect(screen.getAllByTestId('canvas-embed-toggle').map(el => el.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    });

    it('starts collapsed during loading and retains a manual expand through completion and mode updates', async () => {
        let resolveLoad!: (canvas: Canvas) => void;
        mocks.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
        const fixture = (conversationMode: string) => <ChatRenderContextProvider value={{ conversationMode }}>
            <CanvasEmbed workspaceId="ws-1" canvasId="loading" />
        </ChatRenderContextProvider>;
        const view = render(fixture('sentinel'));
        expect(screen.getByTestId('canvas-embed-loading')).not.toBeVisible();
        fireEvent.click(screen.getByTestId('canvas-embed-toggle'));
        await act(async () => { resolveLoad({ ...kustoCanvas('loading'), type: 'markdown' } as Canvas); });
        expect(screen.getByTestId('canvas-embed-toggle')).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByTestId('canvas-embed-toggle'));
        view.rerender(fixture('ask'));
        expect(screen.getByTestId('canvas-embed-toggle')).toHaveAttribute('aria-expanded', 'false');
    });

    it('gives historical Excalidraw placeholders the Sentinel disclosure', async () => {
        mocks.get.mockResolvedValue({ ...kustoCanvas('legacy'), type: 'excalidraw', content: SCENE });
        render(<ChatRenderContextProvider value={{ conversationMode: 'sentinel' }}>
            <MarkdownView html='<div class="md-excalidraw-embed" data-ws-id="ws-1" data-canvas-id="legacy"></div>' />
        </ChatRenderContextProvider>);
        await screen.findByRole('button', { name: 'Query legacy' });
        expect(screen.getByTestId('canvas-embed-toggle')).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(screen.getByTestId('canvas-embed-toggle'));
        expect(await screen.findByTestId('mock-excalidraw')).toBeVisible();
    });

    it.each(['sentinel', 'ask'])('passes actual %s conversation mode through normal and pinned turn bodies', async conversationMode => {
        mocks.get.mockResolvedValue({ ...kustoCanvas('artifact'), type: 'markdown' });
        vi.stubGlobal('__DASHBOARD_CONFIG__', { canvasEnabled: true });
        render(<ConversationArea
            loading={false} error={null} pendingQueue={[]} isScrolledUp={false}
            scrollRef={createRef<HTMLDivElement>()} onScrollToBottom={() => {}}
            isPending={false} task={{ status: 'completed', displayName: 'Sentinel' }} fullTask={null}
            onCancel={() => {}} onMoveToTop={() => {}} variant="inline" taskId="chat-1" wsId="ws-1"
            conversationMode={conversationMode} onPinTurn={() => {}}
            turns={[{ role: 'assistant', content: 'canvas://artifact', timestamp: '2026-01-01T00:00:00Z', turnIndex: 0, mode: 'ask', pinnedAt: '2026-01-01T00:00:00Z' }]}
        />);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Query artifact', hidden: true })).toHaveLength(2));
        for (const toggle of screen.getAllByTestId('canvas-embed-toggle')) {
            expect(toggle).toHaveAttribute('aria-expanded', String(conversationMode !== 'sentinel'));
        }
    });

    function renderGroupedKustoEmbeds() {
        mocks.get.mockImplementation((_ws: string, id: string) => Promise.resolve(kustoCanvas(id)));
        const html = chatMarkdownToHtml('canvas://k1\n\ncanvas://k2', 'ws-1', { canvasEmbedEnabled: true });
        return render(
            <KustoEmbedGroupProvider>
                <MarkdownView html={html} />
            </KustoEmbedGroupProvider>,
        );
    }

    it('keeps only the most recent Kusto embed expanded when several are grouped', async () => {
        renderGroupedKustoEmbeds();

        // The last embed in document order stays open; earlier ones collapse.
        await waitFor(() => {
            const embeds = screen.getAllByTestId('canvas-embed-kusto');
            expect(embeds).toHaveLength(2);
            expect(embeds[0].getAttribute('data-expanded')).toBe('false');
            expect(embeds[1].getAttribute('data-expanded')).toBe('true');
        });

        // Both editors stay mounted; the earlier one is hidden with its draft intact.
        expect(screen.getAllByTestId('kusto-query')).toHaveLength(2);
        const embeds = screen.getAllByTestId('canvas-embed-kusto');
        expect(embeds[1].querySelector('[data-testid="kusto-query"]')).toBeTruthy();
        expect(embeds[0].querySelector('[data-testid="kusto-query"]')).not.toBeVisible();
        // The collapsed embed still shows its header + summary so it can be reopened.
        expect(embeds[0].querySelector('[data-testid="canvas-embed-kusto-summary"]')?.textContent).toBe('1 row');
    });

    it('expands a collapsed Kusto embed when the reader clicks its header', async () => {
        renderGroupedKustoEmbeds();

        await waitFor(() => {
            expect(screen.getAllByTestId('canvas-embed-kusto')[0].getAttribute('data-expanded')).toBe('false');
        });

        fireEvent.click(screen.getAllByTestId('canvas-embed-kusto-toggle')[0]);

        await waitFor(() => {
            expect(screen.getAllByTestId('canvas-embed-kusto')[0].getAttribute('data-expanded')).toBe('true');
        });
        // Both are now open — the last by default, the first by the reader's click.
        expect(screen.getAllByTestId('kusto-query')).toHaveLength(2);
    });

    it('stays expanded for a lone Kusto embed with no surrounding group', async () => {
        mocks.get.mockResolvedValue(kustoCanvas('solo'));
        const html = chatMarkdownToHtml('canvas://solo', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const embed = await screen.findByTestId('canvas-embed-kusto');
        expect(embed.getAttribute('data-expanded')).toBe('true');
        expect(embed.querySelector('[data-testid="kusto-query"]')).toBeTruthy();
    });

    it('hoists the cluster/database editors into the embed header to save space', async () => {
        mocks.get.mockResolvedValue(kustoCanvas('solo'));
        const html = chatMarkdownToHtml('canvas://solo', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        // The editors mount into the header slot (portaled by KustoView)...
        await waitFor(() => {
            const slot = screen.getByTestId('canvas-embed-kusto-connection-slot');
            expect(slot.querySelector('[data-testid="kusto-cluster"]')).toBeTruthy();
            expect(slot.querySelector('[data-testid="kusto-database"]')).toBeTruthy();
        });
        // ...while the query editor remains in the body.
        const embed = screen.getByTestId('canvas-embed-kusto');
        expect(embed.querySelector('[data-testid="kusto-query"]')).toBeTruthy();
    });

    it.each(['markdown', 'code', 'excalidraw', 'extension', 'kusto'] as const)(
        'collapses the entire %s body without unmounting it',
        async type => {
            mocks.get.mockResolvedValue({ ...kustoCanvas('one'), type, content: type === 'excalidraw' ? SCENE : kustoCanvas('one').content });
            mocks.getExtension.mockResolvedValue(EXTENSION);
            render(<CanvasEmbed workspaceId="ws-1" canvasId="one" />);
            const toggle = await screen.findByRole('button', { name: 'Query one' });
            const body = screen.getByTestId('canvas-embed-body');
            await waitFor(() => expect(body.querySelector('pre, iframe, [data-testid="kusto-query"], [data-testid="mock-excalidraw"]')).toBeTruthy());
            const child = body.firstElementChild;
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            expect(toggle).toHaveAttribute('aria-controls', body.id);
            fireEvent.click(toggle);
            expect(body).not.toBeVisible();
            expect(body).toHaveAttribute('inert');
            expect(body.style.display).toBe('none');
            expect(toggle).toBeVisible();
            fireEvent.click(toggle);
            expect(body).toBeVisible();
            expect(body).not.toHaveAttribute('inert');
            expect(body.firstElementChild).toBe(child);
            expect(mocks.get).toHaveBeenCalledTimes(1);
        },
    );

    it('uses native Enter and Space activation with independent state for repeated embeds', async () => {
        mocks.get.mockResolvedValue({ ...kustoCanvas('same'), type: 'markdown' });
        const user = userEvent.setup();
        render(<><CanvasEmbed workspaceId="ws-1" canvasId="same" /><CanvasEmbed workspaceId="ws-1" canvasId="same" /></>);
        const toggles = await screen.findAllByRole('button', { name: 'Query same' });
        expect(toggles[0].getAttribute('aria-controls')).not.toBe(toggles[1].getAttribute('aria-controls'));
        toggles[0].focus();
        await user.keyboard('{Enter}');
        expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
        expect(toggles[1]).toHaveAttribute('aria-expanded', 'true');
        await user.tab();
        expect(toggles[1]).toHaveFocus();
        toggles[0].focus();
        await user.keyboard(' ');
        expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    });

    it.each(['sentinel', 'ask'])('preserves the %s extension frame and saved updates while collapsed', async conversationMode => {
        const canvas = { ...kustoCanvas('extension'), type: 'extension', content: '{"pinned":false}' };
        mocks.get.mockResolvedValue(canvas);
        mocks.getExtension.mockResolvedValue(EXTENSION);
        mocks.invokeCapability.mockResolvedValue({ ...canvas, title: 'Updated title', content: '{"pinned":true}', revision: 4 });
        render(<ChatRenderContextProvider value={{ conversationMode }}><CanvasEmbed workspaceId="ws-1" canvasId="extension" /></ChatRenderContextProvider>);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const frameWindow = iframe.contentWindow;
        const srcDoc = iframe.srcdoc;
        const postMessage = vi.fn();
        Object.defineProperty(frameWindow, 'postMessage', { value: postMessage, configurable: true });
        if (conversationMode !== 'sentinel') fireEvent.click(screen.getByRole('button', { name: 'Query extension' }));
        const event = new MessageEvent('message', {
            data: { __canvasHost: true, id: 8, type: 'invoke-capability', name: 'set_scope', params: {} },
        });
        Object.defineProperty(event, 'source', { value: frameWindow });
        act(() => { window.dispatchEvent(event); });
        const toggle = await screen.findByRole('button', { name: 'Updated title' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'response', id: 8, ok: true }), '*'));
        fireEvent.click(toggle);
        expect(screen.getByTestId('extension-canvas-iframe')).toBe(iframe);
        expect(iframe.contentWindow).toBe(frameWindow);
        expect(iframe.srcdoc).toBe(srcDoc);
    });

    it('keeps loading and error content behind the same disclosure', async () => {
        let rejectLoad!: (reason: Error) => void;
        mocks.get.mockReturnValue(new Promise((_resolve, reject) => { rejectLoad = reject; }));
        render(<CanvasEmbed workspaceId="ws-1" canvasId="missing" />);
        const toggle = screen.getByRole('button', { name: 'Loading canvas…' });
        fireEvent.click(toggle);
        expect(screen.getByTestId('canvas-embed-loading')).not.toBeVisible();
        await act(async () => { rejectLoad(new Error('gone')); });
        expect(screen.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('canvas-embed-error')).not.toBeVisible();
        fireEvent.click(toggle);
        expect(screen.getByTestId('canvas-embed-error')).toBeVisible();
    });

    it('keeps a manual collapse when loading completes', async () => {
        let resolveLoad!: (canvas: Canvas) => void;
        mocks.get.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
        render(<CanvasEmbed workspaceId="ws-1" canvasId="loading" />);
        fireEvent.click(screen.getByTestId('canvas-embed-toggle'));
        await act(async () => { resolveLoad({ ...kustoCanvas('loading'), type: 'markdown' }); });
        expect(screen.getByRole('button', { name: 'Query loading' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('canvas-embed-document')).not.toBeVisible();
    });

    it('leaves canvas-disabled references as links without mounting a disclosure', () => {
        const html = chatMarkdownToHtml('canvas://disabled', 'ws-1', { canvasEmbedEnabled: false });
        render(<MarkdownView html={html} />);
        expect(screen.queryByTestId('canvas-embed-toggle')).toBeNull();
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it.each(['workspace', 'chat', 'canvas', 'owner'] as const)('resets disclosure and rejects stale loads on a %s switch', async scope => {
        let resolveOld!: (canvas: Canvas) => void;
        mocks.get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
        mocks.get.mockResolvedValue({ ...kustoCanvas('new'), type: 'markdown' });
        const fixture = (workspaceId: string, chatId: string, canvasId: string, conversationOwnerKey = 'local') => (
            <ChatRenderContextProvider value={{ wsId: workspaceId, chatId, conversationOwnerKey }}>
                <CanvasEmbed workspaceId={workspaceId} canvasId={canvasId} />
            </ChatRenderContextProvider>
        );
        const view = render(fixture('ws-1', 'chat-1', 'old'));
        fireEvent.click(screen.getByTestId('canvas-embed-toggle'));
        view.rerender(fixture(scope === 'workspace' ? 'ws-2' : 'ws-1', scope === 'chat' ? 'chat-2' : 'chat-1', scope === 'canvas' ? 'new' : 'old', scope === 'owner' ? 'remote' : 'local'));
        const toggle = await screen.findByRole('button', { name: 'Query new' });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await act(async () => { resolveOld({ ...kustoCanvas('old'), type: 'markdown' }); });
        expect(screen.queryByRole('button', { name: 'Query old' })).toBeNull();
        fireEvent.click(toggle);
        view.rerender(fixture(scope === 'workspace' ? 'ws-2' : 'ws-1', scope === 'chat' ? 'chat-2' : 'chat-1', scope === 'canvas' ? 'new' : 'old', scope === 'owner' ? 'remote' : 'local'));
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('preserves Kusto query and connection drafts through manual toggles', async () => {
        mocks.get.mockResolvedValue(kustoCanvas('solo'));
        render(<CanvasEmbed workspaceId="ws-1" canvasId="solo" />);
        const query = await screen.findByTestId('kusto-query');
        const cluster = await screen.findByTestId('kusto-cluster');
        fireEvent.change(query, { target: { value: 'StormEvents | take 42' } });
        fireEvent.change(cluster, { target: { value: 'https://example.com' } });
        const toggle = screen.getByTestId('canvas-embed-kusto-toggle');
        fireEvent.click(toggle);
        expect(query).not.toBeVisible();
        expect(cluster).not.toBeVisible();
        expect(cluster.closest('[inert]')).toBeTruthy();
        fireEvent.click(toggle);
        expect(screen.getByTestId('kusto-query')).toBe(query);
        expect(query).toHaveValue('StormEvents | take 42');
        expect(cluster).toHaveValue('https://example.com');
    });
});
