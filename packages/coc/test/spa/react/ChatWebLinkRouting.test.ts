/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OPEN_EVENT = 'coc-open-browser-url';

async function setup(html: string, options: { desktop?: boolean; panel?: boolean } = {}) {
    document.body.innerHTML = html;
    if (options.desktop !== false) {
        Object.defineProperty(window, 'cocDesktop', {
            value: { isDesktop: true, browser: { open: vi.fn() } },
            configurable: true,
        });
    }
    await import('../../../src/server/spa/client/react/shared/file-path/file-path-preview');
    const events: Array<{ url: string }> = [];
    const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ url: string; handled?: boolean }>).detail;
        if (options.panel !== false) detail.handled = true;
        events.push({ url: detail.url });
    };
    window.addEventListener(OPEN_EVENT, listener);
    const click = (init: MouseEventInit = {}) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        document.querySelector('a')!.dispatchEvent(event);
        return event;
    };
    return { events, click, dispose: () => window.removeEventListener(OPEN_EVENT, listener) };
}

describe('chat web link routing to the panel browser tab', () => {
    let dispose: (() => void) | undefined;

    beforeEach(() => {
        vi.resetModules();
        document.body.replaceWith(document.createElement('body'));
        delete (window as { __COC_FILE_PATH_PREVIEW_DELEGATION__?: boolean }).__COC_FILE_PATH_PREVIEW_DELEGATION__;
        delete (window as { cocDesktop?: unknown }).cocDesktop;
        localStorage.clear();
    });
    afterEach(() => {
        dispose?.();
        dispose = undefined;
        document.body.innerHTML = '';
        delete (window as { cocDesktop?: unknown }).cocDesktop;
    });

    const chatLink = (href: string) =>
        `<div class="chat-message assistant"><a href="${href}" target="_blank">link</a></div>`;

    it('sends a plain click on a chat https link to the panel and stops the default', async () => {
        const ctx = await setup(chatLink('https://google.com/'));
        dispose = ctx.dispose;
        const event = ctx.click();
        expect(ctx.events).toEqual([{ url: 'https://google.com/' }]);
        expect(event.defaultPrevented).toBe(true);
    });

    it('keeps the default when no panel takes the link', async () => {
        const ctx = await setup(chatLink('https://google.com/'), { panel: false });
        dispose = ctx.dispose;
        const event = ctx.click();
        expect(ctx.events).toHaveLength(1);
        expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing outside the desktop app', async () => {
        const ctx = await setup(chatLink('https://google.com/'), { desktop: false });
        dispose = ctx.dispose;
        const event = ctx.click();
        expect(ctx.events).toHaveLength(0);
        expect(event.defaultPrevented).toBe(false);
    });

    it('leaves modifier clicks, link-handler URLs, and non-chat links alone', async () => {
        const ctx = await setup(chatLink('https://example.com/'));
        dispose = ctx.dispose;
        ctx.click({ ctrlKey: true });
        ctx.click({ metaKey: true });
        ctx.click({ shiftKey: true });
        expect(ctx.events).toHaveLength(0);

        document.body.innerHTML = chatLink('https://teams.microsoft.com/l/chat/1');
        const teamsLink = document.querySelector('a')!;
        // The Teams link handler owns this URL; stop jsdom from navigating.
        teamsLink.addEventListener('click', e => e.preventDefault());
        teamsLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(ctx.events).toHaveLength(0);

        document.body.innerHTML = '<div><a href="https://example.com/">outside chat</a></div>';
        ctx.click();
        expect(ctx.events).toHaveLength(0);
    });
});
