/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CopilotExtensionCanvasView, parseExtensionRuntimeReload, type ExtensionCanvasBridge,
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

type ViewProps = Parameters<typeof CopilotExtensionCanvasView>[0];

/** Stands in for the canvas header, which owns the Reload button. */
function WithHeaderReload(props: ViewProps) {
    const [reload, setReload] = useState<{ run: () => void; disabled: boolean } | null>(null);
    const register = useCallback((run: (() => void) | null, options?: { disabled?: boolean }) => {
        setReload(run ? { run, disabled: !!options?.disabled } : null);
    }, []);
    return <>
        {reload && <button type="button" disabled={reload.disabled} onClick={reload.run}>Reload</button>}
        <CopilotExtensionCanvasView {...props} onRegisterReload={register} />
    </>;
}

function mount(props: Partial<ViewProps> = {}) {
    const view = render(<WithHeaderReload workspaceId="ws-local" canvasId="saved-canvas" allowDesktopGuest {...props} />);
    return {
        ...view,
        rerender: (ui: React.ReactElement<ViewProps>) => view.rerender(<WithHeaderReload {...ui.props} />),
    };
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
    vi.restoreAllMocks();
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

    it('confirms reload, replaces the visible guest and keeps the saved identity', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const view = mount();
        expect(screen.getByRole('button', { name: 'Reload' }).hasAttribute('disabled')).toBe(true);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const firstGuest = view.container.querySelector('webview')!;
        const firstId = bridge.open.mock.calls[0][0];
        act(() => stateListener({ viewId: firstId, status: 'loaded' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('shared runtime in this conversation'));
        expect(bridge.open).toHaveBeenCalledTimes(1);
        expect(firstGuest.isConnected).toBe(true);
        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        await waitFor(() => expect(bridge.open).toHaveBeenCalledTimes(2));
        const secondId = bridge.open.mock.calls[1][0];
        expect(secondId).not.toBe(firstId);
        expect(bridge.open).toHaveBeenLastCalledWith(secondId, 'ws-local', 'saved-canvas', true);
        expect(bridge.close).toHaveBeenCalledWith(firstId);
        expect(firstGuest.isConnected).toBe(false);
        await waitFor(() => expect(view.container.querySelectorAll('webview')).toHaveLength(1));
        expect(view.container.querySelector('webview')).not.toBe(firstGuest);
        expect(screen.getByRole('button', { name: 'Reload' }).hasAttribute('disabled')).toBe(true);
        act(() => stateListener({ viewId: secondId, status: 'loaded' }));
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('draws no Reload row of its own and registers reload with the header only for a desktop guest', async () => {
        const register = vi.fn();
        const view = render(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            allowDesktopGuest onRegisterReload={register} />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(register).toHaveBeenLastCalledWith(expect.any(Function), { disabled: true });
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        act(() => stateListener({ viewId: bridge.open.mock.calls[0][0], status: 'loaded' }));
        expect(register).toHaveBeenLastCalledWith(expect.any(Function), { disabled: false });
        view.unmount();
        expect(register).toHaveBeenLastCalledWith(null);

        const fallback = vi.fn();
        render(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            onRegisterReload={fallback} />);
        expect(fallback).not.toHaveBeenCalled();
    });

    it('reports invalid-code reload failure and permits explicit recovery without stale guest replies', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const view = mount();
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const firstId = bridge.open.mock.calls[0][0];
        act(() => stateListener({ viewId: firstId, status: 'loaded' }));
        const oldListener = stateListener;
        bridge.open.mockResolvedValueOnce({ ok: false, message: 'Unexpected token in extension.mjs' });
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unexpected token'));
        expect(view.container.querySelector('webview')).toBeNull();
        act(() => oldListener({ viewId: firstId, status: 'loaded' }));
        expect(screen.getByRole('alert').textContent).toContain('Unexpected token');
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        expect(bridge.open).toHaveBeenLastCalledWith(expect.any(String), 'ws-local', 'saved-canvas', true);
    });

    it('discards an ignored reload reply when the canvas owner changes', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const view = mount();
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        act(() => stateListener({ viewId: bridge.open.mock.calls[0][0], status: 'loaded' }));
        let finish!: (result: typeof ready) => void;
        bridge.open.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        const reloadId = bridge.open.mock.calls[1][0];
        view.rerender(<CopilotExtensionCanvasView workspaceId="other-workspace" canvasId="other-canvas" allowDesktopGuest />);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const guest = view.container.querySelector('webview');
        await act(async () => finish({ ...ready, src: 'http://127.0.0.1:3211/' }));
        expect(bridge.close).toHaveBeenCalledWith(reloadId);
        expect(view.container.querySelector('webview')).toBe(guest);
        expect(bridge.open).toHaveBeenLastCalledWith(expect.any(String), 'other-workspace', 'other-canvas');
    });

    it('opens once for an initial marker and replaces the guest only when its reload token changes', async () => {
        const view = mount({ runtimeReload: { id: 'first' } });
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const first = view.container.querySelector('webview');
        const firstId = bridge.open.mock.calls[0][0];
        view.rerender(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            allowDesktopGuest runtimeReload={{ id: 'first' }} />);
        expect(bridge.open).toHaveBeenCalledOnce();
        view.rerender(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            allowDesktopGuest runtimeReload={{ id: 'second' }} />);
        await waitFor(() => expect(bridge.open).toHaveBeenCalledTimes(2));
        expect(bridge.close).toHaveBeenCalledWith(firstId);
        expect(first?.isConnected).toBe(false);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        expect(view.container.querySelector('webview')).not.toBe(first);
        expect(bridge.open.mock.calls.every(call => call.length === 3)).toBe(true);
    });

    it('shows a runtime reload failure without opening and recovers from a newer success marker', async () => {
        const view = mount({ runtimeReload: { id: 'initial' } });
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const oldId = bridge.open.mock.calls[0][0];
        const oldListener = stateListener;
        view.rerender(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            allowDesktopGuest runtimeReload={{ id: 'failed', error: 'Invalid imported code' }} />);
        expect(screen.getByRole('alert').textContent).toBe('Invalid imported code');
        expect(view.container.querySelector('webview')).toBeNull();
        expect(bridge.close).toHaveBeenCalledWith(oldId);
        expect(bridge.open).toHaveBeenCalledOnce();
        act(() => oldListener({ viewId: oldId, status: 'loaded' }));
        expect(screen.getByRole('alert').textContent).toBe('Invalid imported code');
        view.rerender(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            allowDesktopGuest runtimeReload={{ id: 'repaired' }} />);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        expect(bridge.open).toHaveBeenCalledTimes(2);
        expect(bridge.open.mock.calls[1]).toHaveLength(3);
    });

    it('allows explicit manual retry from a persisted failure marker', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const view = mount({ runtimeReload: { id: 'failed', error: 'Invalid code' } });
        expect(screen.getByRole('alert').textContent).toBe('Invalid code');
        expect(bridge.open).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        expect(bridge.open).toHaveBeenCalledWith(expect.any(String), 'ws-local', 'saved-canvas', true);
        view.rerender(<CopilotExtensionCanvasView workspaceId="ws-local" canvasId="saved-canvas"
            allowDesktopGuest runtimeReload={{ id: 'repaired' }} />);
        await waitFor(() => expect(bridge.open).toHaveBeenCalledTimes(2));
        expect(bridge.open.mock.calls[1]).toHaveLength(3);
    });

    it('ignores a pending old reload marker open after the owner changes', async () => {
        let finish!: (result: typeof ready) => void;
        bridge.open.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = mount({ runtimeReload: { id: 'old-owner-reload' } });
        const oldId = bridge.open.mock.calls[0][0];
        view.rerender(<CopilotExtensionCanvasView workspaceId="other-workspace" canvasId="other-canvas"
            allowDesktopGuest runtimeReload={{ id: 'new-owner-reload' }} />);
        await waitFor(() => expect(view.container.querySelector('webview')).not.toBeNull());
        const current = view.container.querySelector('webview');
        await act(async () => finish(ready));
        expect(bridge.close).toHaveBeenCalledWith(oldId);
        expect(view.container.querySelector('webview')).toBe(current);
        expect(bridge.open).toHaveBeenLastCalledWith(expect.any(String), 'other-workspace', 'other-canvas');
    });

    it.each(['not json', 'null', '{}', '{"runtimeReload":null}', '{"runtimeReload":{"id":7}}',
        '{"runtimeReload":{"id":""}}', '{"runtimeReload":{"id":"x","error":3}}'])
    ('ignores invalid saved runtime markers: %s', content => {
        expect(parseExtensionRuntimeReload(content)).toBeUndefined();
    });

    it('reads only the saved runtime marker identity and error', () => {
        expect(parseExtensionRuntimeReload('{"runtimeReload":{"id":"reload-1","error":"Broken code","url":"http://untrusted"}}'))
            .toEqual({ id: 'reload-1', error: 'Broken code' });
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
