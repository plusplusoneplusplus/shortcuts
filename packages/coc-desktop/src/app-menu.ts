/**
 * CoC Desktop — native menu templates.
 *
 * Pure, electron-free builders for the two native menus this app owns:
 *
 *   - the application menu (macOS app-menu bar / Windows menu bar), set via
 *     `Menu.setApplicationMenu` in `main.ts`, and
 *   - the tray context menu, set via `tray.setContextMenu` in `main.ts`.
 *
 * Like `update-check.ts`, this module imports NOTHING from `electron` at
 * runtime — the only electron reference is a type-only `MenuItemConstructorOptions`
 * import, which is erased at compile time. That keeps the template *shape* (item
 * order, separators, roles, and which click handler is wired where) unit-testable
 * under plain Node, while the electron wiring (`Menu.buildFromTemplate`,
 * `setApplicationMenu`, `setContextMenu`) stays in `main.ts`.
 */

import type { MenuItemConstructorOptions } from 'electron';
import type { UpdateChannel } from './update-check';
import type { DevTunnelHostState, DevTunnelHostStatus } from './devtunnel-host';

/** Click handlers the application menu needs wired from `main.ts`. */
export interface AppMenuHandlers {
    /**
     * Invoked by "Check for Updates…". Must behave identically to the former tray
     * item — i.e. `runUpdateCheck(false)`: always report status, ignore the skip
     * marker.
     */
    onCheckForUpdates: () => void;
    /** The currently active update channel, used to render the channel checkmarks. */
    currentChannel?: UpdateChannel;
    /** Invoked when the user selects a new update channel from the menu. */
    onSetUpdateChannel?: (channel: UpdateChannel) => void;
    /**
     * Windows-only Dev Tunnel menu (AC-01). When present, a top-level
     * "Dev Tunnel" menu is added on win32 (only). Omit it (or pass a non-win32
     * platform) to keep macOS/Linux menus unchanged.
     */
    devTunnel?: DevTunnelMenuInput;
}

/** The "Check for Updates…" label — shared so tests and both platforms agree. */
export const CHECK_FOR_UPDATES_LABEL = 'Check for Updates…';

/** The "Update Channel" submenu label. */
export const UPDATE_CHANNEL_LABEL = 'Update Channel';

/** The top-level "Dev Tunnel" menu label (Windows only). */
export const DEV_TUNNEL_MENU_LABEL = 'Dev Tunnel';
/** Dev Tunnel action labels — shared so tests and `main.ts` wiring agree. */
export const DEV_TUNNEL_CONFIGURE_LABEL = 'Configure…';
export const DEV_TUNNEL_START_LABEL = 'Start';
export const DEV_TUNNEL_STOP_LABEL = 'Stop';
export const DEV_TUNNEL_RETRY_LABEL = 'Retry';
export const DEV_TUNNEL_SHOW_ERROR_LABEL = 'Show Last Error…';
export const DEV_TUNNEL_COPY_URL_LABEL = 'Copy Public URL';

/** Click handlers the Dev Tunnel menu needs wired from `main.ts` (AC-01/03/04). */
export interface DevTunnelMenuHandlers {
    /** Opens the fixed-size Configure… modal. */
    onConfigure: () => void;
    /** Persists `enabled: true` and starts the host (shown only while disabled). */
    onStart: () => void;
    /** Persists `enabled: false` and stops the host (shown only while enabled). */
    onStop: () => void;
    /** Cancels a pending backoff and attempts immediately (shown only when failed). */
    onRetry: () => void;
    /** Surfaces the bounded last-error detail (shown only when an error exists). */
    onShowLastError: () => void;
    /** Copies the public URL to the clipboard (shown only when online). */
    onCopyPublicUrl: () => void;
}

/** Everything the top-level Dev Tunnel menu needs to render one snapshot. */
export interface DevTunnelMenuInput {
    /** The latest observable tunnel state (drives status row, Retry, Copy URL). */
    state: DevTunnelHostState;
    /** The persisted feature gate (drives Start vs Stop). */
    enabled: boolean;
    handlers: DevTunnelMenuHandlers;
}

/** Human-readable status-row label for the disabled first menu item (AC-01). */
export function devTunnelStatusLabel(status: DevTunnelHostStatus): string {
    switch (status) {
        case 'off':
            return 'Status: Off';
        case 'starting':
            return 'Status: Starting';
        case 'online':
            return 'Status: Online';
        case 'failed':
            return 'Status: Failed';
    }
}

/**
 * Build the top-level "Dev Tunnel" menu (AC-01). Pure — the click wiring and the
 * enablement/visibility of each row are asserted under Node.
 *
 * Rows, in order:
 *   - a disabled status row (Off / Starting / Online / Failed);
 *   - Configure… (always available);
 *   - Start (while the feature is disabled) OR Stop (while enabled) — Start/Stop
 *     toggles the persisted `enabled` gate; Retry never touches it;
 *   - Retry (only when the current status is Failed);
 *   - Show Last Error… (only when a normalized error is present);
 *   - Copy Public URL (only when Online with a resolved public URL).
 */
export function buildDevTunnelMenu(
    input: DevTunnelMenuInput,
): MenuItemConstructorOptions {
    const { state, enabled, handlers } = input;
    const items: MenuItemConstructorOptions[] = [
        // Disabled status row — reflects the runtime status, not the gate.
        { label: devTunnelStatusLabel(state.status), enabled: false },
        { type: 'separator' },
        { label: DEV_TUNNEL_CONFIGURE_LABEL, click: handlers.onConfigure },
    ];

    // Start (feature off) or Stop (feature on) — mutually exclusive.
    items.push(
        enabled
            ? { label: DEV_TUNNEL_STOP_LABEL, click: handlers.onStop }
            : { label: DEV_TUNNEL_START_LABEL, click: handlers.onStart },
    );

    // Retry only while failed; it cancels a pending backoff and attempts now.
    if (state.status === 'failed') {
        items.push({ label: DEV_TUNNEL_RETRY_LABEL, click: handlers.onRetry });
    }

    // Show Last Error… only when a normalized error is present.
    if (state.error) {
        items.push({ label: DEV_TUNNEL_SHOW_ERROR_LABEL, click: handlers.onShowLastError });
    }

    // Copy Public URL only when online with a resolved URL.
    if (state.status === 'online' && state.publicUrl) {
        items.push(
            { type: 'separator' },
            { label: DEV_TUNNEL_COPY_URL_LABEL, click: handlers.onCopyPublicUrl },
        );
    }

    return { label: DEV_TUNNEL_MENU_LABEL, submenu: items };
}

/**
 * Build the full application-menu template for the given platform.
 *
 * On both macOS and Windows the menu carries a "Check for Updates…" item placed
 * directly after "About <app>" (across the separator that follows it), followed
 * by an "Update Channel" submenu (Stable / Prerelease). The template is a
 * complete custom menubar — it reconstructs the standard Edit/View/Window items
 * (via roles) so setting it does not strip the default editing/window commands.
 *
 *   - macOS: a custom app submenu (About, Check for Updates…, Update Channel,
 *     Services, the Hide/Quit cluster) plus the standard Edit/View/Window menus.
 *   - Windows: the standard File/Edit/View/Window menus plus a Help menu holding
 *     "About <app>" then "Check for Updates…" and "Update Channel".
 *
 * Linux is out of scope (the app keeps Electron's default menu there); callers
 * should not invoke this for Linux, but the non-darwin branch is used if they do.
 */
export function buildAppMenuTemplate(
    platform: NodeJS.Platform,
    appName: string,
    handlers: AppMenuHandlers,
): MenuItemConstructorOptions[] {
    const channel = handlers.currentChannel ?? 'stable';

    const aboutItem: MenuItemConstructorOptions = {
        label: `About ${appName}`,
        role: 'about',
    };
    const checkForUpdatesItem: MenuItemConstructorOptions = {
        label: CHECK_FOR_UPDATES_LABEL,
        click: handlers.onCheckForUpdates,
    };
    const updateChannelItem: MenuItemConstructorOptions = {
        label: UPDATE_CHANNEL_LABEL,
        submenu: [
            {
                label: 'Stable',
                type: 'radio',
                checked: channel === 'stable',
                click: () => handlers.onSetUpdateChannel?.('stable'),
            },
            {
                label: 'Prerelease',
                type: 'radio',
                checked: channel === 'prerelease',
                click: () => handlers.onSetUpdateChannel?.('prerelease'),
            },
        ],
    };

    if (platform === 'darwin') {
        return [
            {
                label: appName,
                submenu: [
                    aboutItem,
                    { type: 'separator' },
                    checkForUpdatesItem,
                    updateChannelItem,
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            { role: 'editMenu' },
            { role: 'viewMenu' },
            { role: 'windowMenu' },
        ];
    }

    // Windows (and any other non-darwin platform a caller passes): the default
    // menu has no "About", so a Help submenu hosts "About <app>" followed
    // directly (across a separator) by "Check for Updates…" and "Update Channel".
    const template: MenuItemConstructorOptions[] = [
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
    ];

    // Windows-only top-level Dev Tunnel menu (AC-01), placed before Help. Gated on
    // win32 so macOS/Linux menus stay unchanged even if a caller passes devTunnel.
    if (platform === 'win32' && handlers.devTunnel) {
        template.push(buildDevTunnelMenu(handlers.devTunnel));
    }

    template.push({
        label: 'Help',
        submenu: [aboutItem, { type: 'separator' }, checkForUpdatesItem, updateChannelItem],
    });
    return template;
}

/** Click handlers the tray context menu needs wired from `main.ts`. */
export interface TrayMenuHandlers {
    onShow: () => void;
    onHide: () => void;
    onQuit: () => void;
}

/**
 * Build the tray context-menu template. Intentionally does NOT include a
 * "Check for Updates…" item — that action now lives solely in the application
 * menu (see {@link buildAppMenuTemplate}), so the tray keeps only show/hide/quit.
 */
export function buildTrayMenuTemplate(
    handlers: TrayMenuHandlers,
): MenuItemConstructorOptions[] {
    return [
        { label: 'Show CoC', click: handlers.onShow },
        { label: 'Hide CoC', click: handlers.onHide },
        { type: 'separator' },
        { label: 'Quit CoC', click: handlers.onQuit },
    ];
}
