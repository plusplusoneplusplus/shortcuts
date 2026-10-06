import type { BrowserAvailability, BrowserDownloadEvent, BrowserEngine, BrowserFailureReason, BrowserNavAction, BrowserViewState } from './browser-view-policy';
import type { HtmlPageBounds } from './html-page-policy';

export interface BrowserViewRequest {
    ownerId: number;
    viewId: string;
    sessionKey: string;
    url: string;
}

/** A local HTML preview: `path` is validated by `validateHtmlPagePath` before it gets here. */
export interface FileViewRequest {
    ownerId: number;
    viewId: string;
    sessionKey: string;
    path: string;
}

export interface BrowserEventSink {
    state(state: BrowserViewState): void;
    newTab(url: string): void;
    download(event: BrowserDownloadEvent): void;
    closeRequested(): void;
    openMenuRequested(): void;
}

export interface BrowserHostedView {
    snapshot(): BrowserViewState;
    navigate(url: string): void | Promise<void>;
    nav(action: BrowserNavAction): void | Promise<void>;
    setBounds(bounds: HtmlPageBounds | null): void | Promise<void>;
    focus(): void | Promise<void>;
    close(): void | Promise<void>;
}

export interface BrowserEngineHost {
    readonly engine: BrowserEngine;
    availability(): Promise<BrowserAvailability>;
    create(request: BrowserViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView>;
    clearData(): Promise<void>;
    dispose(): Promise<void>;
}

/** Electron-only host for local HTML previews: its own in-memory partition, never an engine profile. */
export interface FilePreviewHost {
    create(request: FileViewRequest, sink: BrowserEventSink): Promise<BrowserHostedView>;
    dispose(): Promise<void>;
}

export class BrowserHostError extends Error {
    constructor(readonly reason: BrowserFailureReason, message: string) {
        super(message);
        this.name = 'BrowserHostError';
    }
}
