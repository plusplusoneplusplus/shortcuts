import { parseBrowserCommand, type BrowserCommandRequest } from '@plusplusoneplusplus/coc-client';
import { validateBrowserUrl } from './browser-view-policy';

/** IPC is a separate trust boundary from server tool argument validation. */
export function validateBrowserCommandRequest(input: unknown): BrowserCommandRequest {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid browser request');
    const request = input as BrowserCommandRequest;
    if (Object.keys(request).some(key => !['id', 'turnId', 'workspaceId', 'processId', 'command', 'selectedTab', 'framesEnabled', 'richPasteEnabled', 'humanTakeoverEnabled', 'cursorOverlayEnabled', 'validateAfterTakeover'].includes(key))) throw new TypeError('Invalid browser request field');
    if (request.validateAfterTakeover !== undefined && typeof request.validateAfterTakeover !== 'boolean') throw new TypeError('Invalid browser continuation validation');
    if (request.humanTakeoverEnabled !== undefined && typeof request.humanTakeoverEnabled !== 'boolean') throw new TypeError('Invalid browser takeover policy');
    if (request.cursorOverlayEnabled !== undefined && typeof request.cursorOverlayEnabled !== 'boolean') throw new TypeError('Invalid browser cursor overlay policy');
    if (request.richPasteEnabled !== undefined && typeof request.richPasteEnabled !== 'boolean') throw new TypeError('Invalid browser rich paste policy');
    if (request.framesEnabled !== undefined && typeof request.framesEnabled !== 'boolean') throw new TypeError('Invalid browser frame policy');
    if (request.turnId !== undefined && (typeof request.turnId !== 'string' || !request.turnId || request.turnId.length > 512)) throw new TypeError('Invalid browser turn');
    for (const key of ['id', 'workspaceId', 'processId'] as const) {
        if (typeof request[key] !== 'string' || !request[key] || request[key].length > 512) throw new TypeError(`Invalid browser ${key}`);
    }
    if (request.selectedTab !== undefined && (typeof request.selectedTab !== 'string' || !request.selectedTab || request.selectedTab.length > 1024)) throw new TypeError('Invalid selected tab');
    const command = parseBrowserCommand(request.command);
    if (command.action === 'paste_html' && (!request.richPasteEnabled || !request.framesEnabled)) throw new Error('Browser rich paste and frame control must be enabled');
    if (!request.framesEnabled && (command.action === 'frames' || command.frame !== undefined)) throw new Error('Browser frame control is disabled');
    for (const key of ['tab', 'ref', 'url', 'text', 'value', 'key', 'direction', 'js'] as const) {
        if (command[key] !== undefined && command[key]!.length > 1_000_000) throw new TypeError(`Invalid browser ${key}`);
    }
    if (command.tab !== undefined && (!command.tab || command.tab.length > 1024)) throw new TypeError('Invalid browser tab');
    if (command.ref !== undefined && !/^e[1-9]\d*$/.test(command.ref)) throw new TypeError('Invalid browser ref');
    if (command.frame !== undefined && !/^f[a-zA-Z0-9-]{1,100}$/.test(command.frame)) throw new TypeError('Invalid browser frame');
    if (command.url !== undefined && !validateBrowserUrl(command.url).ok) throw new TypeError('Browser URL must be http or https');
    return request;
}

export const BROWSER_CONTROL_SCOPE_CHANNEL = 'coc-desktop:browser-control-scope';
export const BROWSER_CONTROL_RETAIN_CHANNEL = 'coc-desktop:browser-control-retain';
export const BROWSER_CONTROL_COMMAND_CHANNEL = 'coc-desktop:browser-control-command';
export const BROWSER_CONTROL_CANCEL_CHANNEL = 'coc-desktop:browser-control-cancel';
export const BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL = 'coc-desktop:browser-control-release-frames';
export const BROWSER_CONTROL_REMOVE_CURSORS_CHANNEL = 'coc-desktop:browser-control-remove-cursors';
export const BROWSER_CONTROL_REVEAL_CHANNEL = 'coc-desktop:browser-control-reveal';
export const BROWSER_CONTROL_FOCUSED_CHANNEL = 'coc-desktop:browser-control-focused';
export const BROWSER_CONTROL_ACTIVITY_CHANNEL = 'coc-desktop:browser-control-activity';
export const BROWSER_CONTROL_FINISH_CHANNEL = 'coc-desktop:browser-control-finish';
export const BROWSER_CONTROL_STOP_CHANNEL = 'coc-desktop:browser-control-stop';
export const BROWSER_CONTROL_VISIBLE_CHANNEL = 'coc-desktop:browser-control-visible';
export const BROWSER_CONTROL_NAVIGATION_CHECK_CHANNEL = 'coc-desktop:browser-control-navigation-check';
export const BROWSER_CONTROL_NAVIGATION_DECISION_CHANNEL = 'coc-desktop:browser-control-navigation-decision';

/** A top-level navigation held during an active control turn until the owning server decides. */
export interface BrowserNavigationCheckEvent {
    checkId: string;
    workspaceId: string;
    processId: string;
    turnId: string;
    routingRef: string;
    url: string;
}

export interface BrowserControlActivityEvent {
    routingOwnerId?: number;
    workspaceId: string;
    processId: string;
    turnId: string;
    routingRef: string;
    viewId: string;
    active: boolean;
    finished?: boolean;
    /** The turn drives this tab from a retained scope while another workspace is selected. */
    background?: boolean;
}

export const BROWSER_CONTROL_TAKEOVER_CHANNEL = 'coc-desktop:browser-control-takeover';
export const BROWSER_CONTROL_TAKEOVER_STATE_CHANNEL = 'coc-desktop:browser-control-takeover-state';
