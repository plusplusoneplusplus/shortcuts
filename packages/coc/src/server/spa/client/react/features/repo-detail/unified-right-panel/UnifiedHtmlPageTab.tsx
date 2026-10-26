import { useEffect, useState } from 'react';
import {
    desktopHtmlPageBridge,
    HTML_PAGE_VIEW_PREFIX,
    type HtmlPageLoadState,
} from '../../../shared/file-path/html-page-bridge';
import { NativeViewNavButtons, NativeViewTab, nativeViewAddressField, nativeViewToolbar, nativeViewToolbarButton as toolbarButton } from './NativeViewTab';
import { desktopBrowserBridge } from '../../../shared/file-path/browser-bridge';
import { prepareBrowserWebview, useBrowserWebviewError } from './browserWebviewLayerStore';
import { BrowserSiteInfoButton } from './BrowserSiteInfo';

export interface UnifiedHtmlPageTabProps {
    tabId: string;
    pageId: string;
    filePath: string;
    wsId: string;
    chatId?: string | null;
    active: boolean;
    visible: boolean;
    nativeCovered?: boolean;
    onErrorChange: (id: string, hasError: boolean) => void;
}

/**
 * A local HTML file in a sandboxed desktop view. The toolbar shows the file
 * path read-only; back/forward need the merged desktop browser API.
 */
export function UnifiedHtmlPageTab({
    tabId, pageId, filePath, wsId, chatId, active, visible, nativeCovered, onErrorChange,
}: UnifiedHtmlPageTabProps) {
    const bridge = desktopHtmlPageBridge();
    const browser = desktopBrowserBridge();
    const viewId = HTML_PAGE_VIEW_PREFIX + pageId;
    const [opened, setOpened] = useState(false);
    const [embed, setEmbed] = useState<'webview'>();
    const attachError = useBrowserWebviewError(viewId);
    const [loadState, setLoadState] = useState<HtmlPageLoadState | null>(null);
    const failed = loadState?.status === 'failed' || Boolean(attachError);

    useEffect(() => {
        onErrorChange(tabId, failed);
    }, [failed, onErrorChange, tabId]);

    useEffect(() => {
        if (!bridge) return;
        let disposed = false;
        const unsubscribe = bridge.onState(state => {
            if (state.pageId !== pageId || disposed) return;
            setLoadState(state);
        });
        const attach = browser ? prepareBrowserWebview(viewId) : undefined;
        void bridge.open(pageId, filePath).then(result => {
            if (browser) attach?.(result.ok ? { ...result, engine: 'electron' } : result, browser);
            if (disposed) return;
            if (!result.ok) {
                setLoadState({ pageId, status: 'failed', error: `Could not open page: ${result.reason}` });
            } else {
                setEmbed(result.embed);
                setOpened(true);
            }
        }).catch(error => {
            if (disposed) return;
            console.error('Could not open HTML page:', error);
            setLoadState({ pageId, status: 'failed', error: 'Could not open this page.' });
        });
        return () => {
            disposed = true;
            unsubscribe();
            bridge.hide(pageId);
            setOpened(false);
            onErrorChange(tabId, false);
        };
    }, [bridge, browser, filePath, onErrorChange, pageId, tabId, viewId]);

    const viewSource = () => {
        window.dispatchEvent(new CustomEvent('coc-open-source-canvas', {
            detail: { filePath, wsId, chatId, forceSourceViewer: true },
        }));
    };
    const nav = (action: 'back' | 'forward' | 'reload' | 'stop') => {
        if (action === 'reload') bridge?.reload(pageId);
        else if (action !== 'stop') bridge?.nav?.(pageId, action);
    };

    const toolbar = (
        <div className={`flex overflow-x-auto whitespace-nowrap ${nativeViewToolbar}`} data-testid="html-page-toolbar">
            <NativeViewNavButtons
                canGoBack={Boolean(bridge?.nav && loadState?.canGoBack)}
                canGoForward={Boolean(bridge?.nav && loadState?.canGoForward)}
                onNav={nav}
                testIdPrefix="html-page"
            />
            <div className={`flex items-center pl-0.5 ${nativeViewAddressField}`} data-testid="html-page-path-pill">
                <BrowserSiteInfoButton
                    source={bridge ? { kind: 'local-file', path: filePath } : { kind: 'unavailable', message: 'Local previews run in the CoC desktop app.' }}
                    scopeKey={JSON.stringify([pageId, filePath])}
                    enabled={active && visible}
                />
                <span
                    className="min-w-0 flex-1 truncate pl-1 pr-3 text-[#616161] dark:text-[#9d9d9d]"
                    title={filePath}
                    data-testid="html-page-path"
                >
                    {filePath}
                </span>
            </div>
            <button className={toolbarButton} type="button" onClick={viewSource}>View source</button>
            <button className={toolbarButton} type="button" onClick={() => bridge?.openExternal(pageId)}>Open in system browser</button>
        </div>
    );

    return (
        <NativeViewTab
            bridge={opened ? bridge : undefined}
            viewId={embed === 'webview' ? viewId : pageId}
            embed={embed}
            shown={opened && active && visible && !failed && (embed === 'webview' || !nativeCovered)}
            surfaceHidden={failed}
            placeholderTestId="html-page-placeholder"
            toolbar={toolbar}
        >
            {failed && (
                <div role="alert" className="p-4 text-sm">
                    <p>Could not load page: {attachError ?? loadState?.error ?? 'Unknown error'}</p>
                    <button className={toolbarButton} type="button" onClick={viewSource}>View source</button>
                </div>
            )}
        </NativeViewTab>
    );
}
