import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBrowserUrl } from './unifiedBrowserTabs';
import { useNativeViewPlacement } from './useNativeViewPlacement';
import {
    desktopBrowserBridge,
    openUrlInSystemBrowser,
    type BrowserViewState,
} from '../../../shared/file-path/browser-bridge';

export interface UnifiedBrowserTabProps {
    tabId: string;
    /** The desktop view id: the tab's unique resource id. */
    viewId: string;
    /** The tab's concrete owner identity; tabs sharing it share site sign-ins. */
    sessionKey: string;
    /** The tab's current URL; absent for a blank tab. */
    url?: string;
    active: boolean;
    /** False while the panel is collapsed or a menu/dialog covers it. */
    visible: boolean;
    /** Record a new URL (and its provisional label) on the tab descriptor. */
    onNavigate: (id: string, url: string) => void;
    /** Follow the live page: its URL after redirects and its title. */
    onPageState: (id: string, page: { url: string; title: string }) => void;
}

const toolbarButton = 'rounded px-2 py-1 hover:bg-[#e8e8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-[#37373d]';

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
    tabId, viewId, sessionKey, url, active, visible, onNavigate, onPageState,
}: UnifiedBrowserTabProps) {
    const bridge = desktopBrowserBridge();
    const placeholder = useRef<HTMLDivElement>(null);
    const [address, setAddress] = useState(url ?? '');
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState<BrowserViewState | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [opened, setOpened] = useState(false);
    const latestUrl = useRef(url);
    latestUrl.current = url;
    const onPageStateRef = useRef(onPageState);
    onPageStateRef.current = onPageState;

    // The page's own navigation moves the address unless the user is editing.
    useEffect(() => {
        setAddress(url ?? '');
        setError(null);
    }, [url]);

    const hasUrl = Boolean(url);
    useEffect(() => {
        if (!bridge || !hasUrl) return;
        let disposed = false;
        const offState = bridge.onState(state => {
            if (state.viewId !== viewId || disposed) return;
            setPage(state);
            if (state.url) onPageStateRef.current(tabId, { url: state.url, title: state.title });
        });
        const offDownload = bridge.onDownload(event => {
            if (event.viewId !== viewId || disposed) return;
            setNotice(event.ok
                ? `Download opened in your system browser: ${event.url}`
                : `Could not hand the download to your system browser: ${event.error ?? 'unknown error'}`);
        });
        // Reopening a live view with the same session keeps its history and page.
        void bridge.open(viewId, latestUrl.current!, sessionKey).then(result => {
            if (disposed) return;
            if (result.ok) {
                setOpened(true);
            } else {
                setError(`Could not open page: ${result.reason}`);
            }
        }).catch(err => {
            if (disposed) return;
            console.error('Could not open browser view:', err);
            setError('Could not open this page.');
        });
        return () => {
            disposed = true;
            offState();
            offDownload();
            setOpened(false);
            // Hide, not close: a remount must find the live page. The panel closes the view with the tab.
            bridge.hide(viewId);
        };
    }, [bridge, hasUrl, sessionKey, tabId, viewId]);

    const failed = Boolean(page?.error) && !page?.loading;
    const placement = useMemo(() => bridge ? {
        setBounds: (rect: { x: number; y: number; width: number; height: number }) => bridge.setBounds(viewId, rect),
        hide: () => bridge.hide(viewId),
    } : null, [bridge, viewId]);
    useNativeViewPlacement(placeholder, opened && active && visible && !failed, placement);

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
                if (!reply.ok) setError(`Could not open page: ${reply.reason}`);
            });
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

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-white text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#cccccc]">
            <form
                className="flex flex-shrink-0 items-center gap-1 border-b border-[#e5e5e5] px-2 py-1 text-xs dark:border-[#333]"
                onSubmit={submit}
            >
                {bridge && (
                    <>
                        <button
                            className={toolbarButton}
                            type="button"
                            aria-label="Back"
                            title="Back"
                            disabled={!opened || !page?.canGoBack}
                            onClick={() => nav('back')}
                            data-testid="browser-back"
                        >
                            ←
                        </button>
                        <button
                            className={toolbarButton}
                            type="button"
                            aria-label="Forward"
                            title="Forward"
                            disabled={!opened || !page?.canGoForward}
                            onClick={() => nav('forward')}
                            data-testid="browser-forward"
                        >
                            →
                        </button>
                        {page?.loading ? (
                            <button
                                className={toolbarButton}
                                type="button"
                                aria-label="Stop"
                                title="Stop"
                                onClick={() => nav('stop')}
                                data-testid="browser-stop"
                            >
                                ✕
                            </button>
                        ) : (
                            <button
                                className={toolbarButton}
                                type="button"
                                aria-label="Reload"
                                title="Reload"
                                disabled={!opened}
                                onClick={() => nav('reload')}
                                data-testid="browser-reload"
                            >
                                ↻
                            </button>
                        )}
                    </>
                )}
                <input
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
                <button
                    className={toolbarButton}
                    type="button"
                    disabled={!currentUrl}
                    onClick={openExternal}
                    data-testid="browser-open-external"
                >
                    Open in system browser
                </button>
            </form>
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
                            <p>Could not load {page?.url || url}: {page?.error}</p>
                            <button className={toolbarButton} type="button" onClick={() => nav('reload')}>Retry</button>
                        </div>
                    )}
                    {!url && (
                        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-[#616161] dark:text-[#9d9d9d]">
                            <p>Enter a web address above.</p>
                        </div>
                    )}
                    <div
                        ref={placeholder}
                        className="min-h-0 flex-1"
                        style={{ display: failed || !url ? 'none' : undefined }}
                        data-testid="browser-placeholder"
                    />
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
        </div>
    );
}
