import { ipcMain, type WebContents } from 'electron';
import { ExtensionCanvasHost, type ExtensionCanvasGuest } from './extension-canvas-host';
import { isBrowserEmbedder } from './browser-webview-guard';
import { extensionCanvasUrl } from './extension-canvas-policy';

export const EXTENSION_CANVAS_OPEN_CHANNEL = 'coc-desktop:extension-canvas-open';
export const EXTENSION_CANVAS_ADOPT_CHANNEL = 'coc-desktop:extension-canvas-adopt';
export const EXTENSION_CANVAS_CLOSE_CHANNEL = 'coc-desktop:extension-canvas-close';
export const EXTENSION_CANVAS_STATE_CHANNEL = 'coc-desktop:extension-canvas-state';

interface View {
    controller: AbortController;
    guest?: ExtensionCanvasGuest;
}

interface Owner {
    contents: WebContents;
    views: Map<string, View>;
    navigation(event: Electron.Event, url: string, inPlace: boolean, mainFrame: boolean): void;
    crashed(): void;
    destroyed(): void;
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serverError(value: unknown, status: number): string {
    if (record(value)) {
        if (typeof value.error === 'string') return value.error;
        if (record(value.error) && typeof value.error.message === 'string') return value.error.message;
    }
    return `Canvas reopening failed (${status}).`;
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function validViewId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
}

let dispose: (() => void) | undefined;

/** Reopening is always performed against the desktop's server, never a renderer URL. */
export function registerExtensionCanvasIpc(serverUrl: () => string | undefined): void {
    if (dispose) return;
    const host = new ExtensionCanvasHost();
    const owners = new Map<number, Owner>();
    let disposed = false;
    const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
        const url = extensionCanvasUrl(serverUrl());
        return !!url && event.senderFrame === event.sender.mainFrame && isBrowserEmbedder(event.sender)
            && new URL(event.sender.getURL()).origin === new URL(url).origin;
    };
    const close = (owner: Owner, viewId: string) => {
        const view = owner.views.get(viewId);
        owner.views.delete(viewId);
        view?.controller.abort(new Error('Canvas view closed.'));
        view?.guest?.close();
    };
    const clear = (owner: Owner) => {
        for (const id of [...owner.views.keys()]) close(owner, id);
    };
    const ownerFor = (contents: WebContents): Owner => {
        const existing = owners.get(contents.id);
        if (existing) return existing;
        const owner: Owner = {
            contents, views: new Map(),
            navigation: (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) clear(owner); },
            crashed: () => clear(owner),
            destroyed: () => {
                clear(owner);
                contents.removeListener('did-start-navigation', owner.navigation);
                contents.removeListener('render-process-gone', owner.crashed);
                contents.removeListener('destroyed', owner.destroyed);
                owners.delete(contents.id);
            },
        };
        owners.set(contents.id, owner);
        contents.on('did-start-navigation', owner.navigation);
        contents.on('render-process-gone', owner.crashed);
        contents.once('destroyed', owner.destroyed);
        return owner;
    };
    ipcMain.handle(EXTENSION_CANVAS_OPEN_CHANNEL, async (event, viewId: unknown, workspaceId: unknown, canvasId: unknown) => {
        if (!trusted(event) || disposed) return { ok: false, message: 'A local CoC desktop window is required.' };
        if (!validViewId(viewId) || !validId(workspaceId) || !validId(canvasId)) {
            return { ok: false, message: 'Invalid canvas identity.' };
        }
        const owner = ownerFor(event.sender);
        close(owner, viewId);
        const view: View = { controller: new AbortController() };
        owner.views.set(viewId, view);
        const current = () => !disposed && !view.controller.signal.aborted
            && owner.views.get(viewId) === view && trusted(event);
        try {
            const base = extensionCanvasUrl(serverUrl())!;
            const response = await fetch(new URL(
                `/api/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(canvasId)}/copilot-extension/open`, base,
            ), {
                method: 'POST', redirect: 'error',
                signal: AbortSignal.any([view.controller.signal, AbortSignal.timeout(60_000)]),
            });
            const opened: unknown = await response.json();
            if (!current()) throw new Error('Canvas view closed during reopening.');
            if (!response.ok) throw new Error(serverError(opened, response.status));
            if (!record(opened) || opened.success !== true || opened.canvasId !== canvasId
                || typeof opened.extensionKey !== 'string' || typeof opened.url !== 'string'
                || typeof opened.title !== 'string') throw new Error('Invalid canvas reopening response.');
            view.guest = host.create({ ownerId: owner.contents.id, extensionKey: opened.extensionKey, url: opened.url }, {
                state: state => {
                    if (current()) owner.contents.send(EXTENSION_CANVAS_STATE_CHANNEL, { viewId, ...state });
                },
                closed: () => {
                    if (!current()) return;
                    owner.contents.send(EXTENSION_CANVAS_STATE_CHANNEL, { viewId, status: 'failed', error: 'Canvas guest closed.' });
                    close(owner, viewId);
                },
            });
            return {
                ok: true, embed: view.guest.embed, src: view.guest.src, partition: view.guest.partition, title: opened.title,
            };
        } catch (error) {
            // A superseded opener must not close the replacement view.
            if (owner.views.get(viewId) === view) close(owner, viewId);
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle(EXTENSION_CANVAS_ADOPT_CHANNEL, (event, viewId: unknown, guestId: unknown) => {
        if (!trusted(event) || !validViewId(viewId) || typeof guestId !== 'number' || !Number.isSafeInteger(guestId)) {
            throw new Error('Invalid canvas guest owner or identity.');
        }
        const guest = owners.get(event.sender.id)?.views.get(viewId)?.guest;
        if (!guest) throw new Error('Canvas guest is unavailable.');
        guest.adopt(guestId);
    });
    const closeListener = (event: Electron.IpcMainEvent, viewId: unknown) => {
        if (!trusted(event) || !validViewId(viewId)) return;
        const owner = owners.get(event.sender.id);
        if (owner) close(owner, viewId);
    };
    ipcMain.on(EXTENSION_CANVAS_CLOSE_CHANNEL, closeListener);
    dispose = () => {
        disposed = true;
        for (const owner of [...owners.values()]) owner.destroyed();
        host.dispose();
        ipcMain.removeHandler(EXTENSION_CANVAS_OPEN_CHANNEL);
        ipcMain.removeHandler(EXTENSION_CANVAS_ADOPT_CHANNEL);
        ipcMain.removeListener(EXTENSION_CANVAS_CLOSE_CHANNEL, closeListener);
        dispose = undefined;
    };
}

export function disposeExtensionCanvasIpc(): void {
    dispose?.();
}
