// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import { UnifiedPanelTabStrip } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
import { setBrowserTabFavicon } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/browserTabFavicons';
import { EMPTY_UNIFIED_PANEL, openTab, visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { BrowserViewState, DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const mocks = vi.hoisted(() => ({ bridge: undefined as DesktopBrowserBridge | undefined }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => mocks.bridge,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useNativeViewPlacement', () => ({ useNativeViewPlacement: vi.fn() }));

const ICON = 'data:image/png;base64,iVBORw0KGgo=';
const OTHER_ICON = 'data:image/x-icon;base64,AAABAAEA';

function browserTab() {
    const state = openTab(EMPTY_UNIFIED_PANEL, { kind: 'browser', ownerWorkspaceId: 'ws', chatId: null, resourceId: 'view', label: 'Google', browserUrl: 'https://www.google.com/' });
    return visibleTabs(state, null)[0];
}

function renderStrip() {
    const tab = browserTab();
    render(<UnifiedPanelTabStrip tabs={[tab]} activeId={tab.id} onActivate={vi.fn()} onClose={vi.fn()} onCloseMany={vi.fn()} onMove={vi.fn()} />);
    return tab;
}

beforeEach(() => {
    mocks.bridge = {
        open: vi.fn(async () => ({ ok: true, engine: 'electron' })), hide: vi.fn(), close: vi.fn(), navigate: vi.fn(),
        nav: vi.fn(), focus: vi.fn(), setBounds: vi.fn(), openExternal: vi.fn(),
        onState: vi.fn(() => vi.fn()), onDownload: vi.fn(() => vi.fn()), onNewTab: vi.fn(), onClosed: vi.fn(),
        getPreferences: vi.fn(), setDefaultEngine: vi.fn(), clearData: vi.fn(), onPreferencesChanged: vi.fn(),
    } as unknown as DesktopBrowserBridge;
});
afterEach(() => {
    cleanup();
    setBrowserTabFavicon(browserTab().id, undefined);
    setBrowserTabFavicon('tab', undefined);
    mocks.bridge = undefined;
});

describe('browser tab header site icon', () => {
    it('replaces the globe with the site icon in the same slot, keeping title, close control and active surface', () => {
        const tab = renderStrip();
        const label = screen.getByTestId(`unified-panel-tab-label-${tab.id}`);
        const slot = label.parentElement!.querySelector('[aria-hidden="true"]')!;
        expect(slot.querySelector('[data-icon="browser-globe"]')).not.toBeNull();
        act(() => setBrowserTabFavicon(tab.id, ICON));
        const icon = screen.getByTestId(`unified-panel-tab-favicon-${tab.id}`) as HTMLImageElement;
        expect(icon.parentElement).toBe(slot);
        expect(icon.getAttribute('src')).toBe(ICON);
        expect(icon).toHaveAttribute('alt', '');
        expect(icon).toHaveAttribute('width', '12');
        expect(icon).toHaveAttribute('height', '12');
        expect(slot.querySelector('[data-icon="browser-globe"]')).toBeNull();
        expect(label).toHaveTextContent('Google');
        expect(label.parentElement!.className).toContain('h-[35px]');
        // The Chrome-style raised surface is drawn by unifiedPanelTabs.css from these markers.
        expect(label.parentElement!.className).toContain('unified-panel-tab');
        expect(label.parentElement).toHaveAttribute('data-active', 'true');
        expect(label.parentElement).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('keeps the globe when the icon fails to decode, and retries a different icon', () => {
        const tab = renderStrip();
        act(() => setBrowserTabFavicon(tab.id, ICON));
        fireEvent.error(screen.getByTestId(`unified-panel-tab-favicon-${tab.id}`));
        expect(screen.queryByTestId(`unified-panel-tab-favicon-${tab.id}`)).toBeNull();
        expect(document.querySelector('[data-icon="browser-globe"]')).not.toBeNull();
        act(() => setBrowserTabFavicon(tab.id, OTHER_ICON));
        expect(screen.getByTestId(`unified-panel-tab-favicon-${tab.id}`).getAttribute('src')).toBe(OTHER_ICON);
    });

    it('never renders a page-chosen remote URL', () => {
        const tab = renderStrip();
        act(() => setBrowserTabFavicon(tab.id, 'https://tracker.test/favicon.ico'));
        expect(screen.queryByTestId(`unified-panel-tab-favicon-${tab.id}`)).toBeNull();
        expect(document.querySelector('[data-icon="browser-globe"]')).not.toBeNull();
    });

    it('follows its own view state, clears on a new document and on unmount', async () => {
        const strip = render(<UnifiedPanelTabStrip tabs={[{ ...browserTab(), id: 'tab' }]} activeId="tab" onActivate={vi.fn()} onClose={vi.fn()} onCloseMany={vi.fn()} onMove={vi.fn()} />);
        const page = render(<UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="ws" url="https://www.google.com/" active visible onNavigate={vi.fn()} onPageState={vi.fn()} />);
        await waitFor(() => expect(mocks.bridge!.onState).toHaveBeenCalled());
        const emit = vi.mocked(mocks.bridge!.onState).mock.calls[0][0];
        const state: BrowserViewState = { viewId: 'view', engine: 'electron', sourceKind: 'url', url: 'https://www.google.com/', title: 'Google', loading: false, canGoBack: false, canGoForward: false };
        act(() => emit({ ...state, viewId: 'foreign', favicon: ICON }));
        expect(screen.queryByTestId('unified-panel-tab-favicon-tab')).toBeNull();
        act(() => emit({ ...state, favicon: ICON }));
        expect(screen.getByTestId('unified-panel-tab-favicon-tab').getAttribute('src')).toBe(ICON);
        act(() => emit({ ...state, url: 'https://other.test/', loading: true }));
        expect(screen.queryByTestId('unified-panel-tab-favicon-tab')).toBeNull();
        act(() => emit({ ...state, favicon: ICON }));
        page.unmount();
        expect(screen.queryByTestId('unified-panel-tab-favicon-tab')).toBeNull();
        strip.unmount();
    });
});
