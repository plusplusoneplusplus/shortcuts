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
    CHECK_FOR_UPDATES_LABEL,
    UPDATE_CHANNEL_LABEL,
    DEV_TUNNEL_MENU_LABEL,
    DEV_TUNNEL_CONFIGURE_LABEL,
    DEV_TUNNEL_START_LABEL,
    DEV_TUNNEL_STOP_LABEL,
    DEV_TUNNEL_RETRY_LABEL,
    DEV_TUNNEL_SHOW_ERROR_LABEL,
    DEV_TUNNEL_COPY_URL_LABEL,
    type DevTunnelMenuHandlers,
    type DevTunnelMenuInput,
} from '../src/app-menu';
import type { DevTunnelHostState } from '../src/devtunnel-host';

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
        expect(roles).toContain('editMenu');
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
        expect(roles).toContain('editMenu');
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
    ): { menu: Item; items: Item[]; handlers: DevTunnelMenuHandlers } => {
        const input: DevTunnelMenuInput = { state, enabled, handlers };
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
