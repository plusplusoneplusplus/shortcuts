/**
 * unifiedBrowserTabs — pure rules for the panel's general-purpose `browser` tab.
 *
 * A browser tab is workspace-owned and session-only: it never reaches storage,
 * so restarting CoC starts with none. Each Browser open is a new tab (no dedupe
 * by URL), and the tab carries the concrete owner the dock targeted when it was
 * opened — that owner is also the identity its temporary site session is keyed
 * by, so changing the dock target never retargets an open tab.
 *
 * URL handling is deliberately narrow: only http(s) is accepted, a bare domain
 * gets `https://` (loopback hosts get `http://`), and arbitrary text is rejected
 * rather than turned into a search query.
 */

import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

export type BrowserUrlResult =
    | { ok: true; url: string }
    | { ok: false; reason: string };

/** The label a tab shows before its page reports a title. */
export const BLANK_BROWSER_LABEL = 'New Tab';

const NOT_A_URL = 'Not a URL. Enter a web address such as example.com.';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HOST_PORT = /^[^/?#:@\s]+:\d+(?:[/?#]|$)/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname === '[::1]'
        || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** A host a bare entry may name: localhost, an IP literal, or a dotted domain with a letter TLD. */
function isPlausibleHost(hostname: string): boolean {
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
    if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
    if (IPV4.test(hostname)) return hostname.split('.').every(part => Number(part) <= 255);
    const labels = hostname.split('.');
    if (labels.length < 2) return false;
    if (!labels.every(label => LABEL.test(label) || /^xn--/i.test(label))) return false;
    return /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(labels[labels.length - 1]);
}

/**
 * Normalize what the user typed or pasted into a loadable http(s) URL.
 *
 * - `http://…` / `https://…` are parsed as-is.
 * - Any other scheme (`file:`, `javascript:`, `ftp://`, …) is unsupported.
 * - A bare `host[:port][/path]` gets `https://`, or `http://` for loopback.
 * - Text with spaces, or a bare word with no domain shape, is not a URL.
 */
export function normalizeBrowserUrl(input: string): BrowserUrlResult {
    const text = input.trim();
    if (text === '') return { ok: false, reason: 'Enter a URL.' };
    const scheme = SCHEME.exec(text);
    const hasScheme = scheme !== null && !HOST_PORT.test(text);
    if (hasScheme) {
        const protocol = scheme[1].toLowerCase();
        if (protocol !== 'http' && protocol !== 'https') {
            return { ok: false, reason: `${protocol}: URLs are not supported. Use http or https.` };
        }
        let url: URL;
        try {
            url = new URL(text);
        } catch {
            return { ok: false, reason: 'That URL is malformed.' };
        }
        if (url.hostname === '') return { ok: false, reason: 'That URL has no host.' };
        return { ok: true, url: url.href };
    }
    if (/\s/.test(text)) return { ok: false, reason: NOT_A_URL };
    if (text.startsWith('//') || text.startsWith('/')) {
        return { ok: false, reason: NOT_A_URL };
    }
    let url: URL;
    try {
        url = new URL(`https://${text}`);
    } catch {
        return { ok: false, reason: NOT_A_URL };
    }
    if (url.username !== '' || url.password !== '' || !isPlausibleHost(url.hostname)) {
        return { ok: false, reason: NOT_A_URL };
    }
    if (isLoopbackHost(url.hostname)) url.protocol = 'http:';
    return { ok: true, url: url.href };
}

const URL_LIKE_SCHEME = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data|file|mailto|about|blob|view-source|chrome):)/i;

/**
 * Whether text was clearly written as a URL with a scheme (`x://…`, or a
 * well-known non-web scheme such as `javascript:`), as opposed to a bare
 * `host:port` or a file-search query like `todo: fix`.
 */
export function hasExplicitUrlScheme(input: string): boolean {
    return URL_LIKE_SCHEME.test(input.trim());
}

/** The label a tab shows for a URL before its page reports a title. */
export function browserLabelForUrl(url: string | undefined): string {
    if (!url) return BLANK_BROWSER_LABEL;
    try {
        return new URL(url).host || BLANK_BROWSER_LABEL;
    } catch {
        return BLANK_BROWSER_LABEL;
    }
}

let browserSequence = 0;

/** A fresh, page-unique browser tab resource id; also the desktop view id. */
export function newBrowserResourceId(): string {
    browserSequence += 1;
    return `browser-${Date.now().toString(36)}-${browserSequence}`;
}

export interface BrowserOpenContext {
    /** The concrete workspace the dock targeted — the tab's owner and session identity. */
    ownerWorkspaceId: string;
    ownerRoutingRef?: string | null;
    chatId: string | null;
    repoLabel?: string;
}

/** A new browser tab, blank or pointed at an already-normalized URL. */
export function browserOpenInput(context: BrowserOpenContext, url?: string): OpenUnifiedTabInput {
    return {
        kind: 'browser',
        ownerWorkspaceId: context.ownerWorkspaceId,
        ...(context.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: context.ownerRoutingRef }),
        chatId: context.chatId,
        resourceId: newBrowserResourceId(),
        label: browserLabelForUrl(url),
        ...(context.repoLabel ? { repoLabel: context.repoLabel } : {}),
        ...(url ? { browserUrl: url } : {}),
    };
}

/**
 * The temporary site-session identity of a tab: its concrete owner. Tabs of
 * one concrete workspace share sign-ins; another workspace or clone host does
 * not.
 */
export function browserSessionKey(tab: { ownerWorkspaceId: string; ownerRoutingRef?: string | null }): string {
    return tab.ownerRoutingRef || tab.ownerWorkspaceId;
}
