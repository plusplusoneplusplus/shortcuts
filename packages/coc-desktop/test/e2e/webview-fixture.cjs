'use strict';

/** A stand-in renderer: keeps guest DOM nodes mounted, including while inactive. */
function installWebviewFixture() {
    const browser = window.cocDesktop.browser;
    const views = new Map();
    window.__webviews = views;
    window.__browser = {
        ...browser,
        async open(...args) {
            const result = await browser.open(...args);
            const id = args[0];
            if (!result.ok || result.embed !== 'webview' || views.has(id)) return result;
            const guest = document.createElement('webview');
            guest.dataset.viewId = id;
            guest.style.cssText = 'position:absolute;left:350px;top:70px;width:420px;height:320px;display:flex';
            guest.setAttribute('partition', result.partition);
            guest.setAttribute('src', result.src);
            const adopted = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Guest adoption timed out: ' + id)), 5000);
                let adopting = false;
                const adopt = async () => {
                    if (adopting) return;
                    let guestId;
                    try { guestId = guest.getWebContentsId(); } catch { return; }
                    if (!guestId) return;
                    adopting = true;
                    const adoption = await browser.adopt(id, guestId);
                    clearTimeout(timer);
                    if (adoption.ok) resolve();
                    else reject(new Error('Guest adoption rejected: ' + JSON.stringify(adoption)));
                };
                guest.addEventListener('did-attach', adopt);
                guest.addEventListener('dom-ready', adopt);
            });
            views.set(id, guest);
            document.body.append(guest);
            await adopted;
            return result;
        },
        setBounds(id, rect) {
            const guest = views.get(id);
            if (guest) {
                guest.style.visibility = rect ? 'visible' : 'hidden';
                guest.style.pointerEvents = rect ? 'auto' : 'none';
                if (rect) Object.assign(guest.style, {
                    left: rect.x + 'px', top: rect.y + 'px',
                    width: rect.width + 'px', height: rect.height + 'px',
                });
            }
            browser.setBounds(id, rect);
        },
        hide(id) { this.setBounds(id, null); },
        focus(id) { views.get(id)?.focus(); browser.focus(id); },
        close(id) {
            browser.close(id);
            views.get(id)?.remove();
            views.delete(id);
        },
    };
    browser.onClosed(({ viewId }) => {
        views.get(viewId)?.remove();
        views.delete(viewId);
    });
}

module.exports = { fixtureScript: `(${installWebviewFixture.toString()})()` };
