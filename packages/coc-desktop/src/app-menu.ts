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

/** Click handlers the application menu needs wired from `main.ts`. */
export interface AppMenuHandlers {
    /**
     * Invoked by "Check for Updates…". Must behave identically to the former tray
     * item — i.e. `runUpdateCheck(false)`: always report status, ignore the skip
     * marker.
     */
    onCheckForUpdates: () => void;
}

/** The "Check for Updates…" label — shared so tests and both platforms agree. */
export const CHECK_FOR_UPDATES_LABEL = 'Check for Updates…';

/**
 * Build the full application-menu template for the given platform.
 *
 * On both macOS and Windows the menu carries a "Check for Updates…" item placed
 * directly after "About <app>" (across the separator that follows it) and
 * separated from the rest of the menu by a separator. The template is a complete
 * custom menubar — it reconstructs the standard Edit/View/Window items (via
 * roles) so setting it does not strip the default editing/window commands.
 *
 *   - macOS: a custom app submenu (About, Check for Updates…, Services, the
 *     Hide/Quit cluster) plus the standard Edit/View/Window menus.
 *   - Windows: the standard File/Edit/View/Window menus plus a Help menu holding
 *     "About <app>" then "Check for Updates…".
 *
 * Linux is out of scope (the app keeps Electron's default menu there); callers
 * should not invoke this for Linux, but the non-darwin branch is used if they do.
 */
export function buildAppMenuTemplate(
    platform: NodeJS.Platform,
    appName: string,
    handlers: AppMenuHandlers,
): MenuItemConstructorOptions[] {
    // "About <app>" — explicit label (with the `about` role for the branded
    // About panel) so the item reads "About CoC" on every platform and the
    // ordering relative to "Check for Updates…" is self-describing in tests.
    const aboutItem: MenuItemConstructorOptions = {
        label: `About ${appName}`,
        role: 'about',
    };
    const checkForUpdatesItem: MenuItemConstructorOptions = {
        label: CHECK_FOR_UPDATES_LABEL,
        click: handlers.onCheckForUpdates,
    };

    if (platform === 'darwin') {
        return [
            {
                label: appName,
                submenu: [
                    aboutItem,
                    { type: 'separator' },
                    checkForUpdatesItem,
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
    // directly (across a separator) by "Check for Updates…".
    return [
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        {
            label: 'Help',
            submenu: [aboutItem, { type: 'separator' }, checkForUpdatesItem],
        },
    ];
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
