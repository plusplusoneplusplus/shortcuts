/**
 * Unit tests for the native menu templates.
 *
 * `app-menu.ts` is electron-free (its only electron reference is an erased
 * type-only import), so the template *shape* — item order, separators, which
 * click handler is wired where — is asserted here under plain Node, with no
 * Electron runtime. The electron wiring (`Menu.setApplicationMenu`,
 * `Menu.buildFromTemplate`, `tray.setContextMenu`) lives in `main.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import {
    buildAppMenuTemplate,
    buildTrayMenuTemplate,
    buildDevTunnelMenu,
    devTunnelStatusLabel,
    devTunnelPublicUrlLabel,
    DEV_TUNNEL_URL_LABEL_MAX,
    DEV_TUNNEL_EXPECTED_URL_SUFFIX,
    CHECK_FOR_UPDATES_LABEL,
    UPDATE_CHANNEL_LABEL,
    REPORT_ISSUE_LABEL,
    DEV_TUNNEL_MENU_LABEL,
    DEV_TUNNEL_CONFIGURE_LABEL,
    DEV_TUNNEL_START_LABEL,
    DEV_TUNNEL_STOP_LABEL,
    DEV_TUNNEL_RETRY_LABEL,
    DEV_TUNNEL_SHOW_ERROR_LABEL,
    DEV_TUNNEL_COPY_URL_LABEL,
    DEBUG_MENU_LABEL,
    OPEN_LOGS_VIEWER_LABEL,
    REVEAL_LOG_FILES_LABEL,
    TOGGLE_DEVTOOLS_LABEL,
    buildDebugMenu,
    buildEditMenu,
    EDIT_MENU_LABEL,
    EDIT_COPY_LABEL,
    type DebugMenuHandlers,
    type DevTunnelMenuHandlers,
    type DevTunnelMenuInput,
} from '../src/app-menu';
import type { DevTunnelHostState } from '../src/devtunnel-host';
import type { ElevationState } from '../src/elevation';

type Item = MenuItemConstructorOptions;

/** The app submenu (first entry on macOS, the Help menu on Windows). */
function submenuOf(item: Item): Item[] {
    expect(Array.isArray(item.submenu)).toBe(true);
    return item.submenu as Item[];
}

const labelIdx = (items: Item[], label: string): number =>
    items.findIndex((i) => i.label === label);
const roleIdx = (items: Item[], role: string): number =>
    items.findIndex((i) => i.role === role);
const isSeparator = (item: Item | undefined): boolean => item?.type === 'separator';

describe('buildAppMenuTemplate — macOS', () => {
    const handlers = { onCheckForUpdates: vi.fn() };
    const template = buildAppMenuTemplate('darwin', 'CoC', handlers);
    const appSubmenu = submenuOf(template[0]);

    it('puts the app submenu first, labelled with the app name', () => {
        expect(template[0].label).toBe('CoC');
    });

    it('places "Check for Updates…" directly after "About CoC" across a separator', () => {
        const aboutIdx = labelIdx(appSubmenu, 'About CoC');
        const checkIdx = labelIdx(appSubmenu, CHECK_FOR_UPDATES_LABEL);
        expect(aboutIdx).toBeGreaterThanOrEqual(0);
        expect(checkIdx).toBe(aboutIdx + 2); // about, separator, check
        expect(isSeparator(appSubmenu[aboutIdx + 1])).toBe(true);
        // The About item shows the branded About panel.
        expect(appSubmenu[aboutIdx].role).toBe('about');
    });

    it('places "Update Channel" directly after "Check for Updates…"', () => {
        const checkIdx = labelIdx(appSubmenu, CHECK_FOR_UPDATES_LABEL);
        const channelIdx = labelIdx(appSubmenu, UPDATE_CHANNEL_LABEL);
        expect(channelIdx).toBe(checkIdx + 1);
    });

    it('separates the update items from the hide/quit cluster with a separator', () => {
        const channelIdx = labelIdx(appSubmenu, UPDATE_CHANNEL_LABEL);
        expect(isSeparator(appSubmenu[channelIdx + 1])).toBe(true);
        const hideIdx = roleIdx(appSubmenu, 'hide');
        const quitIdx = roleIdx(appSubmenu, 'quit');
        expect(hideIdx).toBeGreaterThan(channelIdx);
        expect(quitIdx).toBeGreaterThan(hideIdx);
    });

    it('preserves the default cluster items (services, hide, quit)', () => {
        for (const role of ['services', 'hide', 'quit']) {
            expect(roleIdx(appSubmenu, role)).toBeGreaterThanOrEqual(0);
        }
    });

    it('preserves the standard Edit/View/Window menus', () => {
        const roles = template.map((i) => i.role);
        // Edit is no longer a role — it is expanded so Copy can be customized.
        expect(template.map((i) => i.label)).toContain(EDIT_MENU_LABEL);
        expect(roles).toContain('viewMenu');
        expect(roles).toContain('windowMenu');
    });

    it('wires the Check-for-Updates click to the provided handler (AC-02)', () => {
        const check = appSubmenu.find((i) => i.label === CHECK_FOR_UPDATES_LABEL)!;
        expect(typeof check.click).toBe('function');
        (check.click as () => void)();
        expect(handlers.onCheckForUpdates).toHaveBeenCalledTimes(1);
    });
});

describe('buildAppMenuTemplate — Update Channel submenu', () => {
    it('shows "Stable" checked and "Prerelease" unchecked when channel is stable', () => {
        const onSetUpdateChannel = vi.fn();
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
            currentChannel: 'stable',
            onSetUpdateChannel,
        });
        const appSubmenu = submenuOf(template[0]);
        const channelItem = appSubmenu.find((i) => i.label === UPDATE_CHANNEL_LABEL)!;
        const sub = submenuOf(channelItem);
        const stableItem = sub.find((i) => i.label === 'Stable')!;
        const preItem = sub.find((i) => i.label === 'Prerelease')!;
        expect(stableItem.checked).toBe(true);
        expect(preItem.checked).toBe(false);
        expect(stableItem.type).toBe('radio');
        expect(preItem.type).toBe('radio');
    });

    it('shows "Prerelease" checked when channel is prerelease', () => {
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
            currentChannel: 'prerelease',
            onSetUpdateChannel: vi.fn(),
        });
        const appSubmenu = submenuOf(template[0]);
        const channelItem = appSubmenu.find((i) => i.label === UPDATE_CHANNEL_LABEL)!;
        const sub = submenuOf(channelItem);
        expect(sub.find((i) => i.label === 'Stable')!.checked).toBe(false);
        expect(sub.find((i) => i.label === 'Prerelease')!.checked).toBe(true);
    });

    it('calls onSetUpdateChannel with the correct channel when clicked', () => {
        const onSetUpdateChannel = vi.fn();
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
            currentChannel: 'stable',
            onSetUpdateChannel,
        });
        const appSubmenu = submenuOf(template[0]);
        const channelItem = appSubmenu.find((i) => i.label === UPDATE_CHANNEL_LABEL)!;
        const sub = submenuOf(channelItem);
        (sub.find((i) => i.label === 'Prerelease')!.click as () => void)();
        expect(onSetUpdateChannel).toHaveBeenCalledWith('prerelease');
        (sub.find((i) => i.label === 'Stable')!.click as () => void)();
        expect(onSetUpdateChannel).toHaveBeenCalledWith('stable');
    });

    it('defaults to stable checkmark when currentChannel is not provided', () => {
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
        });
        const appSubmenu = submenuOf(template[0]);
        const channelItem = appSubmenu.find((i) => i.label === UPDATE_CHANNEL_LABEL)!;
        const sub = submenuOf(channelItem);
        expect(sub.find((i) => i.label === 'Stable')!.checked).toBe(true);
    });

    it('also appears in the Windows Help menu', () => {
        const template = buildAppMenuTemplate('win32', 'CoC', {
            onCheckForUpdates: vi.fn(),
            currentChannel: 'prerelease',
            onSetUpdateChannel: vi.fn(),
        });
        const help = template.find((i) => i.label === 'Help')!;
        const items = submenuOf(help);
        const channelItem = items.find((i) => i.label === UPDATE_CHANNEL_LABEL)!;
        expect(channelItem).toBeDefined();
        const sub = submenuOf(channelItem);
        expect(sub.find((i) => i.label === 'Prerelease')!.checked).toBe(true);
    });
});

describe('buildAppMenuTemplate — Windows', () => {
    const handlers = { onCheckForUpdates: vi.fn() };
    const template = buildAppMenuTemplate('win32', 'CoC', handlers);

    it('preserves the standard File/Edit/View/Window menus', () => {
        const roles = template.map((i) => i.role);
        expect(roles).toContain('fileMenu');
        expect(template.map((i) => i.label)).toContain(EDIT_MENU_LABEL);
        expect(roles).toContain('viewMenu');
        expect(roles).toContain('windowMenu');
    });

    it('hosts "About CoC" then "Check for Updates…" in a Help menu', () => {
        const help = template.find((i) => i.label === 'Help');
        expect(help).toBeDefined();
        const items = submenuOf(help!);
        const aboutIdx = labelIdx(items, 'About CoC');
        const checkIdx = labelIdx(items, CHECK_FOR_UPDATES_LABEL);
        expect(aboutIdx).toBeGreaterThanOrEqual(0);
        expect(items[aboutIdx].role).toBe('about');
        expect(checkIdx).toBeGreaterThan(aboutIdx);
        expect(isSeparator(items[aboutIdx + 1])).toBe(true);
    });

    it('wires the Check-for-Updates click to the provided handler (AC-02)', () => {
        const items = submenuOf(template.find((i) => i.label === 'Help')!);
        const check = items.find((i) => i.label === CHECK_FOR_UPDATES_LABEL)!;
        (check.click as () => void)();
        expect(handlers.onCheckForUpdates).toHaveBeenCalledTimes(1);
    });
});

describe('buildAppMenuTemplate — Report an Issue… (AC-01)', () => {
    const platforms: NodeJS.Platform[] = ['darwin', 'win32', 'linux'];

    for (const platform of platforms) {
        describe(platform, () => {
            const onReportIssue = vi.fn();
            const template = buildAppMenuTemplate(platform, 'CoC', {
                onCheckForUpdates: vi.fn(),
                onReportIssue,
            });
            const help = template.find((i) => i.label === 'Help');

            it('has a Help submenu', () => {
                expect(help).toBeDefined();
            });

            it('puts "Report an Issue…" first, followed by a separator', () => {
                const items = submenuOf(help!);
                expect(items[0].label).toBe(REPORT_ISSUE_LABEL);
                expect(isSeparator(items[1])).toBe(true);
            });

            it('keeps About, Check for Updates… and Update Channel below it', () => {
                const items = submenuOf(help!);
                const labels = items.filter((i) => i.label).map((i) => i.label);
                expect(labels.slice(1)).toEqual(
                    expect.arrayContaining([
                        'About CoC',
                        CHECK_FOR_UPDATES_LABEL,
                        UPDATE_CHANNEL_LABEL,
                    ]),
                );
                expect(labelIdx(items, 'About CoC')).toBeGreaterThan(0);
            });

            it('wires the click to the provided handler', () => {
                const items = submenuOf(help!);
                (items[0].click as () => void)();
                expect(onReportIssue).toHaveBeenCalledTimes(1);
            });

            it('renders the row (and a no-op click) when no handler is supplied', () => {
                const bare = buildAppMenuTemplate(platform, 'CoC', {
                    onCheckForUpdates: vi.fn(),
                });
                const items = submenuOf(bare.find((i) => i.label === 'Help')!);
                expect(items[0].label).toBe(REPORT_ISSUE_LABEL);
                expect(() => (items[0].click as () => void)()).not.toThrow();
            });
        });
    }

    it('leaves the macOS app submenu untouched', () => {
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
            onReportIssue: vi.fn(),
        });
        const app = submenuOf(template[0]);
        expect(app[0].role).toBe('about');
        expect(app.some((i) => i.label === REPORT_ISSUE_LABEL)).toBe(false);
    });
});

describe('buildTrayMenuTemplate', () => {
    const handlers = { onShow: vi.fn(), onHide: vi.fn(), onQuit: vi.fn() };
    const template = buildTrayMenuTemplate(handlers);

    it('does NOT contain a "Check for Updates…" item (AC-03)', () => {
        expect(template.some((i) => i.label === CHECK_FOR_UPDATES_LABEL)).toBe(false);
    });

    it('keeps only show / hide / quit, in order', () => {
        const labels = template.filter((i) => i.label).map((i) => i.label);
        expect(labels).toEqual(['Show CoC', 'Hide CoC', 'Quit CoC']);
    });

    it('wires each tray click to its handler', () => {
        const click = (label: string) =>
            (template.find((i) => i.label === label)!.click as () => void)();
        click('Show CoC');
        click('Hide CoC');
        click('Quit CoC');
        expect(handlers.onShow).toHaveBeenCalledTimes(1);
        expect(handlers.onHide).toHaveBeenCalledTimes(1);
        expect(handlers.onQuit).toHaveBeenCalledTimes(1);
    });
});

describe('devTunnelStatusLabel', () => {
    it('renders each status word in the disabled status row (AC-01)', () => {
        expect(devTunnelStatusLabel('off')).toContain('Off');
        expect(devTunnelStatusLabel('starting')).toContain('Starting');
        expect(devTunnelStatusLabel('online')).toContain('Online');
        expect(devTunnelStatusLabel('failed')).toContain('Failed');
    });
});

describe('devTunnelPublicUrlLabel', () => {
    it('drops the https:// scheme and any trailing slash', () => {
        expect(devTunnelPublicUrlLabel('https://abc-4000.usw2.devtunnels.ms/')).toBe(
            'abc-4000.usw2.devtunnels.ms',
        );
        expect(devTunnelPublicUrlLabel('  https://abc.devtunnels.ms  ')).toBe('abc.devtunnels.ms');
    });

    it('keeps a path segment that is not just a trailing slash', () => {
        expect(devTunnelPublicUrlLabel('https://abc.devtunnels.ms/repos')).toBe(
            'abc.devtunnels.ms/repos',
        );
    });

    it('elides an over-long URL in the middle, keeping the id and the host', () => {
        const long = `https://${'x'.repeat(80)}-4000.usw2.devtunnels.ms`;
        const label = devTunnelPublicUrlLabel(long);
        expect(label.length).toBe(DEV_TUNNEL_URL_LABEL_MAX);
        expect(label).toContain('…');
        expect(label.startsWith('xxxx')).toBe(true);
        expect(label.endsWith('devtunnels.ms')).toBe(true);
    });

    it('returns an empty label for an empty URL rather than throwing', () => {
        expect(devTunnelPublicUrlLabel('')).toBe('');
    });
});

describe('buildDevTunnelMenu', () => {
    const makeHandlers = (): DevTunnelMenuHandlers => ({
        onConfigure: vi.fn(),
        onStart: vi.fn(),
        onStop: vi.fn(),
        onRetry: vi.fn(),
        onShowLastError: vi.fn(),
        onCopyPublicUrl: vi.fn(),
    });
    const build = (
        state: DevTunnelHostState,
        enabled: boolean,
        handlers: DevTunnelMenuHandlers = makeHandlers(),
        expectedUrl?: string,
    ): { menu: Item; items: Item[]; handlers: DevTunnelMenuHandlers } => {
        const input: DevTunnelMenuInput = { state, enabled, expectedUrl, handlers };
        const menu = buildDevTunnelMenu(input);
        return { menu, items: submenuOf(menu), handlers };
    };
    const labels = (items: Item[]): string[] =>
        items.filter((i) => i.label).map((i) => i.label as string);

    it('labels the top-level menu "Dev Tunnel"', () => {
        const { menu } = build({ status: 'off' }, false);
        expect(menu.label).toBe(DEV_TUNNEL_MENU_LABEL);
    });

    it('starts with a DISABLED status row reflecting the runtime status', () => {
        for (const status of ['off', 'starting', 'online', 'failed'] as const) {
            const state: DevTunnelHostState =
                status === 'online'
                    ? { status, publicUrl: 'https://x.devtunnels.ms/' }
                    : status === 'failed'
                      ? { status, error: { category: 'cli-missing', message: 'nope' } }
                      : { status };
            const { items } = build(state, status !== 'off');
            expect(items[0].enabled).toBe(false);
            expect(items[0].label).toBe(devTunnelStatusLabel(status));
        }
    });

    it('always offers Configure… and wires its click', () => {
        const { items, handlers } = build({ status: 'off' }, false);
        const configure = items.find((i) => i.label === DEV_TUNNEL_CONFIGURE_LABEL)!;
        expect(configure).toBeDefined();
        (configure.click as () => void)();
        expect(handlers.onConfigure).toHaveBeenCalledTimes(1);
    });

    it('shows Start (not Stop) while the feature is disabled, and wires it', () => {
        const { items, handlers } = build({ status: 'off' }, false);
        expect(labels(items)).toContain(DEV_TUNNEL_START_LABEL);
        expect(labels(items)).not.toContain(DEV_TUNNEL_STOP_LABEL);
        (items.find((i) => i.label === DEV_TUNNEL_START_LABEL)!.click as () => void)();
        expect(handlers.onStart).toHaveBeenCalledTimes(1);
    });

    it('shows Stop (not Start) while the feature is enabled, and wires it', () => {
        const { items, handlers } = build({ status: 'starting' }, true);
        expect(labels(items)).toContain(DEV_TUNNEL_STOP_LABEL);
        expect(labels(items)).not.toContain(DEV_TUNNEL_START_LABEL);
        (items.find((i) => i.label === DEV_TUNNEL_STOP_LABEL)!.click as () => void)();
        expect(handlers.onStop).toHaveBeenCalledTimes(1);
    });

    it('shows Stop even when enabled but currently failed (Retry keeps the gate)', () => {
        const state: DevTunnelHostState = {
            status: 'failed',
            error: { category: 'unexpected-exit', message: 'host exited' },
        };
        const { items } = build(state, true);
        expect(labels(items)).toContain(DEV_TUNNEL_STOP_LABEL);
        expect(labels(items)).toContain(DEV_TUNNEL_RETRY_LABEL);
    });

    it('shows Retry ONLY when the status is failed, and wires it', () => {
        for (const status of ['off', 'starting', 'online'] as const) {
            const state: DevTunnelHostState =
                status === 'online' ? { status, publicUrl: 'https://x.devtunnels.ms/' } : { status };
            const { items } = build(state, status !== 'off');
            expect(labels(items)).not.toContain(DEV_TUNNEL_RETRY_LABEL);
        }
        const { items, handlers } = build(
            { status: 'failed', error: { category: 'url-timeout', message: 'timed out' } },
            true,
        );
        const retry = items.find((i) => i.label === DEV_TUNNEL_RETRY_LABEL)!;
        (retry.click as () => void)();
        expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows Show Last Error… ONLY when an error is present, and wires it', () => {
        const { items: noError } = build({ status: 'off' }, false);
        expect(labels(noError)).not.toContain(DEV_TUNNEL_SHOW_ERROR_LABEL);

        const { items, handlers } = build(
            { status: 'failed', error: { category: 'not-owned', message: 'not yours' } },
            true,
        );
        const show = items.find((i) => i.label === DEV_TUNNEL_SHOW_ERROR_LABEL)!;
        expect(show).toBeDefined();
        (show.click as () => void)();
        expect(handlers.onShowLastError).toHaveBeenCalledTimes(1);
    });

    it('shows the public URL as a disabled row right under the status row when online', () => {
        const { items } = build(
            { status: 'online', publicUrl: 'https://abc-4000.usw2.devtunnels.ms/' },
            true,
        );
        expect(items[1].enabled).toBe(false);
        expect(items[1].label).toBe('abc-4000.usw2.devtunnels.ms');
        expect(items[1].click).toBeUndefined();
    });

    it('omits the public-URL row unless online with a resolved URL', () => {
        for (const state of [
            { status: 'off' } as DevTunnelHostState,
            { status: 'starting' } as DevTunnelHostState,
            { status: 'online' } as DevTunnelHostState,
            {
                status: 'failed',
                error: { category: 'cli-missing', message: 'x' },
            } as DevTunnelHostState,
        ]) {
            const { items } = build(state, state.status !== 'off');
            expect(items[1].type).toBe('separator');
            expect(labels(items).some((l) => l.includes('devtunnels.ms'))).toBe(false);
        }
    });

    it('shows the derived URL marked "(expected)" while starting', () => {
        const { items } = build(
            { status: 'starting' },
            true,
            makeHandlers(),
            'https://box-coc-4000.usw2.devtunnels.ms',
        );
        expect(items[1].enabled).toBe(false);
        expect(items[1].label).toBe(
            `box-coc-4000.usw2.devtunnels.ms${DEV_TUNNEL_EXPECTED_URL_SUFFIX}`,
        );
    });

    it('prefers the reported URL over the expected one once online', () => {
        const { items } = build(
            { status: 'online', publicUrl: 'https://box-coc-4000.euw.devtunnels.ms/' },
            true,
            makeHandlers(),
            'https://box-coc-4000.usw2.devtunnels.ms',
        );
        expect(items[1].label).toBe('box-coc-4000.euw.devtunnels.ms');
    });

    it('never shows an expected URL for a status other than starting', () => {
        const expected = 'https://box-coc-4000.usw2.devtunnels.ms';
        for (const state of [
            { status: 'off' } as DevTunnelHostState,
            {
                status: 'failed',
                error: { category: 'url-timeout', message: 'x' },
            } as DevTunnelHostState,
        ]) {
            const { items } = build(state, state.status !== 'off', makeHandlers(), expected);
            expect(items[1].type).toBe('separator');
        }
    });

    it('shows Copy Public URL ONLY when online with a resolved URL, and wires it', () => {
        // off / starting / failed → no Copy URL
        for (const state of [
            { status: 'off' } as DevTunnelHostState,
            { status: 'starting' } as DevTunnelHostState,
            {
                status: 'failed',
                error: { category: 'cli-missing', message: 'x' },
            } as DevTunnelHostState,
        ]) {
            const { items } = build(state, state.status !== 'off');
            expect(labels(items)).not.toContain(DEV_TUNNEL_COPY_URL_LABEL);
        }
        // online but no URL yet → still no Copy URL (defensive).
        const { items: onlineNoUrl } = build({ status: 'online' }, true);
        expect(labels(onlineNoUrl)).not.toContain(DEV_TUNNEL_COPY_URL_LABEL);

        const { items, handlers } = build(
            { status: 'online', publicUrl: 'https://abc.devtunnels.ms/' },
            true,
        );
        const copy = items.find((i) => i.label === DEV_TUNNEL_COPY_URL_LABEL)!;
        expect(copy).toBeDefined();
        (copy.click as () => void)();
        expect(handlers.onCopyPublicUrl).toHaveBeenCalledTimes(1);
    });
});

describe('buildAppMenuTemplate — Dev Tunnel menu (AC-01, Windows only)', () => {
    const devTunnel: DevTunnelMenuInput = {
        state: { status: 'off' },
        enabled: false,
        handlers: {
            onConfigure: vi.fn(),
            onStart: vi.fn(),
            onStop: vi.fn(),
            onRetry: vi.fn(),
            onShowLastError: vi.fn(),
            onCopyPublicUrl: vi.fn(),
        },
    };

    it('adds a top-level Dev Tunnel menu on win32 when devTunnel is provided', () => {
        const template = buildAppMenuTemplate('win32', 'CoC', {
            onCheckForUpdates: vi.fn(),
            devTunnel,
        });
        const tunnel = template.find((i) => i.label === DEV_TUNNEL_MENU_LABEL);
        expect(tunnel).toBeDefined();
        // Placed before the Help menu.
        const tunnelIdx = template.findIndex((i) => i.label === DEV_TUNNEL_MENU_LABEL);
        const helpIdx = template.findIndex((i) => i.label === 'Help');
        expect(tunnelIdx).toBeGreaterThanOrEqual(0);
        expect(tunnelIdx).toBeLessThan(helpIdx);
    });

    it('omits the Dev Tunnel menu on win32 when devTunnel is not provided', () => {
        const template = buildAppMenuTemplate('win32', 'CoC', { onCheckForUpdates: vi.fn() });
        expect(template.some((i) => i.label === DEV_TUNNEL_MENU_LABEL)).toBe(false);
    });

    it('never adds the Dev Tunnel menu on macOS even if devTunnel is provided', () => {
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
            devTunnel,
        });
        expect(template.some((i) => i.label === DEV_TUNNEL_MENU_LABEL)).toBe(false);
    });
});

describe('buildDebugMenu (Fix 3)', () => {
    const makeHandlers = (): DebugMenuHandlers => ({
        onOpenLogsViewer: vi.fn(),
        onRevealLogFiles: vi.fn(),
        onToggleDevTools: vi.fn(),
    });

    it('labels the top-level menu "Debug"', () => {
        expect(buildDebugMenu(makeHandlers()).label).toBe(DEBUG_MENU_LABEL);
    });

    it('lists Open Logs Viewer, Reveal Log Files, (separator), Toggle Developer Tools in order', () => {
        const items = submenuOf(buildDebugMenu(makeHandlers()));
        const labels = items.filter((i) => i.label).map((i) => i.label);
        expect(labels).toEqual([
            OPEN_LOGS_VIEWER_LABEL,
            REVEAL_LOG_FILES_LABEL,
            TOGGLE_DEVTOOLS_LABEL,
        ]);
        // The DevTools toggle is separated from the two log actions.
        const revealIdx = labelIdx(items, REVEAL_LOG_FILES_LABEL);
        const devtoolsIdx = labelIdx(items, TOGGLE_DEVTOOLS_LABEL);
        expect(isSeparator(items[revealIdx + 1])).toBe(true);
        expect(devtoolsIdx).toBe(revealIdx + 2);
    });

    it('wires each Debug click to its handler', () => {
        const handlers = makeHandlers();
        const items = submenuOf(buildDebugMenu(handlers));
        const click = (label: string) =>
            (items.find((i) => i.label === label)!.click as () => void)();
        click(OPEN_LOGS_VIEWER_LABEL);
        click(REVEAL_LOG_FILES_LABEL);
        click(TOGGLE_DEVTOOLS_LABEL);
        expect(handlers.onOpenLogsViewer).toHaveBeenCalledTimes(1);
        expect(handlers.onRevealLogFiles).toHaveBeenCalledTimes(1);
        expect(handlers.onToggleDevTools).toHaveBeenCalledTimes(1);
    });
});

describe('buildAppMenuTemplate — Debug menu (Fix 3)', () => {
    const debug: DebugMenuHandlers = {
        onOpenLogsViewer: vi.fn(),
        onRevealLogFiles: vi.fn(),
        onToggleDevTools: vi.fn(),
    };

    it('adds a top-level Debug menu on macOS, after the Window menu', () => {
        const template = buildAppMenuTemplate('darwin', 'CoC', {
            onCheckForUpdates: vi.fn(),
            debug,
        });
        const debugIdx = template.findIndex((i) => i.label === DEBUG_MENU_LABEL);
        const windowIdx = template.findIndex((i) => i.role === 'windowMenu');
        expect(debugIdx).toBeGreaterThanOrEqual(0);
        expect(debugIdx).toBeGreaterThan(windowIdx);
    });

    it('adds a top-level Debug menu on win32, before the Help menu', () => {
        const template = buildAppMenuTemplate('win32', 'CoC', {
            onCheckForUpdates: vi.fn(),
            debug,
        });
        const debugIdx = template.findIndex((i) => i.label === DEBUG_MENU_LABEL);
        const helpIdx = template.findIndex((i) => i.label === 'Help');
        expect(debugIdx).toBeGreaterThanOrEqual(0);
        expect(debugIdx).toBeLessThan(helpIdx);
    });

    it('omits the Debug menu when no debug handlers are provided (both platforms)', () => {
        for (const platform of ['darwin', 'win32'] as const) {
            const template = buildAppMenuTemplate(platform, 'CoC', { onCheckForUpdates: vi.fn() });
            expect(template.some((i) => i.label === DEBUG_MENU_LABEL)).toBe(false);
        }
    });

    it('wires the Debug items through buildAppMenuTemplate on both platforms', () => {
        for (const platform of ['darwin', 'win32'] as const) {
            const handlers: DebugMenuHandlers = {
                onOpenLogsViewer: vi.fn(),
                onRevealLogFiles: vi.fn(),
                onToggleDevTools: vi.fn(),
            };
            const template = buildAppMenuTemplate(platform, 'CoC', {
                onCheckForUpdates: vi.fn(),
                debug: handlers,
            });
            const items = submenuOf(template.find((i) => i.label === DEBUG_MENU_LABEL)!);
            (items.find((i) => i.label === OPEN_LOGS_VIEWER_LABEL)!.click as () => void)();
            (items.find((i) => i.label === REVEAL_LOG_FILES_LABEL)!.click as () => void)();
            (items.find((i) => i.label === TOGGLE_DEVTOOLS_LABEL)!.click as () => void)();
            expect(handlers.onOpenLogsViewer).toHaveBeenCalledTimes(1);
            expect(handlers.onRevealLogFiles).toHaveBeenCalledTimes(1);
            expect(handlers.onToggleDevTools).toHaveBeenCalledTimes(1);
        }
    });
});

describe('buildAppMenuTemplate — elevation status row', () => {
    /** The submenu that hosts "About <app>": the app menu on macOS, Help elsewhere. */
    const aboutHost = (platform: NodeJS.Platform, elevation?: ElevationState): Item[] => {
        const template = buildAppMenuTemplate(platform, 'CoC', {
            onCheckForUpdates: vi.fn(),
            elevation,
        });
        return submenuOf(
            platform === 'darwin' ? template[0] : template.find((i) => i.label === 'Help')!,
        );
    };

    it('adds a disabled status row directly under "About CoC" on Windows', () => {
        const items = aboutHost('win32', 'elevated');
        const aboutIdx = labelIdx(items, 'About CoC');
        expect(aboutIdx).toBeGreaterThanOrEqual(0);
        expect(items[aboutIdx + 1].label).toBe('Elevation: Administrator');
        expect(items[aboutIdx + 1].enabled).toBe(false);
        // The separator + update items still follow, just shifted by one row.
        expect(isSeparator(items[aboutIdx + 2])).toBe(true);
        expect(items[aboutIdx + 3].label).toBe(CHECK_FOR_UPDATES_LABEL);
        expect(items[aboutIdx + 4].label).toBe(UPDATE_CHANNEL_LABEL);
    });

    it('renders the standard and unknown states on Windows too', () => {
        expect(labelIdx(aboutHost('win32', 'standard'), 'Elevation: Standard user')).toBeGreaterThan(
            -1,
        );
        expect(labelIdx(aboutHost('win32', 'unknown'), 'Elevation: Unknown')).toBeGreaterThan(-1);
    });

    it('adds the row under About in the macOS app submenu, with root wording', () => {
        const items = aboutHost('darwin', 'elevated');
        const aboutIdx = labelIdx(items, 'About CoC');
        expect(items[aboutIdx + 1].label).toBe('Elevation: Root');
        expect(items[aboutIdx + 1].enabled).toBe(false);
    });

    it('leaves the menu unchanged when no elevation state is supplied', () => {
        for (const platform of ['darwin', 'win32'] as const) {
            const items = aboutHost(platform, undefined);
            expect(items.some((i) => String(i.label ?? '').startsWith('Elevation:'))).toBe(false);
            const aboutIdx = labelIdx(items, 'About CoC');
            expect(isSeparator(items[aboutIdx + 1])).toBe(true);
            expect(items[aboutIdx + 2].label).toBe(CHECK_FOR_UPDATES_LABEL);
        }
    });
});

describe('buildEditMenu — Copy delegation (AC-06)', () => {
    /**
     * REGRESSION: the Edit menu was `{ role: "editMenu" }`, whose Copy row is
     * `role: "copy"` → `webContents.copy()`. That copies the DOM selection,
     * which xterm.js never makes (it paints its own), and on macOS the role's
     * Cmd+C accelerator is consumed by the menu, so the terminal's key handler
     * never ran either. Copy must therefore be a delegating item, while every
     * other editing command keeps its standard role.
     */
    for (const platform of ['darwin', 'win32'] as NodeJS.Platform[]) {
        describe(platform, () => {
            it('keeps Cut/Paste/Undo/Redo/Select All on their standard roles', () => {
                const items = submenuOf(buildEditMenu(platform, vi.fn()));
                for (const role of ['undo', 'redo', 'cut', 'paste', 'selectAll']) {
                    expect(roleIdx(items, role)).toBeGreaterThanOrEqual(0);
                }
            });

            it('replaces only Copy, and wires it to the delegate', () => {
                const onCopy = vi.fn();
                const items = submenuOf(buildEditMenu(platform, onCopy));
                expect(roleIdx(items, 'copy')).toBe(-1);
                const copy = items[labelIdx(items, EDIT_COPY_LABEL)];
                expect(copy.accelerator).toBe('CmdOrCtrl+C');
                (copy.click as () => void)();
                expect(onCopy).toHaveBeenCalledTimes(1);
            });

            it('keeps Copy between Cut and Paste', () => {
                const items = submenuOf(buildEditMenu(platform, vi.fn()));
                expect(labelIdx(items, EDIT_COPY_LABEL)).toBe(roleIdx(items, 'cut') + 1);
                expect(roleIdx(items, 'paste')).toBe(labelIdx(items, EDIT_COPY_LABEL) + 1);
            });

            it('falls back to the standard copy role with no delegate', () => {
                const items = submenuOf(buildEditMenu(platform));
                expect(roleIdx(items, 'copy')).toBeGreaterThanOrEqual(0);
                expect(labelIdx(items, EDIT_COPY_LABEL)).toBe(-1);
            });

            it('is the Edit menu the app template uses', () => {
                const onCopy = vi.fn();
                const template = buildAppMenuTemplate(platform, 'CoC', {
                    onCheckForUpdates: vi.fn(),
                    onCopy,
                });
                const edit = template.find((i) => i.label === EDIT_MENU_LABEL);
                expect(edit).toBeDefined();
                const items = submenuOf(edit!);
                (items[labelIdx(items, EDIT_COPY_LABEL)].click as () => void)();
                expect(onCopy).toHaveBeenCalledTimes(1);
            });
        });
    }

    it('adds the macOS-only Paste and Match Style row', () => {
        expect(roleIdx(submenuOf(buildEditMenu('darwin')), 'pasteAndMatchStyle')).toBeGreaterThanOrEqual(0);
        expect(roleIdx(submenuOf(buildEditMenu('win32')), 'pasteAndMatchStyle')).toBe(-1);
    });
});
