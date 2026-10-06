import { useEffect, useState } from 'react';
import {
    desktopHtmlPageBridge,
    type HtmlPageLoadState,
} from '../../../shared/file-path/html-page-bridge';
import { NativeViewNavButtons, NativeViewTab, nativeViewToolbarButton as toolbarButton } from './NativeViewTab';

export interface UnifiedHtmlPageTabProps {
    tabId: string;
    pageId: string;
    filePath: string;
    wsId: string;
    chatId?: string | null;
    active: boolean;
    visible: boolean;
    onErrorChange: (id: string, hasError: boolean) => void;
}

/**
 * A local HTML file in a sandboxed desktop view. The toolbar shows the file
 * path read-only; back/forward need the merged desktop browser API.
 */
export function UnifiedHtmlPageTab({
    tabId, pageId, filePath, wsId, chatId, active, visible, onErrorChange,
}: UnifiedHtmlPageTabProps) {
    const bridge = desktopHtmlPageBridge();
    const [loadState, setLoadState] = useState<HtmlPageLoadState | null>(null);

    useEffect(() => {
        if (!bridge) return;
        let disposed = false;
        const unsubscribe = bridge.onState(state => {
            if (state.pageId !== pageId || disposed) return;
            setLoadState(state);
            onErrorChange(tabId, state.status === 'failed');
        });
        void bridge.open(pageId, filePath).then(result => {
            if (disposed) {
                bridge.close(pageId);
            } else if (!result.ok) {
                setLoadState({ pageId, status: 'failed', error: `Could not open page: ${result.reason}` });
                onErrorChange(tabId, true);
            }
        }).catch(error => {
            if (disposed) return;
            console.error('Could not open HTML page:', error);
            setLoadState({ pageId, status: 'failed', error: 'Could not open this page.' });
            onErrorChange(tabId, true);
        });
        return () => {
            disposed = true;
            unsubscribe();
            bridge.close(pageId);
            onErrorChange(tabId, false);
        };
    }, [bridge, filePath, onErrorChange, pageId, tabId]);

    const failed = loadState?.status === 'failed';
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
        <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-[#e5e5e5] px-2 py-1 text-xs dark:border-[#333]">
            <NativeViewNavButtons
                canGoBack={Boolean(bridge?.nav && loadState?.canGoBack)}
                canGoForward={Boolean(bridge?.nav && loadState?.canGoForward)}
                onNav={nav}
                testIdPrefix="html-page"
            />
            <span
                className="min-w-0 flex-1 truncate px-1 text-[#616161] dark:text-[#9d9d9d]"
                title={filePath}
                data-testid="html-page-path"
            >
                {filePath}
            </span>
            <button className={toolbarButton} type="button" onClick={viewSource}>View source</button>
            <button className={toolbarButton} type="button" onClick={() => bridge?.openExternal(pageId)}>Open in system browser</button>
        </div>
    );

    return (
        <NativeViewTab
            bridge={bridge}
            viewId={pageId}
            shown={active && visible && !failed}
            surfaceHidden={failed}
            placeholderTestId="html-page-placeholder"
            toolbar={toolbar}
        >
            {failed && (
                <div role="alert" className="p-4 text-sm">
                    <p>Could not load page: {loadState?.error ?? 'Unknown error'}</p>
                    <button className={toolbarButton} type="button" onClick={viewSource}>View source</button>
                </div>
            )}
        </NativeViewTab>
    );
}
