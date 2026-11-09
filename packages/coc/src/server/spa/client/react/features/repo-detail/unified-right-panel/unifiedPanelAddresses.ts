/**
 * unifiedPanelAddresses — the `coc://` pages a web tab can show.
 *
 * To-do, Settings, Terminal, Canvas and Notes exist only as these pages; there is no
 * dedicated tab kind for them. An address names a page only, never an owner:
 * the panel resolves the owner from the tab and the selected chat, so text can
 * never route a repo group or remote clone to the wrong repo.
 * `coc://` is parsed here only; it never reaches a webview, browser URL
 * normalization, history or site approval.
 */

import { decodePath, encodePath } from '../../../layout/routePath';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';
import type { PersistedGitView } from '../../git/repoGitTab/types';

export type CocAddress =
    | { kind: 'settings' }
    | { kind: 'terminal' }
    | { kind: 'todo'; itemId?: string }
    | { kind: 'canvas'; canvasId: string }
    | { kind: 'notes'; notePath?: string }
    | { kind: 'git'; gitMemberId?: string; view?: PersistedGitView };

/** Canvas ids, matching `canvas://` embeds: 1–128 letters, digits or hyphens. */
const CANVAS_ID = /^[a-z0-9][a-z0-9-]{0,127}$/i;

/** The structural marker that introduces a group route's member id. */
const GIT_ROUTE_MEMBER_MARKER = 'member';

/**
 * The sha-or-sentinel vocabulary a `coc://git` path segment may hold.
 */
const GIT_BRANCH_RANGE_SENTINEL = 'branch-range';
const GIT_WORKING_CHANGES_SENTINEL = 'working-changes';

/** The `{ hash, filePath? }` route segments a `PersistedGitView` formats as, or null when the view has no URL form (e.g. `working-tree-file`, `multi-commit`). */
function gitRouteSegmentsOf(view: PersistedGitView): { hash: string; filePath?: string } | null {
    switch (view.type) {
        case 'commit': return { hash: view.hash };
        case 'commit-file': return { hash: view.hash, filePath: view.filePath };
        case 'branch-range': return { hash: GIT_BRANCH_RANGE_SENTINEL };
        case 'branch-file': return { hash: GIT_BRANCH_RANGE_SENTINEL, filePath: view.filePath };
        case 'working-tree-all': return { hash: GIT_WORKING_CHANGES_SENTINEL };
        default: return null;
    }
}

/** The `PersistedGitView` a decoded `{ hash, filePath? }` route segment pair names. */
function gitViewOfRouteSegments(hash: string, filePath: string | null): PersistedGitView {
    if (hash === GIT_BRANCH_RANGE_SENTINEL) return filePath ? { type: 'branch-file', filePath } : { type: 'branch-range' };
    if (hash === GIT_WORKING_CHANGES_SENTINEL) return { type: 'working-tree-all' };
    return filePath ? { type: 'commit-file', hash, filePath } : { type: 'commit', hash };
}

/** The `coc://git` address suffix (after the host) for a member id and/or view. */
function gitAddressSuffix(address: { gitMemberId?: string; view?: PersistedGitView }): string {
    let suffix = '';
    if (address.gitMemberId) suffix += `/${GIT_ROUTE_MEMBER_MARKER}/${encodeURIComponent(address.gitMemberId)}`;
    const segments = address.view ? gitRouteSegmentsOf(address.view) : null;
    if (segments) {
        suffix += `/${encodeURIComponent(segments.hash)}`;
        if (segments.filePath) suffix += `/${encodeURIComponent(segments.filePath)}`;
    }
    return suffix;
}

/**
 * Stable browser-tab resource id for one canvas in one chat. Opening that
 * canvas again focuses this tab; another chat gets its own page.
 */
export function canvasPageResourceId(chatId: string | null, canvasId: string): string {
    return `coc-canvas:${encodeURIComponent(chatId ?? '')}:${canvasId}`;
}

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
    if (host === 'canvas') {
        if (parts.length !== 2) return { error: COC_ADDRESS_INVALID };
        let canvasId: string;
        try { canvasId = decodeURIComponent(parts[1]); } catch { return { error: COC_ADDRESS_INVALID }; }
        return CANVAS_ID.test(canvasId) ? { kind: 'canvas', canvasId } : { error: COC_ADDRESS_INVALID };
    }
    if (host === 'notes') {
        if (parts.length === 1) return { kind: 'notes' };
        let notePath: string;
        try { notePath = decodePath(parts.slice(1)); } catch { return { error: COC_ADDRESS_INVALID }; }
        if (!isNoteDeepPath(notePath)) return { error: COC_ADDRESS_INVALID };
        return { kind: 'notes', notePath };
    }
    if (host === 'git') {
        let rest = parts.slice(1);
        let gitMemberId: string | undefined;
        if (rest[0] === GIT_ROUTE_MEMBER_MARKER) {
            if (rest.length === 1) {
                // `member` with nothing after is an incomplete link, not a commit
                // called "member" — mirrors gitRoute.ts's group-route handling.
                rest = [];
            } else {
                try { gitMemberId = decodeURIComponent(rest[1]); } catch { return { error: COC_ADDRESS_INVALID }; }
                rest = rest.slice(2);
            }
        }
        if (rest.length > 2) return { error: COC_ADDRESS_INVALID };
        let hash: string | undefined;
        let filePath: string | undefined;
        try {
            if (rest[0]) hash = decodeURIComponent(rest[0]);
            if (rest[0] && rest[1]) filePath = decodeURIComponent(rest[1]);
        } catch { return { error: COC_ADDRESS_INVALID }; }
        const view = hash ? gitViewOfRouteSegments(hash, filePath ?? null) : undefined;
        return { kind: 'git', ...(gitMemberId !== undefined ? { gitMemberId } : {}), ...(view ? { view } : {}) };
    }
    return { error: COC_ADDRESS_UNSUPPORTED };
}

/** A note path a deep `coc://notes/…` address may name: relative, with no empty or parent segments. */
function isNoteDeepPath(path: string): boolean {
    if (!path || path.includes('\\')) return false;
    return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
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
    if (address.kind === 'canvas') return `coc://canvas/${encodeURIComponent(address.canvasId)}`;
    if (address.kind === 'notes' && address.notePath) return `coc://notes/${encodePath(address.notePath)}`;
    if (address.kind === 'git') return `coc://git${gitAddressSuffix(address)}`;
    return `coc://${address.kind}`;
}

/** The canvas id a `coc://canvas/…` address names, or null. */
export function canvasIdOfAddress(url: string | undefined): string | null {
    if (!url || !isCocAddressText(url)) return null;
    const address = parseCocAddress(url);
    return 'error' in address || address.kind !== 'canvas' ? null : address.canvasId;
}

/** The tab label of a `coc://` page. A canvas page uses this until its title loads. */
export function cocAddressLabel(address: CocAddress): string {
    if (address.kind === 'settings') return 'Settings';
    if (address.kind === 'terminal') return 'Terminal';
    if (address.kind === 'canvas') return 'Canvas';
    if (address.kind === 'notes') return 'Notes';
    if (address.kind === 'git') return 'Git';
    return 'To-do';
}

/**
 * A resolved `coc://` page: the address plus the owner the panel chose when it
 * was opened. A web tab keeps it in memory, so a later chat or target change
 * never re-routes a page already showing.
 */
export type CocPage =
    | { kind: 'settings'; ownerKey: string }
    | { kind: 'terminal'; ownerWorkspaceId: string; ownerRoutingRef?: string | null }
    | { kind: 'todo'; owner: SentinelTodoOwner; scopeWorkspaceId: string; chatId: string }
    | {
        kind: 'canvas';
        canvasId: string;
        /** The workspace whose canvas API serves this document. */
        ownerWorkspaceId: string;
        ownerRoutingRef?: string | null;
        scopeWorkspaceId: string;
        /** The conversation the canvas is linked to. */
        chatId: string;
        repoLabel?: string;
    }
    | {
        kind: 'notes';
        /** The panel workspace whose Notes collection this page shows. */
        ownerWorkspaceId: string;
        ownerRoutingRef?: string | null;
        /** The note the deep address selected, or null for the collection. */
        notePath: string | null;
    }
    | {
        kind: 'git';
        /** The workspace whose git data this page shows. */
        ownerWorkspaceId: string;
        ownerRoutingRef?: string | null;
        gitMemberId?: string;
        view?: PersistedGitView;
    };
