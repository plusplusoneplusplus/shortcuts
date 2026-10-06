// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import type { DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const mocks = vi.hoisted(() => ({ bridge: undefined as DesktopBrowserBridge | undefined }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => mocks.bridge,
}));

beforeEach(() => {
    mocks.bridge = {
        open: vi.fn(async () => ({ ok: true, engine: 'electron' })),
        setBounds: vi.fn(), hide: vi.fn(), close: vi.fn(), navigate: vi.fn(), nav: vi.fn(),
        onState: vi.fn(() => vi.fn()), onDownload: vi.fn(() => vi.fn()),
    } as unknown as DesktopBrowserBridge;
    // Model the toolbar's in-flow menu taking 70px from the native placeholder.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const top = this.parentElement?.querySelector('[role="menu"]') ? 170 : 100;
        return { x: 500, y: top, left: 500, top, right: 900, bottom: 500, width: 400, height: 500 - top, toJSON: () => ({}) };
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    // Real placement hook and MutationObserver; no DOM content covers the placeholder.
    document.elementFromPoint = () => screen.getByTestId('browser-placeholder');
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as Partial<Document>).elementFromPoint;
});

const props = { tabId: 'tab', viewId: 'view', sessionKey: 'workspace-a', url: 'https://example.test/', active: true, visible: true, onNavigate: vi.fn(), onPageState: vi.fn() };
const normal = { x: 500, y: 100, width: 400, height: 400 };
const expanded = { x: 500, y: 170, width: 400, height: 330 };

describe('browser toolbar native placement regression', () => {
    it.each(['electron', 'webview2'] as const)('keeps the %s page placed during repeated toggles, Escape and outside dismissal without reopening or navigating', async engine => {
        vi.mocked(mocks.bridge!.open).mockResolvedValue({ ok: true, engine });
        render(<UnifiedBrowserTab {...props} />);
        const bridge = mocks.bridge!;
        await waitFor(() => expect(bridge.setBounds).toHaveBeenLastCalledWith('view', normal));
        vi.mocked(bridge.hide).mockClear();
        const trigger = screen.getByRole('button', { name: 'Browser options' });
        for (const dismiss of ['trigger', 'Escape', 'outside', 'trigger']) {
            await userEvent.click(trigger);
            expect(screen.getByRole('menu')).toBeInTheDocument();
            await waitFor(() => expect(bridge.setBounds).toHaveBeenLastCalledWith('view', expanded));
            if (dismiss === 'Escape') await userEvent.keyboard('{Escape}');
            else await userEvent.click(dismiss === 'outside' ? document.body : trigger);
            expect(screen.queryByRole('menu')).toBeNull();
            await waitFor(() => expect(bridge.setBounds).toHaveBeenLastCalledWith('view', normal));
        }
        expect(bridge.hide).not.toHaveBeenCalled();
        expect(bridge.open).toHaveBeenCalledTimes(1);
        expect(bridge.close).not.toHaveBeenCalled();
        expect(bridge.navigate).not.toHaveBeenCalled();
        expect(bridge.nav).not.toHaveBeenCalled();
    });

    it('dismisses on tab/panel switches and cancels pending placement on disposal without destroying the retained view', async () => {
        const view = render(<UnifiedBrowserTab {...props} />);
        const bridge = mocks.bridge!;
        await waitFor(() => expect(bridge.setBounds).toHaveBeenLastCalledWith('view', normal));
        for (const hidden of [{ active: false }, { visible: false }]) {
            await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
            view.rerender(<UnifiedBrowserTab {...props} {...hidden} />);
            expect(screen.queryByRole('menu')).toBeNull();
            expect(bridge.hide).toHaveBeenCalledWith('view');
            vi.mocked(bridge.setBounds).mockClear();
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(bridge.setBounds).not.toHaveBeenCalled();
            view.rerender(<UnifiedBrowserTab {...props} />);
            await waitFor(() => expect(bridge.setBounds).toHaveBeenLastCalledWith('view', normal));
        }
        await userEvent.click(screen.getByRole('button', { name: 'Browser options' }));
        view.unmount();
        vi.mocked(bridge.setBounds).mockClear();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bridge.setBounds).not.toHaveBeenCalled();
        expect(bridge.open).toHaveBeenCalledTimes(1);
        expect(bridge.close).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
