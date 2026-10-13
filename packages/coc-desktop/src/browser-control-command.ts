import { parseBrowserCommand, type BrowserCommandRequest } from '@plusplusoneplusplus/coc-client';
import { validateBrowserUrl } from './browser-view-policy';

/** IPC is a separate trust boundary from server tool argument validation. */
export function validateBrowserCommandRequest(input: unknown): BrowserCommandRequest {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid browser request');
    const request = input as BrowserCommandRequest;
    if (Object.keys(request).some(key => !['id', 'turnId', 'workspaceId', 'processId', 'command', 'selectedTab'].includes(key))) throw new TypeError('Invalid browser request field');
    if (request.turnId !== undefined && (typeof request.turnId !== 'string' || !request.turnId || request.turnId.length > 512)) throw new TypeError('Invalid browser turn');
    for (const key of ['id', 'workspaceId', 'processId'] as const) {
        if (typeof request[key] !== 'string' || !request[key] || request[key].length > 512) throw new TypeError(`Invalid browser ${key}`);
    }
    if (request.selectedTab !== undefined && (typeof request.selectedTab !== 'string' || !request.selectedTab || request.selectedTab.length > 1024)) throw new TypeError('Invalid selected tab');
    const command = parseBrowserCommand(request.command);
    for (const key of ['tab', 'ref', 'url', 'text', 'value', 'key', 'direction', 'js'] as const) {
        if (command[key] !== undefined && command[key]!.length > 1_000_000) throw new TypeError(`Invalid browser ${key}`);
    }
    if (command.tab !== undefined && (!command.tab || command.tab.length > 1024)) throw new TypeError('Invalid browser tab');
    if (command.ref !== undefined && !/^e[1-9]\d*$/.test(command.ref)) throw new TypeError('Invalid browser ref');
    if (command.url !== undefined && !validateBrowserUrl(command.url).ok) throw new TypeError('Browser URL must be http or https');
    return request;
}

export const BROWSER_CONTROL_SCOPE_CHANNEL = 'coc-desktop:browser-control-scope';
export const BROWSER_CONTROL_COMMAND_CHANNEL = 'coc-desktop:browser-control-command';
export const BROWSER_CONTROL_CANCEL_CHANNEL = 'coc-desktop:browser-control-cancel';
export const BROWSER_CONTROL_REVEAL_CHANNEL = 'coc-desktop:browser-control-reveal';
export const BROWSER_CONTROL_FOCUSED_CHANNEL = 'coc-desktop:browser-control-focused';
export const BROWSER_CONTROL_ACTIVITY_CHANNEL = 'coc-desktop:browser-control-activity';
export const BROWSER_CONTROL_FINISH_CHANNEL = 'coc-desktop:browser-control-finish';
export const BROWSER_CONTROL_STOP_CHANNEL = 'coc-desktop:browser-control-stop';
export const BROWSER_CONTROL_VISIBLE_CHANNEL = 'coc-desktop:browser-control-visible';

export interface BrowserControlActivityEvent {
    routingOwnerId?: number;
    workspaceId: string;
    processId: string;
    turnId: string;
    routingRef: string;
    viewId: string;
    active: boolean;
    finished?: boolean;
}
