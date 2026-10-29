/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CopilotExtensionCanvasView, type ExtensionCanvasBridge,
} from '../../../../../src/server/spa/client/react/features/canvas/CopilotExtensionCanvasView';
import {
    registerCloneBaseUrls, resetCloneRegistryForTests,
} from '../../../../../src/server/spa/client/react/repos/cloneRegistry';
import { WorkspaceOwnerContext } from '../../../../../src/server/spa/client/react/repos/workspaceOwnerContext';

const ready = {
    ok: true as const, embed: 'webview' as const,
    src: 'http://127.0.0.1:3210/?attachment=single-use',
    partition: 'extension-memory', title: 'Board',
};
let bridge: {
    open: ReturnType<typeof vi.fn>;
    adopt: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onState: ReturnType<typeof vi.fn>;
};
let stateListener: Parameters<ExtensionCanvasBridge['onState']>[0];
let unsubscribe: ReturnType<typeof vi.fn>;

function mount(props: Partial<Parameters<typeof CopilotExtensionCanvasView>[0]> = {}) {
    return render(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas" allowDesktopGuest {...props} />);
}

beforeEach(() => {
    unsubscribe = vi.fn();
    bridge = {
        open: vi.fn().mockResolvedValue(ready),
        adopt: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        onState: vi.fn(listener => { stateListener = listener; return unsubscribe; }),
    };
    Object.assign(window, { cocDesktop: { extensionCanvas: bridge } });
});

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    delete (window as { cocDesktop?: unknown }).cocDesktop;
});

describe('Copilot extension guest', () => {
    it('opens the saved canvas, mounts the authorized guest and adopts its webContents', async () => {
        const view = mount();
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const guest = view.container.querySelector('webview')!;
        expect(bridge.open).toHaveBeenCalledWith(expect.any(String), 'ws-local', 'saved-canvas');
        expect(guest.getAttribute('src')).toBe(ready.src);
        expect(guest.getAttribute('partition')).toBe(ready.partition);
        expect(guest.hasAttribute('allowpopups')).toBe(false);
        Object.assign(guest, { getWebContentsId: () => 42 });
        act(() => guest.dispatchEvent(new Event('dom-ready')));
        expect(bridge.adopt).toHaveBeenCalledWith(bridge.open.mock.calls[0][0], 42);
        act(() => stateListener({ viewId: 'another-view', status: 'loaded' }));
        expect(screen.getByRole('status').textContent).toContain('Loading');
        act(() => stateListener({ viewId: bridge.open.mock.calls[0][0], status: 'loaded' }));
        expect(screen.queryByRole('status')).toBeNull();
        view.unmount();
        expect(bridge.close).toHaveBeenCalledWith(bridge.open.mock.calls[0][0]);
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(guest.isConnected).toBe(false);
    });

    it('shows the browser fallback without a desktop bridge', () => {
        delete (window as { cocDesktop?: unknown }).cocDesktop;
        const view = mount();
        expect(screen.getByText('Open in the CoC desktop app')).toBeTruthy();
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.open).not.toHaveBeenCalled();
    });

    it('requires an explicit unified-tab opt-in', () => {
        const view = mount({ allowDesktopGuest: false });
        expect(screen.getByText('Open in the CoC desktop app')).toBeTruthy();
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.onState).not.toHaveBeenCalled();
        expect(bridge.open).not.toHaveBeenCalled();
    });

    it('blocks remote owners even with a local-looking raw workspace id', () => {
        registerCloneBaseUrls([{ cloneKey: 'remote:server:ws-local', workspaceId: 'ws-local', baseUrl: 'http://127.0.0.1:4321' }]);
        const view = mount({ routingRef: 'remote:server:ws-local' });
        expect(screen.getByText('Open in the CoC desktop app')).toBeTruthy();
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.open).not.toHaveBeenCalled();
        expect(bridge.onState).not.toHaveBeenCalled();
    });

    it('blocks unresolved remote routing refs without opener side effects', () => {
        mount({ routingRef: 'remote:offline:ws-local' });
        expect(screen.getByText('Open in the CoC desktop app')).toBeTruthy();
        expect(bridge.open).not.toHaveBeenCalled();
    });

    it('honors an explicit local owner despite a colliding remote workspace id', async () => {
        registerCloneBaseUrls([{ cloneKey: 'remote:server:ws-local', workspaceId: 'ws-local', baseUrl: 'http://127.0.0.1:4321' }]);
        const view = mount({ routingRef: null });
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        expect(bridge.open).toHaveBeenCalledWith(expect.any(String), 'ws-local', 'saved-canvas');
    });

    it('honors subtree-local ownership without adopting a colliding registry route', async () => {
        registerCloneBaseUrls([{ cloneKey: 'remote:server:ws-local', workspaceId: 'ws-local', baseUrl: 'http://127.0.0.1:4321' }]);
        const view = render(<WorkspaceOwnerContext.Provider value={{ workspaceId: 'ws-local', selectionId: 'ws-local' }}>
            <CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas" allowDesktopGuest />
        </WorkspaceOwnerContext.Provider>);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
    });

    it('rejects subtree-remote ownership even when the registry has no route', () => {
        const view = render(<WorkspaceOwnerContext.Provider value={{
            workspaceId: 'ws-local', selectionId: 'remote:server:ws-local', baseUrl: 'http://127.0.0.1:4321',
        }}>
            <CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas" allowDesktopGuest />
        </WorkspaceOwnerContext.Provider>);
        expect(screen.getByText('Open in the CoC desktop app')).toBeTruthy();
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.open).not.toHaveBeenCalled();
    });

    it('releases the local guest if its owner route becomes remote', async () => {
        const view = mount();
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const id = bridge.open.mock.calls[0][0];
        act(() => registerCloneBaseUrls([{
            cloneKey: 'remote:server:ws-local', workspaceId: 'ws-local', baseUrl: 'http://127.0.0.1:4321',
        }]));
        expect(screen.getByText('Open in the CoC desktop app')).toBeTruthy();
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.close).toHaveBeenCalledWith(id);
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('closes late opens after unmount without creating a guest', async () => {
        let resolve!: (result: typeof ready) => void;
        bridge.open.mockReturnValue(new Promise(r => { resolve = r; }));
        const view = mount();
        const id = bridge.open.mock.calls[0][0];
        view.unmount();
        expect(bridge.close).toHaveBeenCalledWith(id);
        await act(async () => resolve(ready));
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.close.mock.calls.filter(([viewId]) => viewId === id)).toHaveLength(2);
        expect(bridge.adopt).not.toHaveBeenCalled();
    });

    it('reopens after close with a fresh view identity and the same saved canvas id', async () => {
        const first = mount();
        await waitFor(() => expect(first.container.querySelector('webview')).not.toBeNull());
        first.unmount();
        const second = mount();
        await waitFor(() => expect(second.container.querySelector('webview')).not.toBeNull());
        const [firstId] = bridge.open.mock.calls[0];
        const [secondId, workspaceId, canvasId] = bridge.open.mock.calls[1];
        expect(secondId).not.toBe(firstId);
        expect([workspaceId, canvasId]).toEqual(['ws-local', 'saved-canvas']);
    });

    it('gives StrictMode effect replays distinct view identities and retires the canceled open', async () => {
        const view = render(<StrictMode>
            <CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas" allowDesktopGuest />
        </StrictMode>);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        expect(bridge.open).toHaveBeenCalledTimes(2);
        const firstId = bridge.open.mock.calls[0][0];
        const secondId = bridge.open.mock.calls[1][0];
        expect(secondId).not.toBe(firstId);
        expect(bridge.close).toHaveBeenCalledWith(firstId);
        expect(bridge.close).not.toHaveBeenCalledWith(secondId);
        expect(view.container.querySelectorAll('webview')).toHaveLength(1);
        view.unmount();
        expect(bridge.close).toHaveBeenCalledWith(secondId);
    });

    it('does not let a late old-canvas open replace the current guest', async () => {
        let resolve!: (result: typeof ready) => void;
        bridge.open.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = mount();
        const oldId = bridge.open.mock.calls[0][0];
        view.rerender(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="next-canvas" allowDesktopGuest />);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const guest = view.container.querySelector('webview');
        const currentId = bridge.open.mock.calls[1][0];
        expect(currentId).not.toBe(oldId);
        await act(async () => resolve({ ...ready, src: 'http://127.0.0.1:3211/' }));
        expect(view.container.querySelectorAll('webview')).toHaveLength(1);
        expect(view.container.querySelector('webview')).toBe(guest);
        expect(guest?.getAttribute('src')).toBe(ready.src);
        expect(bridge.close).toHaveBeenCalledWith(oldId);
        expect(bridge.close).not.toHaveBeenCalledWith(currentId);
    });

    it.each(['denied', 'rejected', 'adoption', 'navigation'])('reports %s failures and releases the view', async kind => {
        if (kind === 'denied') bridge.open.mockResolvedValue({ ok: false, message: 'Extension disabled' });
        if (kind === 'rejected') bridge.open.mockRejectedValue(new Error('Server unavailable'));
        const view = mount();
        if (kind === 'adoption' || kind === 'navigation') {
            await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
            if (kind === 'adoption') {
                bridge.adopt.mockRejectedValue(new Error('Guest denied'));
                const guest = view.container.querySelector('webview')!;
                Object.assign(guest, { getWebContentsId: () => 42 });
                act(() => guest.dispatchEvent(new Event('dom-ready')));
            } else {
                act(() => stateListener({ viewId: bridge.open.mock.calls[0][0], status: 'failed', error: 'Navigation failed' }));
            }
        }
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy());
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.close).toHaveBeenCalledWith(bridge.open.mock.calls[0][0]);
    });

    it('does not attach a late result after main reports an early failure', async () => {
        let resolve!: (result: typeof ready) => void;
        bridge.open.mockReturnValue(new Promise(r => { resolve = r; }));
        const view = mount();
        act(() => stateListener({ viewId: bridge.open.mock.calls[0][0], status: 'failed', error: 'Closed' }));
        await act(async () => resolve(ready));
        expect(screen.getByRole('alert').textContent).toBe('Closed');
        expect(view.container.querySelector('webview')).toBeNull();
    });
});
