// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
import type { BrowserFavorite, BrowserMostVisitedSite, DesktopBrowserBridge, DesktopBrowserFavorites, DesktopBrowserHistory } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const mocks = vi.hoisted(() => ({ bridge: undefined as DesktopBrowserBridge | undefined }));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => mocks.bridge,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useNativeViewPlacement', () => ({ useNativeViewPlacement: vi.fn() }));

let saved: BrowserFavorite[];
let sites: BrowserMostVisitedSite[];
let favoritesChanged: (() => void) | undefined;
let historyChanged: (() => void) | undefined;
let favorites: { [K in keyof DesktopBrowserFavorites]: ReturnType<typeof vi.fn> };
let history: DesktopBrowserHistory;
const navigate = vi.fn(async () => ({ ok: true as const, engine: 'electron' as const }));

beforeEach(() => {
    vi.clearAllMocks();
    saved = [{ url: 'https://saved.test/a', title: 'Saved A', added: 2 }];
    sites = [
        { domain: 'docs.test', url: 'https://docs.test/latest', title: 'Latest docs', lastVisited: 5, visitCount: 9 },
        { domain: 'news.test', url: 'https://news.test/', title: 'News', lastVisited: 6, visitCount: 3 },
    ];
    favorites = {
        list: vi.fn(async () => ({ ok: true as const, favorites: saved.map(item => ({ ...item })), storageError: null })),
        add: vi.fn(async (url: string, title: string) => { saved = [{ url, title, added: 3 }, ...saved]; favoritesChanged?.(); return { ok: true as const }; }),
        remove: vi.fn(async (url: string) => { saved = saved.filter(item => item.url !== url); favoritesChanged?.(); return { ok: true as const }; }),
        onChanged: vi.fn((callback: () => void) => { favoritesChanged = callback; return () => { favoritesChanged = undefined; }; }),
    };
    history = {
        query: vi.fn(), suggest: vi.fn(async () => ({ ok: true as const, entries: [], total: 0, recording: true, storageError: null })),
        delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(),
        mostVisited: vi.fn(async () => ({ ok: true as const, sites: sites.map(site => ({ ...site })), recording: true, storageError: null })),
        onChanged: vi.fn((callback: () => void) => { historyChanged = callback; return () => { historyChanged = undefined; }; }),
    };
    mocks.bridge = {
        open: vi.fn(async () => ({ ok: true, engine: 'electron' })), hide: vi.fn(), close: vi.fn(), navigate,
        nav: vi.fn(), focus: vi.fn(), setBounds: vi.fn(), openExternal: vi.fn(),
        onState: vi.fn(() => vi.fn()), onDownload: vi.fn(() => vi.fn()), onNewTab: vi.fn(), onClosed: vi.fn(),
        getPreferences: vi.fn(), setDefaultEngine: vi.fn(), clearData: vi.fn(), onPreferencesChanged: vi.fn(),
        favorites: favorites as unknown as DesktopBrowserFavorites, history,
    };
});
afterEach(() => { cleanup(); mocks.bridge = undefined; });

const props = { tabId: 'tab', viewId: 'view', sessionKey: 'workspace-a', url: 'https://example.test/', active: true, visible: true,
    favoritesEnabled: true, historyOwnerKey: 'owner-a' };
function tab(overrides: Partial<React.ComponentProps<typeof UnifiedBrowserTab>> = {}) {
    return render(<UnifiedBrowserTab {...props} onNavigate={vi.fn()} onPageState={vi.fn()} {...overrides} />);
}
async function commit(engine: 'electron' | 'webview2', page: { url: string; title: string }, patch: object = {}) {
    await waitFor(() => expect(vi.mocked(mocks.bridge!.onState)).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/^(Reload|Stop)$/)).not.toBeDisabled());
    const emit = vi.mocked(mocks.bridge!.onState).mock.calls[0][0];
    act(() => emit({ viewId: 'view', engine, sourceKind: 'url', url: page.url, title: page.title,
        committedPage: { ...page, revision: 1 }, loading: false, canGoBack: false, canGoForward: false, ...patch }));
}
async function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    return screen.findByRole('menu', { name: 'Favorites' });
}

describe('browser favorites star menu', () => {
    it('stays hidden while the flag is off, on older desktops and in the web app', async () => {
        const view = tab({ favoritesEnabled: false });
        expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
        view.unmount();
        delete mocks.bridge!.favorites;
        tab();
        expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
        cleanup();
        mocks.bridge = undefined;
        tab();
        expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
    });

    it.each(['electron', 'webview2'] as const)('saves only the committed %s page and reflects saved state on the star', async engine => {
        tab();
        const menu = await openMenu();
        const save = within(menu).getByRole('menuitem', { name: 'Save current page' });
        expect(save).toBeDisabled();
        fireEvent.keyDown(menu, { key: 'Escape' });
        await commit(engine, { url: 'https://example.test/', title: 'Example' }, { loading: true });
        await openMenu();
        expect(screen.getByRole('menuitem', { name: 'Save current page' })).toBeDisabled();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        await commit(engine, { url: 'https://example.test/', title: 'Example' });
        await openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Save current page' }));
        expect(favorites.add).toHaveBeenCalledWith('https://example.test/', 'Example');
        expect(await screen.findByRole('menuitem', { name: 'Current page saved' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute('data-saved', 'true');
        expect(screen.getByRole('menu')).toHaveFocus();
    });

    it.each(['electron', 'webview2'] as const)('opens favorites and most-visited sites in the current %s tab', async engine => {
        const onOpenHistoryUrl = vi.fn();
        const onNavigate = vi.fn();
        tab({ onOpenHistoryUrl, onNavigate });
        await commit(engine, { url: 'https://example.test/', title: 'Example' });
        let menu = await openMenu();
        const visited = within(menu).getByRole('group', { name: 'Most visited' });
        await waitFor(() => expect(within(visited).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['docs.test', 'news.test']));
        fireEvent.click(within(visited).getByRole('menuitem', { name: 'docs.test' }));
        expect(screen.queryByRole('menu')).toBeNull();
        expect(onNavigate).toHaveBeenCalledWith('tab', 'https://docs.test/latest');
        expect(navigate).toHaveBeenCalledWith('view', 'https://docs.test/latest');
        expect(screen.getByRole('button', { name: 'Favorites' })).toHaveFocus();
        menu = await openMenu();
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Saved A' }));
        expect(navigate).toHaveBeenLastCalledWith('view', 'https://saved.test/a');
        expect(onOpenHistoryUrl).not.toHaveBeenCalled();
    });

    it('removes favorites, keeps focus in the menu and shows empty states', async () => {
        tab();
        const menu = await openMenu();
        const remove = await within(menu).findByRole('menuitem', { name: 'Remove Saved A from favorites' });
        remove.focus();
        fireEvent.click(remove);
        expect(favorites.remove).toHaveBeenCalledWith('https://saved.test/a');
        expect(await within(menu).findByText('No favorites yet.')).toBeInTheDocument();
        expect(menu.contains(document.activeElement)).toBe(true);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('clears most-visited on a history change while keeping favorites', async () => {
        tab();
        const menu = await openMenu();
        await within(menu).findByRole('menuitem', { name: 'docs.test' });
        sites = [];
        act(() => historyChanged!());
        expect(await within(menu).findByText('No browsing history yet.')).toBeInTheDocument();
        expect(within(menu).getByRole('menuitem', { name: 'Saved A' })).toBeInTheDocument();
    });

    it('omits most-visited on hosts without it and reports storage failures', async () => {
        delete history.mostVisited;
        favorites.add.mockResolvedValueOnce({ ok: false, reason: 'full', message: 'Favorites are limited to 500 pages' });
        tab();
        await commit('electron', { url: 'https://example.test/', title: 'Example' });
        const menu = await openMenu();
        expect(within(menu).queryByRole('group', { name: 'Most visited' })).toBeNull();
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Save current page' }));
        expect(await within(menu).findByRole('alert')).toHaveTextContent('Favorites are limited to 500 pages');
    });

    it('supports arrow-key navigation and Escape back to the star', async () => {
        tab();
        await commit('electron', { url: 'https://example.test/', title: 'Example' });
        const menu = await openMenu();
        await within(menu).findByRole('menuitem', { name: 'docs.test' });
        expect(within(menu).getByRole('menuitem', { name: 'Save current page' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(within(menu).getByRole('menuitem', { name: 'Saved A' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'End' });
        expect(within(menu).getByRole('menuitem', { name: 'news.test' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(within(menu).getByRole('menuitem', { name: 'Save current page' })).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByRole('button', { name: 'Favorites' })).toHaveFocus();
    });

    it('closes when the tab owner or workspace changes', async () => {
        const view = tab();
        await openMenu();
        view.rerender(<UnifiedBrowserTab {...props} historyOwnerKey="owner-b" onNavigate={vi.fn()} onPageState={vi.fn()} />);
        expect(screen.queryByRole('menu')).toBeNull();
        await openMenu();
        view.rerender(<UnifiedBrowserTab {...props} historyOwnerKey="owner-b" sessionKey="workspace-b" onNavigate={vi.fn()} onPageState={vi.fn()} />);
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
