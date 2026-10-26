import { useEffect, useRef, useState } from 'react';
import { BrowserCookieImportDialog } from './BrowserCookieImportDialog';
import { BrowserToolbarMenu } from './BrowserToolbarMenu';
import { BrowserDownloadsPanel } from './BrowserDownloadsPanel';
import { BrowserHistoryPanel } from './BrowserHistoryPanel';
import { BrowserAddressBar } from './BrowserAddressBar';
import { BrowserSiteInfoButton, type BrowserSiteInfoSource } from './BrowserSiteInfo';
import { BrowserHumanTakeoverStrip } from '../../../shared/file-path/BrowserHumanTakeoverStrip';
import { BrowserControlBadge } from '../../../shared/file-path/BrowserControlBadge';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';
import { normalizeBrowserUrl } from './unifiedBrowserTabs';
import { NativeViewNavButtons, NativeViewTab, nativeViewToolbar, nativeViewToolbarButton as toolbarButton } from './NativeViewTab';
import { prepareBrowserWebview, useBrowserWebviewError } from './browserWebviewLayerStore';
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
    /** Record a new URL (and its provisional label) on the tab descriptor. */
    onNavigate: (id: string, url: string) => void;
    /** Follow the live page: its URL after redirects and its title. */
    onPageState: (id: string, page: { url: string; title: string }) => void;
}

/**
 * A general web browser tab. The address field accepts an http(s) URL or a
 * bare domain; anything else is rejected inline and never searched.
 *
 * Electron guests live in the app-level webview layer; native engines track
 * this tab's placeholder. Both survive panel unmounts and close with the tab.
 * The web app offers Open in system browser instead.
 */
export function UnifiedBrowserTab({
    workspaceId, routingRef, tabId, viewId, sessionKey, url, relatedEngine, active, visible, nativeCovered, onNavigate, onPageState, onOpenHistoryUrl, historyOwnerKey,
}: UnifiedBrowserTabProps) {
    const bridge = desktopBrowserBridge();
    const [error, setError] = useState<string | null>(null);
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
    const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
    const [downloadsScope, setDownloadsScope] = useState<string | null>(null);
    const [historyScope, setHistoryScope] = useState<string | null>(null);
    const historyKey = JSON.stringify([sessionKey, viewId, tabId, historyOwnerKey]);
    const addressRef = useRef<HTMLInputElement>(null);
    const latestUrl = useRef(url);
    latestUrl.current = url;
    const onPageStateRef = useRef(onPageState);
    onPageStateRef.current = onPageState;

    useEffect(() => { setMenuOpen(false); setCookieDialogOpen(false); setHistoryScope(null); setDownloadsScope(null); }, [active, visible, viewId, sessionKey, historyOwnerKey]);

    useEffect(() => { setError(null); }, [url]);

    useEffect(() => {
        if (!active || !visible) return;
        return bridge?.onFocusAddressRequested?.(event => {
            if (event.viewId !== viewId) return;
            setMenuOpen(false);
            addressRef.current?.focus();
            addressRef.current?.select();
        });
    }, [bridge, active, visible, viewId]);

    const hasUrl = Boolean(url);
    useEffect(() => {
        if (!bridge || !hasUrl) return;
        let disposed = false;
        const offState = bridge.onState(state => {
            if (state.viewId !== viewId || disposed) return;
            setPage({ owner: pageOwner, state });
            setEngine(state.engine);
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
            // Hide, not close: a remount must find the live page. The panel closes the view with the tab.
            bridge.hide(viewId);
        };
    }, [bridge, hasUrl, sessionKey, tabId, viewId, relatedEngine, retry]);

    const failed = Boolean(attachError || startupError || (page?.error && !page?.loading));

    const navigateAddress = (address: string) => {
        const result = normalizeBrowserUrl(address);
        if (!result.ok) {
            setError(result.reason);
            return;
        }
        setError(null);
        setNotice(null);
        setPage(null);
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

    const currentUrl = page?.url || url;
    const openExternal = () => {
        if (!currentUrl) return;
        void openUrlInSystemBrowser(currentUrl).then(ok => {
            if (!ok) setNotice('Could not open your system browser.');
        });
    };
    const nav = (action: 'back' | 'forward' | 'reload' | 'stop') => bridge?.nav(viewId, action);
    // The live document, never the address draft: a new commit, load or failure closes site information.
    const siteScope = JSON.stringify([pageOwner, url ?? '', page?.url ?? '', page?.committedPage?.revision ?? null, page?.loading ?? null, page?.error ?? null]);
    const siteSource: BrowserSiteInfoSource = !bridge ? { kind: 'unavailable', message: 'Site information is available for pages open in the CoC desktop app.' }
        : !bridge.siteInfo ? { kind: 'unavailable', message: 'This desktop version cannot report site information.' }
        : !url || !opened ? { kind: 'unavailable', message: 'Open a page to see its site information.' }
        : { kind: 'web', load: () => bridge.siteInfo!(viewId, sessionKey) };

    const toolbar = (
        <div
            className={`flex min-w-0 flex-wrap ${nativeViewToolbar}`}
            data-testid="browser-toolbar"
            onKeyDown={event => {
                const mac = isMacPlatform();
                if (!active || !visible || event.defaultPrevented || event.key.toLowerCase() !== 'l'
                    || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey
                    || !addressRef.current) return;
                setMenuOpen(false);
                addressRef.current.focus();
                addressRef.current.select();
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {workspaceId && <BrowserControlBadge workspaceId={workspaceId} routingRef={routingRef} tabId={tabId} viewId={viewId} />}
            {bridge && (
                <NativeViewNavButtons
                    canGoBack={Boolean(page?.canGoBack)}
                    canGoForward={Boolean(page?.canGoForward)}
                    loading={page?.loading}
                    disabled={!opened}
                    onNav={nav}
                    testIdPrefix="browser"
                />
            )}
            <BrowserAddressBar
                inputRef={addressRef}
                url={url}
                committedPage={bridge && page?.sourceKind === 'url' && !page.loading && !page.error
                    && page.committedPage?.url === page.url ? page.committedPage : undefined}
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
            <BrowserHumanTakeoverStrip routingRef={sessionKey} viewId={viewId} />
        </div>
    );

    return (
        <NativeViewTab
            bridge={opened ? bridge : undefined}
            viewId={viewId}
            embed={embed}
            shown={opened && active && visible && !failed && (embed === 'webview' || !nativeCovered)}
            surfaceHidden={failed || !url}
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
            {bridge ? (
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
                    {!url && (
                        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[#616161] dark:text-[#9d9d9d]">
                            <p>Enter a web address above.</p>
                        </div>
                    )}
                </>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]" data-testid="browser-web-fallback">
                    {url ? (
                        <>
                            <p>Embedded browsing is available in the CoC desktop app.</p>
                            <button className={toolbarButton} type="button" onClick={openExternal}>
                                Open {url} in system browser
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
