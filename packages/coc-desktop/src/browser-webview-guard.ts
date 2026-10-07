import { app, webContents, type BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { BrowserHostError } from './browser-host-contract';
import { sanitizeWebviewAttach } from './browser-view-policy';
import { htmlPageFileUrl, validateHtmlPagePath } from './html-page-policy';

const ATTACH_TTL_MS = 30_000;
interface Authorization {
    ownerId: number;
    src: string;
    fileSrc?: string;
    partition: string;
    session: Electron.Session;
    attached?: WebContents;
    attaching: boolean;
    adopted: boolean;
    timer: ReturnType<typeof setTimeout>;
    attach(guest: WebContents): void;
    expired(): void;
}

const trusted = new Map<number, { window: BrowserWindow; url: string }>();
const pending = new Map<string, Authorization>();
const creating = new Map<number, Authorization>();
let installed = false;

/** Only the exact served SPA document (hash routing permitted), never a same-origin arbitrary page. */
export function isBrowserEmbedder(contents: WebContents): boolean {
    const owner = trusted.get(contents.id);
    if (!owner || owner.window.isDestroyed() || owner.window.webContents !== contents) { return false; }
    return contents.getURL().split('#')[0] === owner.url;
}

export function registerBrowserEmbedder(window: BrowserWindow, url: string): void {
    installBrowserWebviewGuard();
    trusted.set(window.webContents.id, { window, url: new URL(url).href.split('#')[0] });
    const id = window.webContents.id;
    window.once('closed', () => trusted.delete(id));
}

function guardContents(contents: WebContents): void {
    contents.on('will-attach-webview', (event, preferences, params) => {
        const authorization = pending.get(params.partition);
        if (!authorization || authorization.ownerId !== contents.id || authorization.attaching || creating.has(contents.id)
            || !isBrowserEmbedder(contents) || params.src !== authorization.src
            || !sanitizeWebviewAttach(preferences, params, authorization.session, authorization.fileSrc)) {
            event.preventDefault();
            return;
        }
        authorization.attaching = true;
        // Electron synchronously creates the guest after this event. Bind at creation,
        // before its initial navigation, not at the later renderer adoption IPC.
        creating.set(contents.id, authorization);
    });
    contents.on('did-attach-webview', (_event, guest) => {
        const authorization = [...pending.values()].find(value => value.attached === guest);
        if (!authorization || authorization.ownerId !== contents.id || !isBrowserEmbedder(contents)) {
            guest.close();
        }
    });
}

/** Install before creating any window; every unregistered embedder defaults to denial. */
export function installBrowserWebviewGuard(): void {
    if (installed) { return; }
    installed = true;
    for (const contents of webContents.getAllWebContents()) { guardContents(contents); }
    app.on('web-contents-created', (_event, contents) => {
        guardContents(contents);
        if (contents.getType() !== 'webview') { return; }
        const ownerId = contents.hostWebContents?.id;
        const authorization = ownerId === undefined ? undefined : creating.get(ownerId);
        if (!authorization || !contents.hostWebContents || !isBrowserEmbedder(contents.hostWebContents)
            || contents.session !== authorization.session) {
            // Defer destruction until Electron has finished constructing its guest.
            setImmediate(() => { if (!contents.isDestroyed()) { contents.close(); } });
            return;
        }
        creating.delete(authorization.ownerId);
        authorization.attached = contents;
        authorization.attach(contents);
    });
}

export function authorizeBrowserWebview(
    ownerId: number, src: string, profile: Electron.Session,
    attach: (guest: WebContents) => void, expired: () => void,
    /** Main-only capability: supplied by the file host, never derived from renderer attributes. */
    authorizedFilePath?: string,
): { embed: 'webview'; src: string; partition: string; adopt(guestId: number): void; dispose(): void } {
    let fileSrc: string | undefined;
    if (authorizedFilePath !== undefined) {
        const checked = validateHtmlPagePath(authorizedFilePath);
        if (!checked.ok) { throw new BrowserHostError(checked.reason, 'Preview file is unavailable.'); }
        fileSrc = htmlPageFileUrl(checked.path);
        if (src !== fileSrc) { throw new BrowserHostError('invalid', 'Preview source does not match the authorized file.'); }
    }
    const partition = `coc-browser-${randomUUID()}`;
    const dispose = () => {
        clearTimeout(authorization.timer);
        pending.delete(partition);
        if (creating.get(ownerId) === authorization) { creating.delete(ownerId); }
    };
    const authorization: Authorization = {
        ownerId, src, fileSrc, partition, session: profile, attaching: false, adopted: false, attach, expired,
        timer: setTimeout(() => { dispose(); expired(); }, ATTACH_TTL_MS),
    };
    authorization.timer.unref();
    pending.set(partition, authorization);
    return {
        embed: 'webview', src, partition,
        adopt(guestId) {
            if (!Number.isSafeInteger(guestId) || authorization.adopted || !authorization.attached || authorization.attached.id !== guestId
                || authorization.attached.hostWebContents?.id !== ownerId
                || authorization.attached.isDestroyed() || !pending.has(partition)) {
                throw new BrowserHostError('not-found', 'Browser guest does not belong to this view.');
            }
            authorization.adopted = true;
            clearTimeout(authorization.timer);
            // Retain the consumed token until close; reattachment is never authorized.
        },
        dispose,
    };
}
