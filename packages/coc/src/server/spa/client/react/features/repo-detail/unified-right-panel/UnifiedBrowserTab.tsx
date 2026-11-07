import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TerminalSessionSummary } from '../../terminal/TerminalView';
import { BrowserCookieImportDialog } from './BrowserCookieImportDialog';
import { BrowserToolbarMenu } from './BrowserToolbarMenu';
import { BrowserDownloadsPanel } from './BrowserDownloadsPanel';
import { BrowserHistoryPanel } from './BrowserHistoryPanel';
import { BrowserFavoritesMenu } from './BrowserFavoritesMenu';
import { BrowserAddressBar } from './BrowserAddressBar';
import { BrowserSiteInfoButton, type BrowserSiteInfoSource } from './BrowserSiteInfo';
import { BrowserHumanTakeoverStrip } from '../../../shared/file-path/BrowserHumanTakeoverStrip';
import { newChatBrowserAnnotationOwner } from '../../../shared/file-path/browser-annotation-chips';
import { BrowserAnnotationButton } from '../../../shared/file-path/BrowserAnnotationButton';
import { BrowserDemoStrip } from '../../../shared/file-path/BrowserDemoStrip';
import { BrowserDemoReview } from '../../../shared/file-path/BrowserDemoReview';
import { useCocClient } from '../../../repos/cloneRouting';
import { BrowserControlBadge } from '../../../shared/file-path/BrowserControlBadge';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';
import { normalizeBrowserUrl } from './unifiedBrowserTabs';
import { formatCocAddress, isCocAddressText, parseCocAddress, type CocAddress, type CocPage } from './unifiedPanelAddresses';
import { UnifiedCocPage } from './UnifiedCocPage';
import { NativeViewNavButtons, NativeViewTab, nativeViewToolbar, nativeViewToolbarButton as toolbarButton } from './NativeViewTab';
import { prepareBrowserWebview, useBrowserWebviewError } from './browserWebviewLayerStore';
import { setBrowserTabFavicon } from './browserTabFavicons';
import {
    desktopBrowserBridge,
    openUrlInSystemBrowser,
    DESKTOP_BROWSER_PREFERENCES_HASH,
    WEBVIEW2_INSTALL_URL,
    type BrowserEngine,
    type BrowserViewState,
} from '../../../shared/file-path/browser-bridge';

export interface UnifiedBrowserTabProps {
    workspaceId?: string;
    routingRef?: string | null;
    tabId: string;
    /** The desktop view id: the tab's unique resource id. */
    viewId: string;
    /** The tab's concrete routing owner; profile sharing is installation-wide. */
    sessionKey: string;
    /** The conversation a demo recorded in this tab belongs to; null when there is none. */
    chatId?: string | null;
    /** The tab's current URL; absent for a blank tab. */
    url?: string;
    relatedEngine?: BrowserEngine;
    active: boolean;
    /** False while the panel is collapsed. DOM overlays do not hide webviews. */
    visible: boolean;
    /** Explicit panel overlays that must cover native engines, never DOM guests. */
    nativeCovered?: boolean;
    /** Open a history entry through the panel's current concrete dock owner. */
    onOpenHistoryUrl?: (url: string) => void;
    /** Dismiss history when the destination workspace or clone changes. */
    historyOwnerKey?: string;
    /** `features.browserFavorites`: show the favorites and most-visited star menu. */
    favoritesEnabled?: boolean;
    /** Record a new URL (and its provisional label) on the tab descriptor. */
    onNavigate: (id: string, url: string) => void;
    /** Follow the live page: its URL after redirects and its title. */
    onPageState: (id: string, page: { url: string; title: string }) => void;
    /** Resolve a `coc://` address to a page with this tab's owners; a string is an inline error. */
    resolveCocPage: (address: CocAddress) => CocPage | string;
    /**
     * Live sessions of this tab's `coc://terminal` page; empty when it shows
     * another page. The panel confirms before a close kills them.
     */
    onTerminalSessionsChange?: (tabId: string, sessions: readonly TerminalSessionSummary[]) => void;
    /**
     * Bumped each time the panel opens or focuses this tab at `coc://terminal`
     * (the "+" menu, a link). The page the tab opened at asks for a session only
     * through it, so a restored tab never starts one on its own.
     */
    cocOpenRequest?: number;
    /** Canvas page: close, unsaved edits, the switcher chip, and the loaded title. */
    onClose?: () => void;
    onDirtyChange?: (isDirty: boolean) => void;
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    canvasSwitcher?: ReactNode;
    onCanvasTitle?: (title: string) => void;
}

/**
 * One step of the tab's own history. The live web page is a single `web`
 * entry whose back/forward the engine owns; `coc://` pages sit around it.
 */
type CocEntry = {
    kind: 'coc'; address: CocAddress; page: CocPage; nonce: number; request: { id: string; nonce: number } | null;
    /** The page the tab opened at; its terminal requests come from the panel (`cocOpenRequest`). */
    initial?: true;
};
type BrowserTabEntry = { kind: 'web' } | CocEntry;
const WEB_ENTRY: BrowserTabEntry = { kind: 'web' };

const isWebUrl = (value: string | undefined): value is string => Boolean(value) && !isCocAddressText(value!);
let cocNavigationSequence = 0;

function cocEntry(text: string, resolve: (address: CocAddress) => CocPage | string): CocEntry | string {
    const address = parseCocAddress(text);
    if ('error' in address) return address.error;
    const page = resolve(address);
    if (typeof page === 'string') return page;
    const nonce = ++cocNavigationSequence;
    const request = address.kind === 'todo' && address.itemId ? { id: address.itemId, nonce } : null;
    return { kind: 'coc', address, page, nonce, request };
}

/**
 * A general web browser tab. The address field accepts an http(s) URL or a
 * bare domain, or a `coc://` page (Terminal, Settings, To-do, Canvas) that shows the
 * panel's own view in place of the page; anything else is rejected inline
 * and never searched. The web page stays loaded, hidden, while a `coc://` page
 * shows, and the tab's back/forward step between them.
 *
 * Electron guests live in the app-level webview layer; native engines track
 * this tab's placeholder. Both survive panel unmounts and close with the tab.
 * The web app offers Open in system browser instead.
 */
export function UnifiedBrowserTab({
    workspaceId, routingRef, tabId, viewId, sessionKey, chatId, url, relatedEngine, active, visible, nativeCovered, onNavigate, onPageState, onOpenHistoryUrl, historyOwnerKey, favoritesEnabled, resolveCocPage, onTerminalSessionsChange, cocOpenRequest, onClose, onDirtyChange, onRegisterSave, canvasSwitcher, onCanvasTitle,
}: UnifiedBrowserTabProps) {
    const bridge = desktopBrowserBridge();
    // A tab opened (or reopened) at a `coc://` address resolves it once.
    const [initial] = useState(() => {
        const entry = url && isCocAddressText(url) ? cocEntry(url, resolveCocPage) : null;
        return typeof entry === 'string' ? { entry: WEB_ENTRY, error: entry }
            : { entry: entry ? { ...entry, initial: true as const } : WEB_ENTRY, error: null };
    });
    const [error, setError] = useState<string | null>(initial.error);
    const [tabHistory, setTabHistory] = useState<{ entries: readonly BrowserTabEntry[]; index: number }>({ entries: [initial.entry], index: 0 });
    const tabHistoryRef = useRef(tabHistory);
    tabHistoryRef.current = tabHistory;
    // A restored page whose owner is not known yet (a Sentinel chat still
    // loading) resolves once it is, unless the user has navigated since.
    const initialPending = useRef(initial.error !== null && Boolean(url && isCocAddressText(url)));
    useEffect(() => {
        if (!initialPending.current || !url) return;
        const entry = cocEntry(url, resolveCocPage);
        if (typeof entry === 'string') return;
        initialPending.current = false;
        setTabHistory({ entries: [{ ...entry, initial: true }], index: 0 });
        setError(null);
    }, [resolveCocPage, url]);
    const current = tabHistory.entries[tabHistory.index];
    const cocPage = current.kind === 'coc' ? current : null;
    const onCocRef = useRef(cocPage !== null);
    onCocRef.current = cocPage !== null;
    const [cocReload, setCocReload] = useState(0);
    // Ctrl/Cmd+L reaches the address from a `coc://` page, except in a terminal.
    // A DOM listener: the Settings form is a portal whose React events bubble elsewhere.
    const [cocPageNode, setCocPageNode] = useState<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!cocPageNode) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const input = addressRef.current;
            if (event.defaultPrevented || event.key.toLowerCase() !== 'l' || event.altKey || event.shiftKey
                || !(isMacPlatform() ? event.metaKey : event.ctrlKey) || !input
                || (event.target as HTMLElement | null)?.closest?.('.xterm')) return;
            event.preventDefault();
            input.focus();
            input.select();
        };
        cocPageNode.addEventListener('keydown', onKeyDown);
        return () => cocPageNode.removeEventListener('keydown', onKeyDown);
    }, [cocPageNode]);
    // The engine's page: the newest http(s) URL, kept while a `coc://` page shows.
    const lastWebUrl = useRef(isWebUrl(url) ? url : undefined);
    if (isWebUrl(url)) lastWebUrl.current = url;
    const webUrl = lastWebUrl.current;
    const sentUrl = useRef(url);
    const [pageSnapshot, setPage] = useState<{ owner: string; state: BrowserViewState } | null>(null);
    const pageOwner = JSON.stringify([sessionKey, viewId, tabId]);
    const page = pageSnapshot?.owner === pageOwner ? pageSnapshot.state : null;
    const [notice, setNotice] = useState<string | null>(null);
    const [opened, setOpened] = useState(false);
    const [engine, setEngine] = useState<BrowserEngine | undefined>();
    const [embed, setEmbed] = useState<'webview'>();
    const attachError = useBrowserWebviewError(viewId);
    const [startupError, setStartupError] = useState<{ reason: string; message: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const [favoritesOpen, setFavoritesOpen] = useState(false);
    const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
    const [downloadsScope, setDownloadsScope] = useState<string | null>(null);
    const [historyScope, setHistoryScope] = useState<string | null>(null);
    const [demoReview, setDemoReview] = useState<{ scope: string; id: string } | null>(null);
    const demoClient = useCocClient(routingRef ?? workspaceId);
    const historyKey = JSON.stringify([sessionKey, viewId, tabId, historyOwnerKey]);
    const addressRef = useRef<HTMLInputElement>(null);
    const latestUrl = useRef(webUrl);
    latestUrl.current = webUrl;
    const onPageStateRef = useRef(onPageState);
    onPageStateRef.current = onPageState;

    useEffect(() => { setMenuOpen(false); setFavoritesOpen(false); setCookieDialogOpen(false); setHistoryScope(null); setDownloadsScope(null); }, [active, visible, viewId, sessionKey, historyOwnerKey]);

    const previousUrl = useRef(url);
    useEffect(() => {
        if (previousUrl.current === url) return;
        previousUrl.current = url;
        setError(null);
        // A page driven from elsewhere (an AI turn) brings its web page back.
        if (onCocRef.current && isWebUrl(url) && url !== sentUrl.current) {
            const { entries, index } = tabHistoryRef.current;
            setTabHistory({ entries: [...entries.slice(0, index + 1), WEB_ENTRY], index: index + 1 });
        }
    }, [url]);

    useEffect(() => {
        if (!active || !visible) return;
        return bridge?.onFocusAddressRequested?.(event => {
            if (event.viewId !== viewId) return;
            setMenuOpen(false);
            setFavoritesOpen(false);
            addressRef.current?.focus();
            addressRef.current?.select();
        });
    }, [bridge, active, visible, viewId]);

    const hasUrl = Boolean(webUrl);
    useEffect(() => {
        if (!bridge || !hasUrl) return;
        let disposed = false;
        const offState = bridge.onState(state => {
            if (state.viewId !== viewId || disposed) return;
            setPage({ owner: pageOwner, state });
            setEngine(state.engine);
            // A hidden page must not relabel a tab showing a `coc://` page.
            if (onCocRef.current) return;
            setBrowserTabFavicon(tabId, state.favicon);
            if (state.url) onPageStateRef.current(tabId, { url: state.url, title: state.title });
        });
        const offDownload = bridge.onDownload(event => {
            if (event.viewId !== viewId || disposed) return;
            setNotice(event.ok
                ? 'Download opened in your system browser. Manage it there.'
                : `Download unavailable: ${bridge.downloads ? event.error ?? 'Check Downloads for its state.' : 'Use Open in system browser to download from the source page.'}`);
        });
        // Reopening a live view with the same session keeps its history and page.
        setStartupError(null);
        const attach = prepareBrowserWebview(viewId);
        void bridge.open(viewId, latestUrl.current!, sessionKey, relatedEngine).then(result => {
            attach(result, bridge);
            if (disposed) return;
            setEngine(result.engine);
            if (result.ok) {
                setEmbed(result.embed);
                setOpened(true);
            } else {
                setStartupError({ reason: result.reason, message: result.message ?? `Could not open page: ${result.reason}` });
            }
        }).catch(err => {
            if (disposed) return;
            console.error('Could not open browser view:', err);
            setStartupError({ reason: 'startup-failed', message: 'Could not open this page. Retry or open Desktop Preferences.' });
        });
        return () => {
            disposed = true;
            offState();
            offDownload();
            setOpened(false);
            // A remount or another view must not show this page's icon before its own state arrives.
            setBrowserTabFavicon(tabId, undefined);
            // Hide, not close: a remount must find the live page. The panel closes the view with the tab.
            bridge.hide(viewId);
        };
    }, [bridge, hasUrl, sessionKey, tabId, viewId, relatedEngine, retry]);

    const failed = Boolean(attachError || startupError || (page?.error && !page?.loading));

    // Show one entry of the tab's history and record its address on the tab.
    const showEntry = (entries: readonly BrowserTabEntry[], index: number) => {
        initialPending.current = false;
        const entry = entries[index];
        setTabHistory({ entries, index });
        setError(null);
        if (entry.kind === 'coc') {
            const text = formatCocAddress(entry.address);
            sentUrl.current = text;
            setBrowserTabFavicon(tabId, undefined);
            onNavigate(tabId, text);
            return;
        }
        sentUrl.current = webUrl;
        if (page?.url && webUrl) {
            setBrowserTabFavicon(tabId, page.favicon);
            onPageState(tabId, { url: page.url, title: page.title });
        } else onNavigate(tabId, webUrl ?? '');
    };
    const goTo = (offset: -1 | 1) => {
        const { entries, index } = tabHistoryRef.current;
        if (entries[index + offset]) showEntry(entries, index + offset);
    };
    const canStep = (offset: -1 | 1) => Boolean(tabHistory.entries[tabHistory.index + offset]);
    // An open `coc://` To-do follows its selection without a new history step.
    const followTodoSelection = (itemId: string | null) => {
        const { entries, index } = tabHistoryRef.current;
        const entry = entries[index];
        if (entry.kind !== 'coc' || entry.address.kind !== 'todo' || (entry.address.itemId ?? null) === itemId) return;
        const address: CocAddress = { kind: 'todo', ...(itemId ? { itemId } : {}) };
        const text = formatCocAddress(address);
        setTabHistory({ entries: entries.map((candidate, at) => at === index ? { ...entry, address } : candidate), index });
        sentUrl.current = text;
        onNavigate(tabId, text);
    };

    // A session list belongs to the page showing it; leaving the page clears it.
    const onTerminalSessionsRef = useRef(onTerminalSessionsChange);
    onTerminalSessionsRef.current = onTerminalSessionsChange;
    const reportTerminalSessions = useCallback(
        (sessions: readonly TerminalSessionSummary[]) => onTerminalSessionsRef.current?.(tabId, sessions),
        [tabId],
    );
    const onTerminalPage = cocPage?.page.kind === 'terminal';
    useEffect(() => {
        if (!onTerminalPage) reportTerminalSessions([]);
    }, [onTerminalPage, reportTerminalSessions]);

    const navigateAddress = (address: string) => {
        // A `coc://` page shows in place of the web page and never reaches it.
        if (isCocAddressText(address)) {
            const entry = cocEntry(address, resolveCocPage);
            if (typeof entry === 'string') {
                setError(entry);
                return;
            }
            const { entries, index } = tabHistoryRef.current;
            const here = entries[index];
            // The same page again replaces its entry (a new item request) instead of stacking.
            // Two canvases are different pages, so moving between them is a step.
            const samePage = here.kind === 'coc' && here.page.kind === entry.page.kind
                && (here.page.kind !== 'canvas' || entry.page.kind !== 'canvas' || here.page.canvasId === entry.page.canvasId);
            if (samePage && here.kind === 'coc') {
                showEntry(entries.map((candidate, at) => at === index ? entry : candidate), index);
            } else showEntry([...entries.slice(0, index + 1), entry], index + 1);
            return formatCocAddress(entry.address);
        }
        initialPending.current = false;
        const result = normalizeBrowserUrl(address);
        if (!result.ok) {
            setError(result.reason);
            return;
        }
        setError(null);
        setNotice(null);
        setPage(null);
        // A new web page drops the steps after this one; from a `coc://` page it is a new step.
        const { entries, index } = tabHistoryRef.current;
        const kept = entries.slice(0, index + 1);
        if (entries[index].kind === 'coc') setTabHistory({ entries: [...kept, WEB_ENTRY], index: index + 1 });
        else if (kept.length < entries.length) setTabHistory({ entries: kept, index });
        sentUrl.current = result.url;
        onNavigate(tabId, result.url);
        if (bridge && opened) {
            void bridge.navigate(viewId, result.url).then(reply => {
                if (!reply.ok) setError(reply.message ?? `Could not open page: ${reply.reason}`);
            }).catch(err => { console.error('Browser navigation failed:', err); setError('Browser navigation failed. Retry explicitly.'); });
        } else if (bridge && hasUrl) {
            setRetry(value => value + 1);
        }
        return result.url;
    };

    const currentUrl = cocPage ? undefined : page?.url || webUrl;
    const openExternal = () => {
        if (!currentUrl) return;
        void openUrlInSystemBrowser(currentUrl).then(ok => {
            if (!ok) setNotice('Could not open your system browser.');
        });
    };
    const nav = (action: 'back' | 'forward' | 'reload' | 'stop') => {
        // The engine steps within its own page first; the tab steps across `coc://` pages.
        if (action === 'back' && (cocPage || !page?.canGoBack)) return goTo(-1);
        if (action === 'forward' && (cocPage || !page?.canGoForward)) return goTo(1);
        if (action === 'reload' && cocPage) return setCocReload(value => value + 1);
        bridge?.nav(viewId, action);
    };
    // The live document, never the address draft: a new commit, load or failure closes site information.
    const siteScope = JSON.stringify([pageOwner, url ?? '', page?.url ?? '', page?.committedPage?.revision ?? null, page?.loading ?? null, page?.error ?? null]);
    const siteSource: BrowserSiteInfoSource = cocPage ? { kind: 'unavailable', message: 'This is a CoC page.' }
        : !bridge ? { kind: 'unavailable', message: 'Site information is available for pages open in the CoC desktop app.' }
        : !bridge.siteInfo ? { kind: 'unavailable', message: 'This desktop version cannot report site information.' }
        : !url || !opened ? { kind: 'unavailable', message: 'Open a page to see its site information.' }
        : { kind: 'web', load: () => bridge.siteInfo!(viewId, sessionKey) };

    const committedPage = !cocPage && bridge && page?.sourceKind === 'url' && !page.loading && !page.error
        && page.committedPage?.url === page.url ? page.committedPage : undefined;

    const toolbar = (
        <div
            className={`flex min-w-0 flex-wrap ${nativeViewToolbar}`}
            data-testid="browser-toolbar"
            onKeyDown={event => {
                const mac = isMacPlatform();
                // Like a browser's address bar, the toolbar reloads its own page;
                // the desktop menu binds no reload key, so focus elsewhere never does.
                // Portaled popovers bubble here through React but are overlays, not the toolbar.
                if (active && visible && !event.defaultPrevented && event.key.toLowerCase() === 'r'
                    && (mac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey
                    && (cocPage || (bridge && opened)) && event.currentTarget.contains(event.target as Node)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!event.repeat) nav('reload');
                    return;
                }
                if (!active || !visible || event.defaultPrevented || event.key.toLowerCase() !== 'l'
                    || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey
                    || !addressRef.current) return;
                setMenuOpen(false);
                setFavoritesOpen(false);
                addressRef.current.focus();
                addressRef.current.select();
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {workspaceId && <BrowserControlBadge workspaceId={workspaceId} routingRef={routingRef} tabId={tabId} viewId={viewId} />}
            <NativeViewNavButtons
                canGoBack={(!cocPage && Boolean(page?.canGoBack)) || canStep(-1)}
                canGoForward={(!cocPage && Boolean(page?.canGoForward)) || canStep(1)}
                loading={cocPage ? false : page?.loading}
                disabled={!cocPage && !opened && tabHistory.entries.length < 2}
                onNav={nav}
                testIdPrefix="browser"
            />
            <BrowserAddressBar
                inputRef={addressRef}
                url={cocPage ? formatCocAddress(cocPage.address) : url}
                committedPage={committedPage}
                history={bridge?.history}
                enabled={active && visible}
                ownerKey={pageOwner}
                invalid={error !== null}
                onEdit={() => setError(null)}
                onOpen={navigateAddress}
                onCopyError={() => setNotice('Rich link copy unavailable. Using standard selection copy.')}
                showAddressMenu={bridge?.showAddressMenu}
                onMenuError={() => setNotice('Address menu unavailable. Use the keyboard to copy or edit.')}
                leading={<BrowserSiteInfoButton source={siteSource} scopeKey={siteScope} enabled={active && visible} />}
            />
            {favoritesEnabled && bridge?.favorites && <BrowserFavoritesMenu
                key={`favorites:${sessionKey}:${viewId}`}
                open={favoritesOpen && active && visible}
                onOpenChange={setFavoritesOpen}
                favorites={bridge.favorites}
                history={bridge.history}
                currentPage={committedPage}
                onOpen={navigateAddress} />}
            <BrowserToolbarMenu
                key={`${sessionKey}:${viewId}`}
                open={menuOpen && active && visible}
                onOpenChange={setMenuOpen}
                engine={engine}
                bridge={bridge}
                canOpenExternal={Boolean(currentUrl)}
                onOpenExternal={openExternal}
                onImportCookies={bridge?.importCookies ? () => setCookieDialogOpen(true) : undefined}
                onDownloads={() => setDownloadsScope(historyKey)}
                onHistory={bridge?.history && onOpenHistoryUrl ? () => setHistoryScope(historyKey) : undefined}
            />
            {bridge?.annotation && <BrowserAnnotationButton
                key={pageOwner} bridge={bridge.annotation} sessionKey={sessionKey} viewId={viewId}
                workspaceId={workspaceId} tabId={tabId} active={active && visible}
                ready={opened && Boolean(page) && !page?.loading && !failed}
                excluded={Boolean(cocPage) || page?.sourceKind === 'file' || isAnnotationExcludedUrl(currentUrl)}
                documentKey={siteScope}
                chatOwner={workspaceId ? chatId ? { workspaceId, routingRef: sessionKey, processId: chatId }
                    : newChatBrowserAnnotationOwner(workspaceId, sessionKey) : null} />}
            <BrowserHumanTakeoverStrip routingRef={sessionKey} viewId={viewId} />
            {bridge && <BrowserDemoStrip workspaceId={workspaceId} processId={chatId ?? null} routingRef={sessionKey} viewId={viewId}
                ready={opened && !cocPage && Boolean(webUrl) && page?.sourceKind !== 'file'} active={active && visible}
                onReview={state => setDemoReview({ scope: historyKey, id: state.id })} />}
        </div>
    );

    return (
        <NativeViewTab
            bridge={opened ? bridge : undefined}
            viewId={viewId}
            embed={embed}
            shown={opened && active && visible && !failed && !cocPage && (embed === 'webview' || !nativeCovered)}
            surfaceHidden={failed || !webUrl || Boolean(cocPage)}
            placeholderTestId="browser-placeholder"
            toolbar={toolbar}
        >
            {cookieDialogOpen && bridge && <BrowserCookieImportDialog bridge={bridge} viewId={opened ? viewId : null} relatedEngine={engine ?? relatedEngine}
                initialDomain={(() => { try { return new URL(currentUrl ?? '').hostname; } catch { return ''; } })()}
                onClose={() => { setCookieDialogOpen(false); addressRef.current?.focus(); }}
                onImported={domain => { setCookieDialogOpen(false); setNotice(`Cookies imported for ${domain}. Open the original URL to continue.`); addressRef.current?.focus(); }} />}
            {downloadsScope === historyKey && active && visible && <BrowserDownloadsPanel
                key={historyKey} downloads={bridge?.downloads} engine={engine ?? relatedEngine}
                desktop={!!bridge} onClose={() => setDownloadsScope(null)} />}
            {demoReview?.scope === historyKey && active && visible && <BrowserDemoReview
                key={demoReview.id} demoId={demoReview.id} client={demoClient} onClose={() => setDemoReview(null)} />}
            {historyScope === historyKey && active && visible && bridge?.history && onOpenHistoryUrl && <BrowserHistoryPanel
                key={historyKey} history={bridge.history} onOpen={onOpenHistoryUrl} onClose={() => setHistoryScope(null)} />}
            {error && (
                <div role="alert" className="px-3 py-1.5 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="browser-address-error">
                    {error}
                </div>
            )}
            {notice && (
                <div role="status" className="px-3 py-1.5 text-[11px] text-[#616161] dark:text-[#9d9d9d]" data-testid="browser-notice">
                    {notice}
                </div>
            )}
            {cocPage ? (
                <div ref={setCocPageNode} className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="browser-coc-page">
                    <UnifiedCocPage
                        key={cocPage.page.kind === 'terminal' ? `${tabHistory.index}:${cocReload}`
                            : cocPage.page.kind === 'canvas' ? `${tabHistory.index}:${cocPage.page.canvasId}`
                            : String(tabHistory.index)}
                        page={cocPage.page}
                        active={active && visible}
                        terminalOpenRequest={cocPage.initial ? cocOpenRequest ?? 0 : cocPage.nonce}
                        selectItemRequest={cocPage.request}
                        reloadNonce={cocReload}
                        onTodoSelectionChange={followTodoSelection}
                        onTerminalSessionsChange={reportTerminalSessions}
                        onClose={onClose}
                        onDirtyChange={onDirtyChange}
                        onRegisterSave={onRegisterSave}
                        canvasSwitcher={canvasSwitcher}
                        onCanvasTitle={onCanvasTitle}
                    />
                </div>
            ) : bridge ? (
                <>
                    {failed && (
                        <div role="alert" className="flex flex-col items-center gap-2 p-4 text-center text-xs" data-testid="browser-load-error">
                            <p>{attachError ?? startupError?.message ?? `Could not load ${page?.url || url}: ${page?.error}`}</p>
                            {!attachError && <button className={toolbarButton} type="button" onClick={() => startupError ? setRetry(value => value + 1) : nav('reload')}>Retry</button>}
                            {attachError && <p>Close this tab and open it again to retry.</p>}
                            <a className={toolbarButton} href={DESKTOP_BROWSER_PREFERENCES_HASH}>Desktop Preferences</a>
                            {(startupError?.reason === 'missing-runtime' || page?.errorCode === 'missing-runtime') && (
                                <button className={toolbarButton} type="button" onClick={() => {
                                    void openUrlInSystemBrowser(WEBVIEW2_INSTALL_URL).then(ok => { if (!ok) setNotice('Could not open the official WebView2 download page.'); });
                                }}>Get WebView2 Runtime</button>
                            )}
                        </div>
                    )}
                    {!webUrl && (
                        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[#616161] dark:text-[#9d9d9d]">
                            <p>Enter a web address above.</p>
                        </div>
                    )}
                </>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]" data-testid="browser-web-fallback">
                    {webUrl ? (
                        <>
                            <p>Embedded browsing is available in the CoC desktop app.</p>
                            <button className={toolbarButton} type="button" onClick={openExternal}>
                                Open {webUrl} in system browser
                            </button>
                        </>
                    ) : (
                        <p>Enter a web address above.</p>
                    )}
                </div>
            )}
        </NativeViewTab>
    );
}

function isAnnotationExcludedUrl(url?: string): boolean {
    if (!url) return false;
    try {
        const page = new URL(url);
        return !['http:', 'https:'].includes(page.protocol) || /\.pdf$/i.test(page.pathname)
            || page.origin === location.origin && page.pathname === location.pathname;
    } catch { return true; }
}
