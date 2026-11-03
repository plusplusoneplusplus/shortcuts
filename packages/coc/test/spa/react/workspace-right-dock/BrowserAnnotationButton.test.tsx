// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAnnotationButton, type BrowserAnnotationButtonProps } from '../../../../src/server/spa/client/react/shared/file-path/BrowserAnnotationButton';
import type { BrowserAnnotationNotification, DesktopBrowserAnnotation } from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation';
import { startBrowserControlActivity, finishBrowserControlActivity } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-activity';
import { clearBrowserTakeover, setBrowserTakeover } from '../../../../src/server/spa/client/react/shared/file-path/browser-takeover';
const mock = vi.hoisted(() => ({ enabled: true, takeover: false, route: 'local', request: vi.fn(), baseUrl: undefined as string | undefined }));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'config',
    getFeatureValue: (key: string) => key === 'browserAnnotationEnabled' ? mock.enabled : mock.takeover,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => client, useCloneBaseUrl: () => mock.baseUrl,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    resolveCloneRoute: () => ({ kind: mock.route, baseUrl: mock.baseUrl }),
}));
const client = { request: mock.request };
let listeners: Set<(event: BrowserAnnotationNotification) => void>;
let bridge: DesktopBrowserAnnotation;
const props = (): BrowserAnnotationButtonProps => ({ bridge, sessionKey: 'clone:w', viewId: 'view', tabId: 'tab', workspaceId: 'w',
    active: true, ready: true, excluded: false, documentKey: 'doc1' });
const button = () => screen.getByRole('button', { name: 'Annotate' });
const owner = { workspaceId: 'w', processId: 'p', turnId: 'turn', routingRef: 'clone:w', viewIds: ['view'] };
beforeEach(() => {
    mock.enabled = true; mock.takeover = false; mock.route = 'local'; mock.baseUrl = undefined;
    mock.request.mockReset(); listeners = new Set();
    bridge = { supported: true, start: vi.fn(async () => true), stop: vi.fn(async () => {}), setEnabled: vi.fn(async () => {}),
        onEvent: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; } };
});
afterEach(() => { cleanup(); clearBrowserTakeover('clone:w', 'p'); });
async function start() { fireEvent.click(button()); await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true')); }
function emit(event: Partial<BrowserAnnotationNotification>) {
    const identity = vi.mocked(bridge.start).mock.calls.at(-1)![0];
    act(() => { for (const listener of listeners) listener({ ...identity, ...event } as BrowserAnnotationNotification); });
}

describe('annotation toolbar mode', () => {
    it('publishes policy independently, toggles only after native acknowledgement and stops on Escape', async () => {
        render(<BrowserAnnotationButton {...props()} />);
        expect(bridge.setEnabled).toHaveBeenCalledWith('clone:w', true);
        expect(button()).toHaveAttribute('aria-pressed', 'false');
        expect(button().title).toBe('Annotate this page');
        await start();
        expect(listeners.size).toBe(1);
        expect(button().title).toContain('Esc');
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'false'));
        expect(bridge.stop).toHaveBeenCalledWith(vi.mocked(bridge.start).mock.calls[0][0]);
        expect(listeners.size).toBe(0);
    });
    it('toggles off using the same button and reports native teardown errors', async () => {
        render(<BrowserAnnotationButton {...props()} />); await start();
        vi.mocked(bridge.stop).mockRejectedValueOnce(new Error('cleanup'));
        fireEvent.click(button());
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not exit'));
        expect(button()).toHaveAttribute('aria-pressed', 'false');
        await start();
        expect(bridge.start).toHaveBeenCalledTimes(2);
    });
    it.each([{ active: false }, { ready: false }])('disables unavailable tabs: %j', patch => {
        render(<BrowserAnnotationButton {...props()} {...patch} />);
        expect(button()).toBeDisabled(); fireEvent.click(button()); expect(bridge.start).not.toHaveBeenCalled();
    });
    it('hides excluded previews and live-disabled policy, removing the overlay', async () => {
        const view = render(<BrowserAnnotationButton {...props()} />); await start();
        act(() => { mock.enabled = false; window.dispatchEvent(new Event('config')); });
        expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull();
        await waitFor(() => expect(bridge.stop).toHaveBeenCalledTimes(1));
        expect(bridge.setEnabled).toHaveBeenCalledWith('clone:w', false);
        act(() => { mock.enabled = true; window.dispatchEvent(new Event('config')); });
        await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'false'));
        view.rerender(<BrowserAnnotationButton {...props()} excluded />);
        expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull();
    });
    it.each([{ active: false }, { documentKey: 'doc2' }, { ready: false }])('tears down on scope/document departure: %j', async patch => {
        const view = render(<BrowserAnnotationButton {...props()} />); await start();
        view.rerender(<BrowserAnnotationButton {...props()} {...patch} />);
        await waitFor(() => expect(bridge.stop).toHaveBeenCalledTimes(1));
        expect(listeners.size).toBe(0);
    });
    it('revokes pending startup on unmount and drops late success', async () => {
        let resolve!: (value: boolean) => void;
        vi.mocked(bridge.start).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const view = render(<BrowserAnnotationButton {...props()} />); fireEvent.click(button());
        await waitFor(() => expect(bridge.start).toHaveBeenCalledTimes(1));
        expect(button()).toBeDisabled(); view.unmount();
        await waitFor(() => expect(bridge.stop).toHaveBeenCalledTimes(1));
        await act(async () => { resolve(true); });
        expect(listeners.size).toBe(0);
    });
    it('cancels pending startup with Escape and ignores old replies during a new startup', async () => {
        let first!: (value: boolean) => void;
        let second!: (value: boolean) => void;
        vi.mocked(bridge.start).mockReturnValueOnce(new Promise(done => { first = done; }))
            .mockReturnValueOnce(new Promise(done => { second = done; }));
        render(<BrowserAnnotationButton {...props()} />); fireEvent.click(button());
        await waitFor(() => expect(bridge.start).toHaveBeenCalledTimes(1));
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(button()).not.toBeDisabled());
        fireEvent.click(button());
        await waitFor(() => expect(bridge.start).toHaveBeenCalledTimes(2));
        await act(async () => { first(true); });
        expect(button()).toBeDisabled();
        await act(async () => { second(true); });
        expect(button()).toHaveAttribute('aria-pressed', 'true');
    });
    it('handles early native termination without resurrecting mode', async () => {
        vi.mocked(bridge.start).mockImplementationOnce(async identity => {
            for (const listener of listeners) listener({ ...identity, type: 'ended', reason: 'unavailable' });
            return true;
        });
        render(<BrowserAnnotationButton {...props()} />); fireEvent.click(button());
        await waitFor(() => expect(bridge.start).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(button()).not.toBeDisabled());
        expect(button()).toHaveAttribute('aria-pressed', 'false');
    });
    it('shows refusal/errors and permits explicit retries with fresh identities', async () => {
        vi.mocked(bridge.start).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('failed'));
        render(<BrowserAnnotationButton {...props()} />); fireEvent.click(button());
        await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
        fireEvent.click(button()); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not start'));
        await start();
        expect(new Set(vi.mocked(bridge.start).mock.calls.map(([identity]) => identity.requestId)).size).toBe(3);
        emit({ type: 'ended', reason: 'failed', error: 'native failure' });
        expect(screen.getByRole('alert')).toHaveTextContent('native failure');
    });
    it('disables during agent control without takeover, delegates enabled takeover to main', async () => {
        setBrowserTakeover({ ...owner, status: 'agent' });
        render(<BrowserAnnotationButton {...props()} />);
        expect(button()).toBeDisabled(); expect(button().title).toContain('Enable human takeover');
        act(() => { mock.takeover = true; window.dispatchEvent(new Event('config')); });
        expect(button()).not.toBeDisabled(); expect(button().title).toContain('Take over');
        await start(); // Main's start method owns the atomic takeover/injection sequence.
        act(() => setBrowserTakeover({ ...owner, status: 'human' }));
        expect(button()).not.toBeDisabled();
    });
    it('disables a running agent turn even when the takeover feature publishes no state', () => {
        startBrowserControlActivity({ workspaceId: 'w', processId: 'activity-only', tabId: 'tab' });
        try {
            render(<BrowserAnnotationButton {...props()} />);
            expect(button()).toBeDisabled(); expect(button().title).toContain('Enable human takeover');
            fireEvent.click(button()); expect(bridge.start).not.toHaveBeenCalled();
        } finally { act(() => finishBrowserControlActivity('w', 'activity-only')); }
    });
    it('reports unsupported hosts without attempting startup', () => {
        bridge.supported = false; render(<BrowserAnnotationButton {...props()} />);
        expect(button()).toBeDisabled(); expect(button().title).toContain('unavailable');
        fireEvent.click(button()); expect(bridge.start).not.toHaveBeenCalled();
    });
    it('drops stale remote policy reads after a server change and fails closed on read failure', async () => {
        mock.route = 'remote'; mock.baseUrl = 'https://one.test';
        let old!: (value: unknown) => void;
        mock.request.mockReturnValueOnce(new Promise(done => { old = done; })).mockRejectedValueOnce(new Error('offline'));
        const view = render(<BrowserAnnotationButton {...props()} />);
        expect(screen.queryByRole('button')).toBeNull();
        mock.baseUrl = 'https://two.test'; view.rerender(<BrowserAnnotationButton {...props()} />);
        await act(async () => { old({ features: { browserAnnotationEnabled: true } }); });
        expect(screen.queryByRole('button')).toBeNull();
        mock.request.mockResolvedValue({ features: { browserAnnotationEnabled: true, browserHumanTakeoverEnabled: true } });
        act(() => window.dispatchEvent(new CustomEvent('coc-remote-ws-connect', { detail: { baseUrl: mock.baseUrl } })));
        await waitFor(() => expect(button()).not.toBeDisabled());
        act(() => setBrowserTakeover({ ...owner, status: 'agent' }));
        await waitFor(() => expect(button().title).toContain('Take over'));
    });
    it('keeps exact remote policy isolated and refreshes only matching server config events', async () => {
        mock.route = 'remote'; mock.baseUrl = 'https://remote.test';
        mock.request.mockResolvedValue({ features: { browserAnnotationEnabled: true } });
        render(<BrowserAnnotationButton {...props()} />);
        await waitFor(() => expect(button()).not.toBeDisabled()); await start();
        mock.request.mockResolvedValue({ features: { browserAnnotationEnabled: false } });
        act(() => window.dispatchEvent(new CustomEvent('coc-remote-ws-message', { detail: { baseUrl: 'https://other.test', message: { type: 'config-changed' } } })));
        expect(mock.request).toHaveBeenCalledTimes(1);
        act(() => window.dispatchEvent(new CustomEvent('coc-remote-ws-message', { detail: { baseUrl: mock.baseUrl, message: { type: 'config-changed' } } })));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull());
        await waitFor(() => expect(bridge.stop).toHaveBeenCalledTimes(1));
        expect(bridge.setEnabled).toHaveBeenCalledWith('clone:w', false);
    });
    it('fails closed for unresolved owners without reading the local server', () => {
        mock.route = 'unresolved-remote'; render(<BrowserAnnotationButton {...props()} />);
        expect(screen.queryByRole('button')).toBeNull(); expect(mock.request).not.toHaveBeenCalled();
        expect(bridge.setEnabled).toHaveBeenCalledWith('clone:w', false);
    });
});
