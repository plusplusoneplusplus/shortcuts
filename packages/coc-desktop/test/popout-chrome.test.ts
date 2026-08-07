/**
 * Tests for the pop-out address bar's pure logic: the `window.open` allow-list,
 * the typed-URL navigation policy, the two-view layout math, and the chrome
 * bar's page script driven against a DOM stub (same technique as
 * find-in-page.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    CHROME_BAR_HEIGHT,
    POPOUT_COPY_URL_CHANNEL,
    POPOUT_NAVIGATE_CHANNEL,
    POPOUT_NAV_CHANNEL,
    POPOUT_OPEN_EXTERNAL_CHANNEL,
    POPOUT_STATE_CHANNEL,
    buildChromeBarHtml,
    buildChromeBarPageScript,
    buildPopOutShortcutScript,
    formatDisplayUrl,
    isPopOutChildUrl,
    layoutPopOutViews,
    parsePopOutWindowSize,
    resolveTypedUrl,
} from '../src/popout-chrome';

const appUrl = 'http://127.0.0.1:51234';

describe('IPC channel names', () => {
    it('are namespaced and distinct', () => {
        const channels = [
            POPOUT_NAV_CHANNEL,
            POPOUT_NAVIGATE_CHANNEL,
            POPOUT_OPEN_EXTERNAL_CHANNEL,
            POPOUT_COPY_URL_CHANNEL,
            POPOUT_STATE_CHANNEL,
        ];
        expect(new Set(channels).size).toBe(channels.length);
        for (const channel of channels) {
            expect(channel.startsWith('coc-desktop:popout-')).toBe(true);
        }
    });
});

describe('isPopOutChildUrl', () => {
    it('accepts every same-origin #popout/ route family', () => {
        for (const hash of [
            '#popout/markdown',
            '#popout/activity/task-1',
            '#popout/git-review/abc123',
            '#popout/git-review/pr/42',
            '#popout/canvas',
        ]) {
            expect(isPopOutChildUrl(`${appUrl}/?workspace=ws-1${hash}`, appUrl)).toBe(true);
        }
    });

    it('accepts the same-origin PDF shapes the plain-window path used to handle', () => {
        expect(isPopOutChildUrl(`${appUrl}/files/report.PDF`, appUrl)).toBe(true);
        expect(
            isPopOutChildUrl(
                `${appUrl}/api/workspaces/ws-1/notes/image?path=.attachments%2Freport.pdf`,
                appUrl,
            ),
        ).toBe(true);
    });

    it('leaves the handle-dependent call sites on the existing allow path', () => {
        // Print preview: window.open('', '_blank') then document.write(...).
        expect(isPopOutChildUrl('', appUrl)).toBe(false);
        expect(isPopOutChildUrl('about:blank', appUrl)).toBe(false);
        // Teams auth popup: cross-origin, needs the opener relationship.
        expect(isPopOutChildUrl('https://login.microsoftonline.com/x#popout/markdown', appUrl))
            .toBe(false);
        // Locked scope windows carry no #popout hash at all.
        expect(isPopOutChildUrl(`${appUrl}/?window=ws-1`, appUrl)).toBe(false);
    });

    it('rejects data:, relative, malformed and near-miss hashes', () => {
        expect(isPopOutChildUrl('data:text/html,<p>hi', appUrl)).toBe(false);
        expect(isPopOutChildUrl('/?workspace=ws-1#popout/canvas', appUrl)).toBe(false);
        expect(isPopOutChildUrl('not a url', appUrl)).toBe(false);
        expect(isPopOutChildUrl(`${appUrl}/#popouts/markdown`, appUrl)).toBe(false);
        expect(isPopOutChildUrl(`${appUrl}/#chat/popout/markdown`, appUrl)).toBe(false);
        expect(isPopOutChildUrl(`${appUrl}/#popout/canvas`, 'not a url')).toBe(false);
    });
});

describe('resolveTypedUrl', () => {
    it('keeps same-origin input inside the page view', () => {
        expect(resolveTypedUrl(`${appUrl}/#popout/canvas`, appUrl))
            .toEqual({ kind: 'internal', url: `${appUrl}/#popout/canvas` });
        // A bare path resolves against the app origin.
        expect(resolveTypedUrl('/?workspace=ws-1#popout/canvas', appUrl))
            .toEqual({ kind: 'internal', url: `${appUrl}/?workspace=ws-1#popout/canvas` });
        // Surrounding whitespace (a pasted URL) is tolerated.
        expect(resolveTypedUrl(`  ${appUrl}/logs  `, appUrl))
            .toEqual({ kind: 'internal', url: `${appUrl}/logs` });
    });

    it('routes any other http(s) origin to the system browser', () => {
        expect(resolveTypedUrl('https://example.com/docs', appUrl))
            .toEqual({ kind: 'external', url: 'https://example.com/docs' });
        // Bare host/path gets https://.
        expect(resolveTypedUrl('example.com/docs', appUrl))
            .toEqual({ kind: 'external', url: 'https://example.com/docs' });
        // A different port on the same host is still a different origin.
        expect(resolveTypedUrl('http://127.0.0.1:9999/', appUrl))
            .toEqual({ kind: 'external', url: 'http://127.0.0.1:9999/' });
    });

    it('reads host:port input as a host, not as a scheme', () => {
        expect(resolveTypedUrl('localhost:3000/app', appUrl))
            .toEqual({ kind: 'external', url: 'https://localhost:3000/app' });
    });

    it('rejects empty input and every non-http(s) scheme', () => {
        for (const input of [
            '',
            '   ',
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'file:///etc/passwd',
            'data:text/html,<script>x</script>',
            'mailto:a@b.com',
            'chrome://settings',
        ]) {
            expect(resolveTypedUrl(input, appUrl), input).toEqual({ kind: 'invalid' });
        }
    });

    it('rejects input when the app origin itself is unusable', () => {
        expect(resolveTypedUrl('/logs', 'not a url')).toEqual({ kind: 'invalid' });
    });
});

describe('formatDisplayUrl', () => {
    it('shows the full URL without truncation', () => {
        const long = `${appUrl}/?workspace=ws-1&filePath=${'a'.repeat(200)}#popout/markdown`;
        expect(formatDisplayUrl(long)).toBe(long);
    });

    it('renders empty and about:blank as an empty field', () => {
        expect(formatDisplayUrl('')).toBe('');
        expect(formatDisplayUrl('about:blank')).toBe('');
    });
});

describe('layoutPopOutViews', () => {
    it('pins the chrome strip on top and gives the page the remainder', () => {
        expect(layoutPopOutViews(900, 740)).toEqual({
            chrome: { x: 0, y: 0, width: 900, height: CHROME_BAR_HEIGHT },
            page: { x: 0, y: CHROME_BAR_HEIGHT, width: 900, height: 740 - CHROME_BAR_HEIGHT },
        });
    });

    it('never gives the page a negative height in a very short window', () => {
        const layout = layoutPopOutViews(400, 20);
        expect(layout.chrome).toEqual({ x: 0, y: 0, width: 400, height: 20 });
        expect(layout.page).toEqual({ x: 0, y: 20, width: 400, height: 0 });
        expect(layoutPopOutViews(-10, -10).page.height).toBe(0);
    });
});

describe('parsePopOutWindowSize', () => {
    it('grows the requested height by the chrome strip so the page keeps its size', () => {
        expect(parsePopOutWindowSize('width=900,height=700'))
            .toEqual({ width: 900, height: 700 + CHROME_BAR_HEIGHT });
        expect(parsePopOutWindowSize('width=1200,height=800'))
            .toEqual({ width: 1200, height: 800 + CHROME_BAR_HEIGHT });
    });

    it('falls back to defaults and enforces a floor', () => {
        expect(parsePopOutWindowSize(undefined))
            .toEqual({ width: 900, height: 700 + CHROME_BAR_HEIGHT });
        expect(parsePopOutWindowSize('noopener,noreferrer'))
            .toEqual({ width: 900, height: 700 + CHROME_BAR_HEIGHT });
        expect(parsePopOutWindowSize('width=1,height=1'))
            .toEqual({ width: 320, height: 240 + CHROME_BAR_HEIGHT });
    });

    it('does not match a key that merely ends in width/height', () => {
        expect(parsePopOutWindowSize('innerwidth=50,height=600'))
            .toEqual({ width: 900, height: 600 + CHROME_BAR_HEIGHT });
    });
});

// ─── Chrome bar page script, driven against a DOM stub ──────────────────────

interface StubElement {
    id: string;
    value: string;
    textContent: string;
    title: string;
    disabled: boolean;
    listeners: Record<string, ((e: any) => void)[]>;
    addEventListener(type: string, fn: (e: any) => void): void;
    setAttribute(name: string, value: string): void;
    focus(): void;
    select(): void;
    fire(type: string, event?: any): void;
}

function stubElement(id: string): StubElement {
    return {
        id,
        value: '',
        textContent: '',
        title: '',
        disabled: false,
        listeners: {},
        addEventListener(type, fn) {
            (this.listeners[type] ||= []).push(fn);
        },
        setAttribute() { /* attributes are not asserted */ },
        focus: vi.fn(),
        select: vi.fn(),
        fire(type, event = {}) {
            for (const fn of this.listeners[type] ?? []) {
                fn(event);
            }
        },
    };
}

function keyEvent(key: string, extra: Record<string, unknown> = {}) {
    return { key, preventDefault: vi.fn(), defaultPrevented: false, ...extra };
}

/** Run the bar script against a stub DOM + a stub `cocDesktop.popout` bridge. */
function runBarScript() {
    const els: Record<string, StubElement> = {};
    for (const id of [
        'popout-back', 'popout-forward', 'popout-reload',
        'popout-url', 'popout-copy', 'popout-external',
    ]) {
        els[id] = stubElement(id);
    }
    const api = {
        nav: vi.fn(),
        navigate: vi.fn(),
        openExternal: vi.fn(),
        copyUrl: vi.fn(),
        onState: vi.fn(),
    };
    const win: Record<string, unknown> = { cocDesktop: { popout: api } };
    const document = { getElementById: (id: string) => els[id] ?? null };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', buildChromeBarPageScript())(win, document);
    const pushState = api.onState.mock.calls[0][0] as (s: unknown) => void;
    return { els, api, win, pushState };
}

describe('buildChromeBarPageScript', () => {
    it('renders a pushed state into the buttons and the address field', () => {
        const { els, pushState } = runBarScript();
        pushState({ url: `${appUrl}/#popout/canvas`, canGoBack: true, canGoForward: false, loading: false });
        expect(els['popout-url'].value).toBe(`${appUrl}/#popout/canvas`);
        expect(els['popout-back'].disabled).toBe(false);
        expect(els['popout-forward'].disabled).toBe(true);
        expect(els['popout-reload'].title).toBe('Reload (Ctrl+R)');
    });

    it('turns the reload button into a stop button while loading', () => {
        const { els, api, pushState } = runBarScript();
        pushState({ url: appUrl, canGoBack: false, canGoForward: false, loading: true });
        expect(els['popout-reload'].title).toBe('Stop loading');
        els['popout-reload'].fire('click');
        expect(api.nav).toHaveBeenCalledWith('stop');

        pushState({ url: appUrl, canGoBack: false, canGoForward: false, loading: false });
        els['popout-reload'].fire('click');
        expect(api.nav).toHaveBeenLastCalledWith('reload');
    });

    it('wires back / forward / copy / open-external to the bridge', () => {
        const { els, api } = runBarScript();
        els['popout-back'].fire('click');
        expect(api.nav).toHaveBeenCalledWith('back');
        els['popout-forward'].fire('click');
        expect(api.nav).toHaveBeenCalledWith('forward');
        els['popout-copy'].fire('click');
        expect(api.copyUrl).toHaveBeenCalledOnce();
        els['popout-external'].fire('click');
        expect(api.openExternal).toHaveBeenCalledOnce();
    });

    it('commits the typed value on Enter', () => {
        const { els, api, pushState } = runBarScript();
        pushState({ url: appUrl, canGoBack: false, canGoForward: false, loading: false });
        const input = els['popout-url'];
        input.fire('focus');
        input.value = 'example.com';
        input.fire('keydown', keyEvent('Enter'));
        expect(api.navigate).toHaveBeenCalledWith('example.com');
    });

    it('never clobbers the field while the user is typing in it', () => {
        const { els, pushState } = runBarScript();
        const input = els['popout-url'];
        input.fire('focus');
        input.value = 'half-typed';
        pushState({ url: `${appUrl}/moved`, canGoBack: true, canGoForward: false, loading: false });
        expect(input.value).toBe('half-typed');
        // Blur reverts to the live URL.
        input.fire('blur');
        expect(input.value).toBe(`${appUrl}/moved`);
    });

    it('Esc reverts the field and hands focus back to the page', () => {
        const { els, api, pushState } = runBarScript();
        pushState({ url: `${appUrl}/live`, canGoBack: false, canGoForward: false, loading: false });
        const input = els['popout-url'];
        input.fire('focus');
        input.value = 'typed-but-abandoned';
        input.fire('keydown', keyEvent('Escape'));
        expect(input.value).toBe(`${appUrl}/live`);
        expect(api.nav).toHaveBeenCalledWith('focus-page');
        expect(api.navigate).not.toHaveBeenCalled();
    });

    it('Cmd/Ctrl+L inside the bar reselects, and the main process can focus it', () => {
        const { els, win } = runBarScript();
        const input = els['popout-url'];
        input.fire('keydown', keyEvent('l', { ctrlKey: true }));
        expect(input.select).toHaveBeenCalledOnce();
        (win.__cocPopOutFocusUrl as () => void)();
        expect(input.focus).toHaveBeenCalled();
        expect(input.select).toHaveBeenCalledTimes(2);
    });

    it('bails out harmlessly when the preload bridge is missing', () => {
        const document = { getElementById: () => null };
        expect(() =>
            // eslint-disable-next-line no-new-func
            new Function('window', 'document', buildChromeBarPageScript())({}, document),
        ).not.toThrow();
    });
});

describe('buildPopOutShortcutScript', () => {
    /** Drive the page-side shortcut script against a stub window. */
    function runShortcutScript(preinstalled = false) {
        const nav = vi.fn();
        const listeners: ((e: any) => void)[] = [];
        const win: Record<string, unknown> = {
            __cocPopOutShortcutsInstalled: preinstalled || undefined,
            cocDesktop: { popout: { nav } },
            addEventListener: (type: string, fn: (e: any) => void) => {
                if (type === 'keydown') listeners.push(fn);
            },
        };
        // eslint-disable-next-line no-new-func
        new Function('window', buildPopOutShortcutScript())(win);
        return { nav, listeners, win, press: (e: any) => listeners.forEach((fn) => fn(e)) };
    }

    it('maps Alt+arrows, Ctrl+R and Ctrl+L onto nav commands', () => {
        const { nav, press } = runShortcutScript();
        press(keyEvent('ArrowLeft', { altKey: true }));
        expect(nav).toHaveBeenCalledWith('back');
        press(keyEvent('ArrowRight', { altKey: true }));
        expect(nav).toHaveBeenCalledWith('forward');
        press(keyEvent('r', { metaKey: true }));
        expect(nav).toHaveBeenCalledWith('reload');
        press(keyEvent('l', { ctrlKey: true }));
        expect(nav).toHaveBeenCalledWith('focus-bar');
    });

    it('yields to a page that already handled the key', () => {
        const { nav, press } = runShortcutScript();
        press({ ...keyEvent('r', { ctrlKey: true }), defaultPrevented: true });
        expect(nav).not.toHaveBeenCalled();
    });

    it('is idempotent so re-injection on every load is a no-op', () => {
        const { listeners } = runShortcutScript(true);
        expect(listeners).toHaveLength(0);
    });
});

describe('buildChromeBarHtml', () => {
    it('embeds every element the page script looks up', () => {
        const html = buildChromeBarHtml();
        for (const id of [
            'popout-back', 'popout-forward', 'popout-reload',
            'popout-url', 'popout-copy', 'popout-external',
        ]) {
            expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('<script>');
    });

    it('pads the strip clear of the macOS traffic lights only when asked', () => {
        expect(buildChromeBarHtml({ macInset: true })).toContain('padding: 0 8px 0 88px');
        expect(buildChromeBarHtml()).toContain('padding: 0 8px 0 8px');
    });
});
