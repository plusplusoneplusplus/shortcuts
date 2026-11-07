/**
 * unifiedPanelAddresses — the `coc://` addresses the panel address bar shows
 * and accepts (`features.panelAddressBar`).
 *
 * Phase 1 covers To-do, Settings and Terminal. An address names a tab kind
 * only, never an owner: the panel resolves the owner the same way its "+" menu
 * does, so text can never route a repo group or remote clone to the wrong
 * repo. `coc://` is parsed here only; it never reaches a webview, browser URL
 * normalization, history or site approval.
 */

import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

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

/** The canonical text of an address. */
export function formatCocAddress(address: CocAddress): string {
    if (address.kind === 'todo' && address.itemId) return `coc://todo/${encodeURIComponent(address.itemId)}`;
    return `coc://${address.kind}`;
}

/**
 * The address shown for a tab, or null for every kind outside phase 1. A
 * To-do tab includes its selected item.
 */
export function cocAddressForTab(tab: Pick<UnifiedPanelTab, 'kind'> | null | undefined, todoSelection?: string | null): string | null {
    if (!tab) return null;
    if (tab.kind === 'settings' || tab.kind === 'terminal') return formatCocAddress({ kind: tab.kind });
    if (tab.kind === 'todo') return formatCocAddress({ kind: 'todo', ...(todoSelection ? { itemId: todoSelection } : {}) });
    return null;
}
