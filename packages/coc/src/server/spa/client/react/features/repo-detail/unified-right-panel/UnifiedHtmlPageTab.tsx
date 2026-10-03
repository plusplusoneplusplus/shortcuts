import { useEffect, useMemo, useRef, useState } from 'react';
import {
    desktopHtmlPageBridge,
    type HtmlPageLoadState,
} from '../../../shared/file-path/html-page-bridge';
import { useNativeViewPlacement } from './useNativeViewPlacement';

export interface UnifiedHtmlPageTabProps {
    tabId: string;
    pageId: string;
    filePath: string;
    wsId: string;
    active: boolean;
    visible: boolean;
    onErrorChange: (id: string, hasError: boolean) => void;
}

const toolbarButton = 'rounded px-2 py-1 hover:bg-[#e8e8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] dark:hover:bg-[#37373d]';

export function UnifiedHtmlPageTab({
    tabId, pageId, filePath, wsId, active, visible, onErrorChange,
}: UnifiedHtmlPageTabProps) {
    const bridge = desktopHtmlPageBridge();
    const placeholder = useRef<HTMLDivElement>(null);
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

    const placement = useMemo(() => bridge ? {
        setBounds: (rect: { x: number; y: number; width: number; height: number }) => bridge.setBounds(pageId, rect),
        hide: () => bridge.hide(pageId),
    } : null, [bridge, pageId]);
    useNativeViewPlacement(placeholder, active && visible && loadState?.status !== 'failed', placement);

    const viewSource = () => {
        window.dispatchEvent(new CustomEvent('coc-open-source-canvas', {
            detail: { filePath, wsId, forceSourceViewer: true },
        }));
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-white text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#cccccc]">
            <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-[#e5e5e5] px-2 py-1 text-xs dark:border-[#333]">
                <button className={toolbarButton} type="button" onClick={() => bridge?.reload(pageId)}>Reload</button>
                <button className={toolbarButton} type="button" onClick={viewSource}>View source</button>
                <button className={toolbarButton} type="button" onClick={() => bridge?.openExternal(pageId)}>Open in system browser</button>
            </div>
            {loadState?.status === 'failed' && (
                <div role="alert" className="p-4 text-sm">
                    <p>Could not load page: {loadState.error ?? 'Unknown error'}</p>
                    <button className={toolbarButton} type="button" onClick={viewSource}>View source</button>
                </div>
            )}
            <div
                ref={placeholder}
                className="min-h-0 flex-1"
                style={{ display: loadState?.status === 'failed' ? 'none' : undefined }}
                data-testid="html-page-placeholder"
            />
        </div>
    );
}
