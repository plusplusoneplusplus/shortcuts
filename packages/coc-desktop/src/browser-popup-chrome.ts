import { BrowserWindow, ipcMain, View, WebContentsView, type IpcMainEvent, type WebContents } from 'electron';
import { join } from 'node:path';

/** A separate sandboxed, main-owned surface. The browser page has no bridge to it. */
export function browserPopupChrome(window: BrowserWindow, stop: (turnId: string) => void) {
    let toolbar: WebContentsView | undefined;
    let chromeContents: WebContents | undefined;
    let turnId: string | null = null;
    let loadedTurn: string | null = null;
    let loadingTurn: string | null = null;
    let revision = 0;
    let listening = false;
    let chromeUrl = '';
    const requestStop = (event: IpcMainEvent, token: unknown) => {
        if (chromeContents && !chromeContents.isDestroyed() && event.sender === chromeContents
            && event.senderFrame === event.sender.mainFrame && event.sender.getURL() === chromeUrl
            && turnId && loadedTurn === turnId && token === turnId) stop(turnId);
    };
    let page: View | undefined;
    const layout = () => {
        if (window.isDestroyed()) return;
        const [width, height] = window.getContentSize();
        const top = turnId ? 40 : 0;
        page?.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
        toolbar?.setBounds({ x: 0, y: 0, width, height: top });
        toolbar?.setVisible(!!turnId && loadedTurn === turnId);
    };
    window.on('resize', layout);
    window.once('closed', () => {
        turnId = null;
        loadingTurn = null;
        ++revision;
        if (listening) ipcMain.removeListener('coc-desktop:browser-popup-stop', requestStop);
        if (chromeContents && !chromeContents.isDestroyed()) chromeContents.close();
    });
    const setActive = (activeTurn: string | null) => {
        if (window.isDestroyed() || turnId === activeTurn && (!activeTurn || loadedTurn === activeTurn || loadingTurn === activeTurn)) return;
        turnId = activeTurn;
        loadedTurn = null;
        loadingTurn = activeTurn;
        const version = ++revision;
        if (activeTurn && !toolbar) {
            if (!page) {
                page = window.contentView;
                const container = new View();
                window.setContentView(container);
                container.addChildView(page);
            }
            toolbar = new WebContentsView({ webPreferences: {
                sandbox: true, contextIsolation: true, nodeIntegration: false,
                partition: 'coc-browser-control-chrome', webSecurity: true,
                preload: join(__dirname, 'browser-popup-preload.js'),
            } });
            window.contentView.addChildView(toolbar);
            const createdToolbar = toolbar;
            const contents = toolbar.webContents;
            chromeContents = contents;
            contents.setWindowOpenHandler(() => ({ action: 'deny' }));
            contents.on('will-navigate', event => event.preventDefault());
            if (!listening) {
                ipcMain.on('coc-desktop:browser-popup-stop', requestStop);
                listening = true;
            }
            const recover = () => {
                if (chromeContents !== contents || window.isDestroyed()) return;
                loadedTurn = null;
                loadingTurn = null;
                ++revision;
                if (turnId) setActive(turnId);
            };
            contents.on('render-process-gone', recover);
            contents.once('destroyed', () => {
                if (chromeContents !== contents) return;
                chromeContents = undefined;
                toolbar = undefined;
                loadedTurn = null;
                loadingTurn = null;
                ++revision;
                if (!window.isDestroyed()) {
                    window.contentView.removeChildView(createdToolbar);
                    if (turnId) setActive(turnId);
                }
            });
        }
        if (activeTurn && chromeContents) {
            const token = JSON.stringify(activeTurn).replace(/</g, '\\u003c');
            const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>body{margin:0;padding:6px 12px;background:#f6f8fa;font:14px system-ui;display:flex;align-items:center;gap:12px}span{color:#0969da}button{font:inherit;color:#24292f;background:white;border:1px solid #8c959f;border-radius:5px;padding:3px 12px}button:focus{outline:2px solid #0969da}</style><span role="status">AI controlling</span><button id="stop" aria-label="Stop AI browser control">Stop</button><script>document.getElementById('stop').addEventListener('click',()=>window.cocBrowserChrome.stop(${token}));</script>`;
            chromeUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
            void chromeContents.loadURL(chromeUrl).then(() => {
                if (version === revision) { loadedTurn = activeTurn; loadingTurn = null; layout(); }
            }, error => {
                if (version !== revision || window.isDestroyed()) return;
                console.error('[coc-desktop] Browser control chrome could not load:', error);
                turnId = null;
                loadedTurn = null;
                loadingTurn = null;
                ++revision;
                layout();
                stop(activeTurn);
            });
        }
        layout();
    };
    return setActive;
}
