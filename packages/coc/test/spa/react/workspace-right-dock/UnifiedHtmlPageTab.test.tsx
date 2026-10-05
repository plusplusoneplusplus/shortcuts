// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedHtmlPageTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedHtmlPageTab';
import type { DesktopHtmlPageBridge, HtmlPageLoadState } from '../../../../src/server/spa/client/react/shared/file-path/html-page-bridge';

const mocks = vi.hoisted(() => ({ bridge: undefined as DesktopHtmlPageBridge | undefined }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/html-page-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/html-page-bridge')>(),
    desktopHtmlPageBridge: () => mocks.bridge,
}));

let emit: (state: HtmlPageLoadState) => void = () => {};
function makeBridge(withNav: boolean) {
    const bridge = {
        open: vi.fn(async () => ({ ok: true as const })),
        setBounds: vi.fn(), hide: vi.fn(), close: vi.fn(), reload: vi.fn(), openExternal: vi.fn(),
        onState: vi.fn((callback: (state: HtmlPageLoadState) => void) => {
            emit = callback;
            return () => { emit = () => {}; };
        }),
        ...(withNav ? { nav: vi.fn() } : {}),
    };
    mocks.bridge = bridge;
    return bridge;
}

function tab() {
    return render(<UnifiedHtmlPageTab tabId="t" pageId="p1" filePath="/w/pages/index.html" wsId="ws" active visible onErrorChange={vi.fn()} />);
}

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, width: 300, height: 200 } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.bridge = undefined; });

describe('UnifiedHtmlPageTab on the shared native view', () => {
    it('shows the file path read-only and places the view over the shared placeholder', async () => {
        const bridge = makeBridge(true);
        tab();
        await act(async () => {});
        expect(screen.getByTestId('html-page-path').textContent).toBe('/w/pages/index.html');
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.getByTestId('html-page-placeholder')).toBeTruthy();
        expect(bridge.setBounds).toHaveBeenCalledWith('p1', { x: 10, y: 20, width: 300, height: 200 });
    });

    it('drives back/forward/reload/open-externally through the merged bridge', async () => {
        const bridge = makeBridge(true);
        tab();
        await act(async () => {});
        expect((screen.getByTestId('html-page-back') as HTMLButtonElement).disabled).toBe(true);
        act(() => emit({ pageId: 'p1', status: 'loaded', canGoBack: true, canGoForward: true }));
        fireEvent.click(screen.getByTestId('html-page-back'));
        fireEvent.click(screen.getByTestId('html-page-forward'));
        fireEvent.click(screen.getByTestId('html-page-reload'));
        fireEvent.click(screen.getByRole('button', { name: 'Open in system browser' }));
        expect(bridge.nav).toHaveBeenCalledWith('p1', 'back');
        expect(bridge.nav).toHaveBeenCalledWith('p1', 'forward');
        expect(bridge.reload).toHaveBeenCalledWith('p1');
        expect(bridge.openExternal).toHaveBeenCalledWith('p1');
    });

    it('keeps history disabled on the htmlPage fallback bridge', async () => {
        makeBridge(false);
        tab();
        await act(async () => {});
        act(() => emit({ pageId: 'p1', status: 'loaded', canGoBack: true, canGoForward: true }));
        expect((screen.getByTestId('html-page-back') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('html-page-forward') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('html-page-reload') as HTMLButtonElement).disabled).toBe(false);
    });

    it('hides the view and offers the source viewer when the page fails', async () => {
        const bridge = makeBridge(true);
        tab();
        await act(async () => {});
        act(() => emit({ pageId: 'p1', status: 'failed', error: 'File not found' }));
        expect(screen.getByRole('alert').textContent).toContain('File not found');
        expect(bridge.hide).toHaveBeenCalledWith('p1');
        expect(screen.getByTestId('html-page-placeholder').style.display).toBe('none');
    });

    it('renders no native placeholder without a desktop bridge', () => {
        tab();
        expect(screen.queryByTestId('html-page-placeholder')).toBeNull();
    });
});
