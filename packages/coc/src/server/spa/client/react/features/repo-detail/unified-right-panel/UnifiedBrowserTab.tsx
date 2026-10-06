import { useEffect, useRef, useState } from 'react';
import { BrowserToolbarMenu } from './BrowserToolbarMenu';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';
import { normalizeBrowserUrl } from './unifiedBrowserTabs';
import { NativeViewNavButtons, NativeViewTab, nativeViewToolbarButton as toolbarButton } from './NativeViewTab';
import {
    desktopBrowserBridge,
    openUrlInSystemBrowser,
    DESKTOP_BROWSER_PREFERENCES_HASH,
    WEBVIEW2_INSTALL_URL,
    type BrowserEngine,
    type BrowserViewState,
} from '../../../shared/file-path/browser-bridge';

export interface UnifiedBrowserTabProps {
    tabId: string;
    /** The desktop view id: the tab's unique resource id. */
    viewId: string;
    /** The tab's concrete routing owner; profile sharing is installation-wide. */
    sessionKey: string;
    /** The tab's current URL; absent for a blank tab. */
    url?: string;
    relatedEngine?: BrowserEngine;
    active: boolean;
    /** False while the panel is collapsed or a menu/dialog covers it. */
    visible: boolean;
    /** Record a new URL (and its provisional label) on the tab descriptor. */
    onNavigate: (id: string, url: string) => void;
    /** Follow the live page: its URL after redirects and its title. */
    onPageState: (id: string, page: { url: string; title: string }) => void;
}

/**
 * A general web browser tab. The address field accepts an http(s) URL or a
 * bare domain; anything else is rejected inline and never searched.
 *
 * In the desktop app the page lives in a sandboxed native view kept over this
 * tab's placeholder. The view survives unmounts (chat switches, panel
 * collapse) so live history is kept; only closing the tab destroys it. In the
 * web app the tab offers Open in system browser instead.
 */
export function UnifiedBrowserTab({
    tabId, viewId, sessionKey, url, relatedEngine, active, visible, onNavigate, onPageState,
}: UnifiedBrowserTabProps) {
    const bridge = desktopBrowserBridge();
    const [address, setAddress] = useState(url ?? '');
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState<BrowserViewState | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [opened, setOpened] = useState(false);
    const [engine, setEngine] = useState<BrowserEngine | undefined>();
    const [startupError, setStartupError] = useState<{ reason: string; message: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const addressRef = useRef<HTMLInputElement>(null);
    const latestUrl = useRef(url);
    latestUrl.current = url;
    const onPageStateRef = useRef(onPageState);
    onPageStateRef.current = onPageState;

    useEffect(() => { setMenuOpen(false); }, [active, visible, viewId, sessionKey]);

    // The page's own navigation moves the address unless the user is editing.
    useEffect(() => {
        setAddress(url ?? '');
        setError(null);
    }, [url]);

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
            setPage(state);
            setEngine(state.engine);
            if (state.url) onPageStateRef.current(tabId, { url: state.url, title: state.title });
        });
        const offDownload = bridge.onDownload(event => {
            if (event.viewId !== viewId || disposed) return;
            setNotice(event.ok
                ? `Download opened in your system browser: ${event.url}`
                : `Could not hand the download to your system browser: ${event.error ?? 'unknown error'}`);
        });
        // Reopening a live view with the same session keeps its history and page.
        setStartupError(null);
        void bridge.open(viewId, latestUrl.current!, sessionKey, relatedEngine).then(result => {
            if (disposed) return;
            setEngine(result.engine);
            if (result.ok) {
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

    const failed = Boolean(startupError || (page?.error && !page?.loading));

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const result = normalizeBrowserUrl(address);
        if (!result.ok) {
            setError(result.reason);
            return;
        }
        setError(null);
        setNotice(null);
        setAddress(result.url);
        onNavigate(tabId, result.url);
        if (bridge && opened) {
            void bridge.navigate(viewId, result.url).then(reply => {
                if (!reply.ok) setError(reply.message ?? `Could not open page: ${reply.reason}`);
            }).catch(err => { console.error('Browser navigation failed:', err); setError('Browser navigation failed. Retry explicitly.'); });
        } else if (bridge && hasUrl) {
            setRetry(value => value + 1);
        }
    };

    const currentUrl = page?.url || url;
    const openExternal = () => {
        if (!currentUrl) return;
        void openUrlInSystemBrowser(currentUrl).then(ok => {
            if (!ok) setNotice('Could not open your system browser.');
        });
    };
    const nav = (action: 'back' | 'forward' | 'reload' | 'stop') => bridge?.nav(viewId, action);

    const toolbar = (
        <form
            className="flex min-w-0 flex-shrink-0 items-center gap-1 border-b border-[#e5e5e5] px-2 py-1 text-xs dark:border-[#333]"
            onSubmit={submit}
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
            <input
                ref={addressRef}
                type="text"
                value={address}
                onChange={event => { setAddress(event.target.value); setError(null); }}
                placeholder="Enter a URL"
                aria-label="Address"
                aria-invalid={error !== null}
                spellCheck={false}
                autoFocus={!url}
                className="min-w-0 flex-1 rounded border border-[#c8c8c8] bg-transparent px-2 py-1 outline-none focus:border-[#007acc] dark:border-[#3c3c3c]"
                data-testid="browser-address"
            />
            <BrowserToolbarMenu
                key={`${sessionKey}:${viewId}`}
                open={menuOpen && active && visible}
                onOpenChange={setMenuOpen}
                engine={engine}
                canOpenExternal={Boolean(currentUrl)}
                onOpenExternal={openExternal}
            />
        </form>
    );

    return (
        <NativeViewTab
            bridge={bridge}
            viewId={viewId}
            shown={opened && active && visible && !failed && !menuOpen}
            surfaceHidden={failed || !url}
            placeholderTestId="browser-placeholder"
            toolbar={toolbar}
        >
            {bridge && page?.title && (
                <div
                    className="flex-shrink-0 truncate border-b border-[#e5e5e5] px-3 py-0.5 text-[11px] text-[#616161] dark:border-[#333] dark:text-[#9d9d9d]"
                    title={page.title}
                    data-testid="browser-title"
                >
                    {page.loading ? 'Loading… ' : ''}{page.title}
                </div>
            )}
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
                            <p>{startupError?.message ?? `Could not load ${page?.url || url}: ${page?.error}`}</p>
                            <button className={toolbarButton} type="button" onClick={() => startupError ? setRetry(value => value + 1) : nav('reload')}>Retry</button>
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
