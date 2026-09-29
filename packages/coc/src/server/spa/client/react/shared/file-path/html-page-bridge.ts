/** The desktop preload's sandboxed HTML page view API. */
export interface DesktopHtmlPageBridge {
    open(pageId: string, filePath: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    setBounds(pageId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
    hide(pageId: string): void;
    close(pageId: string): void;
    reload(pageId: string): void;
    openExternal(pageId: string): void;
    onState(callback: (state: HtmlPageLoadState) => void): () => void;
}

export interface HtmlPageLoadState {
    pageId: string;
    status: 'loading' | 'loaded' | 'failed';
    url?: string;
    error?: string;
}

export interface OpenHtmlPageDetail {
    pageId: string;
    filePath: string;
    wsId: string;
    scopeWsId: string;
    handled?: boolean;
}

export function desktopHtmlPageBridge(): DesktopHtmlPageBridge | undefined {
    return (window as { cocDesktop?: { htmlPage?: DesktopHtmlPageBridge } }).cocDesktop?.htmlPage;
}
