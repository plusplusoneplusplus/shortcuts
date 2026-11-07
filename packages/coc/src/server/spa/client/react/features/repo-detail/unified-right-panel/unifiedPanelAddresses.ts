/**
 * unifiedPanelAddresses — the `coc://` pages a web tab can show.
 *
 * To-do, Settings and Terminal exist only as these pages; there is no
 * dedicated tab kind for them. An address names a page only, never an owner:
 * the panel resolves the owner from the tab and the selected chat, so text can
 * never route a repo group or remote clone to the wrong repo.
 * `coc://` is parsed here only; it never reaches a webview, browser URL
 * normalization, history or site approval.
 */

import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

export type CocAddress =
    | { kind: 'settings' }
    | { kind: 'terminal' }
    | { kind: 'todo'; itemId?: string };

export const COC_ADDRESS_UNSUPPORTED = 'Not supported yet';
export const COC_ADDRESS_INVALID = 'Not a valid coc:// address';

const COC_SCHEME = /^coc:\/\//i;

/** Whether `text` is written as a `coc://` address (valid or not). */
export function isCocAddressText(text: string): boolean {
    return COC_SCHEME.test(text.trim());
}

/**
 * Parse a typed address. Scheme and host are case-insensitive and a trailing
 * `/` is ignored; query and hash are rejected. Unknown hosts are unsupported,
 * never handed on to the web browser.
 */
export function parseCocAddress(text: string): CocAddress | { error: string } {
    const trimmed = text.trim();
    if (!COC_SCHEME.test(trimmed)) return { error: COC_ADDRESS_INVALID };
    const rest = trimmed.slice('coc://'.length);
    if (/[?#\s]/.test(rest)) return { error: COC_ADDRESS_INVALID };
    const parts = rest.replace(/\/+$/, '').split('/');
    const host = parts[0].toLowerCase();
    if (!host || parts.some(part => part === '')) return { error: COC_ADDRESS_INVALID };
    if (host === 'settings' || host === 'terminal') {
        return parts.length === 1 ? { kind: host } : { error: COC_ADDRESS_INVALID };
    }
    if (host === 'todo') {
        if (parts.length === 1) return { kind: 'todo' };
        if (parts.length > 2) return { error: COC_ADDRESS_INVALID };
        let itemId: string;
        try { itemId = decodeURIComponent(parts[1]); } catch { return { error: COC_ADDRESS_INVALID }; }
        return { kind: 'todo', itemId };
    }
    return { error: COC_ADDRESS_UNSUPPORTED };
}

/** The page a tab URL shows, or null for a web page, a blank tab or an invalid address. */
export function cocPageKindOf(url: string | undefined): CocAddress['kind'] | null {
    if (!url || !isCocAddressText(url)) return null;
    const address = parseCocAddress(url);
    return 'error' in address ? null : address.kind;
}

/** The canonical text of an address. */
export function formatCocAddress(address: CocAddress): string {
    if (address.kind === 'todo' && address.itemId) return `coc://todo/${encodeURIComponent(address.itemId)}`;
    return `coc://${address.kind}`;
}

/** The tab label of a `coc://` page. */
export function cocAddressLabel(address: CocAddress): string {
    return address.kind === 'settings' ? 'Settings' : address.kind === 'terminal' ? 'Terminal' : 'To-do';
}

/**
 * A resolved `coc://` page: the address plus the owner the panel chose when it
 * was opened. A web tab keeps it in memory, so a later chat or target change
 * never re-routes a page already showing.
 */
export type CocPage =
    | { kind: 'settings'; ownerKey: string }
    | { kind: 'terminal'; ownerWorkspaceId: string; ownerRoutingRef?: string | null }
    | { kind: 'todo'; owner: SentinelTodoOwner; scopeWorkspaceId: string; chatId: string };
