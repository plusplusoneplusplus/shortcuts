/**
 * AC-04: an inline canvas embed opens the unified panel's canvas tab.
 *
 * The embed is the one entry point that had no open action at all — it renders
 * the canvas inside the transcript — so what these cases pin is the affordance
 * itself and, above all, when it must NOT appear: with no panel hosting this
 * subtree, and with a panel that is currently showing a different chat's tabs.
 * Both would file a tab the user cannot see. The inline preview is unchanged in
 * every one of those cases.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

const mockCanvasesGet = vi.hoisted(() => vi.fn());
// One stable client object: `CanvasEmbed`'s fetch effect keys on the client's
// identity, so a fresh one per render would refetch forever.
const mockClient = vi.hoisted(() => ({ canvases: { get: null as never } }));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => mockClient,
}));
// The other canvas types bring their own heavy stacks; the document preview is
// enough to prove the shared open action sits above whichever body renders.
vi.mock('../../../../src/server/spa/client/react/features/canvas/ExtensionCanvasView', () => ({
    ExtensionCanvasView: () => <div data-testid="mock-extension-canvas" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/canvas/KustoView', () => ({
    KustoView: () => <div data-testid="mock-kusto-view" />,
    parseKustoContent: () => ({ rows: [], columns: [] }),
}));
vi.mock('../../../../src/server/spa/client/react/shared/ExcalidrawPreview', () => ({
    ExcalidrawPreview: () => <div data-testid="mock-excalidraw-preview" />,
}));

import { CanvasEmbed } from '../../../../src/server/spa/client/react/shared/CanvasEmbed';
import { ChatRenderContextProvider } from '../../../../src/server/spa/client/react/features/chat/conversation/ChatRenderContext';
import {
    UnifiedPanelHostProvider,
    type UnifiedPanelHost,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function renderEmbed({
    host,
    chatId = 'task-A',
    workspaceId = 'ws-1',
}: {
    host: UnifiedPanelHost | null;
    chatId?: string;
    workspaceId?: string;
}) {
    return render(
        <UnifiedPanelHostProvider host={host}>
            <ChatRenderContextProvider value={{ wsId: workspaceId, chatId }}>
                <CanvasEmbed workspaceId={workspaceId} canvasId="canvas-9" />
            </ChatRenderContextProvider>
        </UnifiedPanelHostProvider>,
    );
}

describe('canvas embed → unified panel canvas tab', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        mockCanvasesGet.mockReset();
        (mockClient.canvases as { get: unknown }).get = mockCanvasesGet;
        mockCanvasesGet.mockResolvedValue({
            id: 'canvas-9',
            title: 'Release plan',
            type: 'markdown',
            content: '# plan',
        });
    });

    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        localStorage.clear();
    });

    it('opens the embedded canvas as a chat-owned tab in the hosting panel', async () => {
        renderEmbed({ host: { workspaceId: 'ws-1', chatId: 'task-A' } });
        await screen.findByTestId('canvas-embed-document');

        await act(async () => {
            screen.getByTestId('canvas-embed-open-in-panel').click();
        });

        const tabs = visibleTabs(readUnifiedPanelState('ws-1'), 'task-A');
        expect(tabs).toHaveLength(1);
        expect(tabs[0]).toMatchObject({
            kind: 'canvas',
            ownerWorkspaceId: 'ws-1',
            resourceId: 'canvas-9',
            label: 'Release plan',
        });
    });

    it('reveals the panel and focuses the same tab when opened twice', async () => {
        renderEmbed({ host: { workspaceId: 'ws-1', chatId: 'task-A' } });
        await screen.findByTestId('canvas-embed-document');
        const button = screen.getByTestId('canvas-embed-open-in-panel');

        await act(async () => { button.click(); });
        await act(async () => { button.click(); });

        // One tab per resource: a second open focuses rather than stacks.
        expect(visibleTabs(readUnifiedPanelState('ws-1'), 'task-A')).toHaveLength(1);
    });

    it('routes a repo-group member’s canvas at its own clone under the group scope', async () => {
        renderEmbed({
            host: { workspaceId: 'group-acme', chatId: 'task-A' },
            workspaceId: 'ws-member',
        });
        await screen.findByTestId('canvas-embed-document');

        await act(async () => {
            screen.getByTestId('canvas-embed-open-in-panel').click();
        });

        // Stored under the panel's scope, but read from the member clone.
        expect(visibleTabs(readUnifiedPanelState('group-acme'), 'task-A')).toHaveLength(1);
        expect(visibleTabs(readUnifiedPanelState('group-acme'), 'task-A')[0])
            .toMatchObject({ ownerWorkspaceId: 'ws-member', resourceId: 'canvas-9' });
        expect(visibleTabs(readUnifiedPanelState('ws-member'), 'task-A')).toHaveLength(0);
    });

    it('shows no open action when no unified panel hosts the embed', async () => {
        renderEmbed({ host: null });
        await screen.findByTestId('canvas-embed-document');
        expect(screen.queryByTestId('canvas-embed-open-in-panel')).toBeNull();
    });

    it('shows no open action while the panel is showing another chat', async () => {
        // The tab would be filed under this chat's scope, invisible in the
        // strip, and the reveal would pop an unrelated panel open.
        renderEmbed({ host: { workspaceId: 'ws-1', chatId: 'task-B' } });
        await screen.findByTestId('canvas-embed-document');
        expect(screen.queryByTestId('canvas-embed-open-in-panel')).toBeNull();
    });

    it('shows no open action for markdown rendered outside a chat', async () => {
        // A note or wiki body has a workspace but no conversation to own a tab.
        render(
            <UnifiedPanelHostProvider host={{ workspaceId: 'ws-1', chatId: 'task-A' }}>
                <ChatRenderContextProvider value={{ wsId: 'ws-1' }}>
                    <CanvasEmbed workspaceId="ws-1" canvasId="canvas-9" />
                </ChatRenderContextProvider>
            </UnifiedPanelHostProvider>,
        );
        await screen.findByTestId('canvas-embed-document');
        expect(screen.queryByTestId('canvas-embed-open-in-panel')).toBeNull();
    });

    it('keeps the inline preview while the canvas is still loading or failed', async () => {
        mockCanvasesGet.mockRejectedValueOnce(new Error('gone'));
        renderEmbed({ host: { workspaceId: 'ws-1', chatId: 'task-A' } });

        await waitFor(() => expect(screen.getByTestId('canvas-embed-error')).toBeTruthy());
        expect(screen.queryByTestId('canvas-embed-open-in-panel')).toBeNull();
    });
});
