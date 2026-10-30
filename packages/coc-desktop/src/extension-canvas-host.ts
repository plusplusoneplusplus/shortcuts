import { BrowserWindow, session, shell, webContents, type WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { BrowserHostError } from './browser-host-contract';
import { authorizeBrowserWebview, isBrowserEmbedder } from './browser-webview-guard';
import { classifyExtensionCanvasNavigation, extensionCanvasUrl } from './extension-canvas-policy';

export interface ExtensionCanvasGuestState {
    status: 'loading' | 'loaded' | 'failed';
    error?: string;
}

export interface ExtensionCanvasGuest {
    embed: 'webview';
    src: string;
    partition: string;
    adopt(guestId: number): void;
    close(): void;
}

interface Entry {
    contents?: WebContents;
    authorization?: ReturnType<typeof authorizeBrowserWebview>;
    closed: boolean;
    closeOwner(): void;
    close(): void;
}

/** Dedicated guests never enter the browser manager's history or control registry. */
export class ExtensionCanvasHost {
    private readonly entries = new Set<Entry>();
    private readonly profiles = new Map<string, Electron.Session>();
    private disposed = false;

    create(
        request: { ownerId: number; extensionKey: string; url: string },
        sink: { state(state: ExtensionCanvasGuestState): void; closed(): void },
    ): ExtensionCanvasGuest {
        if (this.disposed) throw new BrowserHostError('no-window', 'Canvas guest host is closed.');
        const owner = webContents.fromId(request.ownerId);
        const window = owner ? BrowserWindow.fromWebContents(owner) : null;
        if (!owner || !window || window.isDestroyed() || window.webContents !== owner || !isBrowserEmbedder(owner)) {
            throw new BrowserHostError('no-window', 'Canvas window is unavailable.');
        }
        const src = extensionCanvasUrl(request.url);
        if (!src || typeof request.extensionKey !== 'string' || !request.extensionKey.trim()
            || request.extensionKey.length > 1024 || /[\u0000-\u001f]/.test(request.extensionKey)) {
            throw new BrowserHostError('invalid', 'Invalid canvas extension source.');
        }
        const profile = this.profile(request.extensionKey);
        const entry: Entry = {
            closed: false,
            closeOwner: () => { if (!entry.closed) { entry.close(); sink.closed(); } },
            close: () => {
                if (entry.closed) return;
                entry.closed = true;
                this.entries.delete(entry);
                owner.removeListener('destroyed', entry.closeOwner);
                owner.removeListener('did-start-navigation', ownerNavigation);
                entry.authorization?.dispose();
                if (entry.contents && !entry.contents.isDestroyed()) entry.contents.close();
            },
        };
        const ownerNavigation = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean) => {
            if (mainFrame && !inPlace) entry.closeOwner();
        };
        const state = (value: ExtensionCanvasGuestState) => { if (!entry.closed) sink.state(value); };
        const external = (url: string) => {
            void shell.openExternal(url).catch((error: unknown) => {
                state({ status: 'failed', error: `Cannot open external link: ${error instanceof Error ? error.message : String(error)}` });
            });
        };
        entry.authorization = authorizeBrowserWebview(owner.id, src, profile, guest => {
            entry.contents = guest;
            const guard = (event: Electron.Event, url: string) => {
                const decision = classifyExtensionCanvasNavigation(url, src);
                if (decision === 'allow') return;
                event.preventDefault();
                if (decision === 'external') external(url);
            };
            guest.on('will-navigate', guard);
            guest.on('will-redirect', guard);
            guest.setWindowOpenHandler(({ url }) => {
                if (classifyExtensionCanvasNavigation(url, src) !== 'deny') external(url);
                return { action: 'deny' };
            });
            let failed = false;
            guest.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
                if (mainFrame && !inPlace) { failed = false; state({ status: 'loading' }); }
            });
            guest.on('did-start-loading', () => { if (!failed) state({ status: 'loading' }); });
            guest.on('did-stop-loading', () => { if (!failed) state({ status: 'loaded' }); });
            guest.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
                if (!mainFrame || code === -3) return;
                failed = true;
                state({ status: 'failed', error: description || `Load failed (${code})` });
            });
            guest.on('render-process-gone', (_event, details) => {
                failed = true;
                state({ status: 'failed', error: `Canvas page crashed (${details.reason})` });
            });
            guest.once('destroyed', () => { if (!entry.closed) entry.closeOwner(); });
        }, entry.closeOwner);
        this.entries.add(entry);
        owner.once('destroyed', entry.closeOwner);
        owner.on('did-start-navigation', ownerNavigation);
        return {
            embed: 'webview', src, partition: entry.authorization.partition,
            adopt: guestId => {
                if (entry.closed || !isBrowserEmbedder(owner)) {
                    throw new BrowserHostError('not-found', 'Canvas guest is closed.');
                }
                entry.authorization!.adopt(guestId);
            },
            close: entry.close,
        };
    }

    private profile(extensionKey: string): Electron.Session {
        const existing = this.profiles.get(extensionKey);
        if (existing) return existing;
        const key = createHash('sha256').update(extensionKey).digest('hex');
        const profile = session.fromPartition(`coc-canvas-extension-${key}`);
        profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        profile.setPermissionCheckHandler(() => false);
        profile.on('will-download', event => event.preventDefault());
        // Enforce origin before network dispatch, including initial loads and every redirect.
        profile.webRequest.onBeforeRequest((details, callback) => {
            if (details.resourceType !== 'mainFrame') { callback({ cancel: false }); return; }
            const entry = [...this.entries].find(value => value.contents?.id === details.webContentsId);
            callback({ cancel: !entry || !entry.authorization
                || classifyExtensionCanvasNavigation(details.url, entry.authorization.src) !== 'allow' });
        });
        this.profiles.set(extensionKey, profile);
        return profile;
    }

    dispose(): void {
        this.disposed = true;
        for (const entry of [...this.entries]) entry.close();
        for (const profile of this.profiles.values()) profile.webRequest.onBeforeRequest(null);
        this.profiles.clear();
    }
}
