/**
 * unifiedPanelOpenMenuModel — the pure model behind the unified panel's
 * searchable "+" menu (AC-03).
 *
 * The menu mixes three sources into one keyboard-navigable list: the resource
 * actions the current target actually offers, the canvases already linked to
 * the selected chat, and server-side file search results. Everything about
 * *which* entries exist, in what order, and which of them a cursor may land on
 * lives here; the component owns only the fetching and the DOM.
 *
 * Three rules this module encodes:
 *
 *  1. **Unavailable is hidden, unusable is disabled with a reason.** A repo
 *     group's own root has no file tree, so Explorer is not listed at all. A
 *     target that is offline or invalid still lists Terminal/Explorer,
 *     disabled, saying why — a missing item and a blocked item are different
 *     messages to the user.
 *  2. **Canvas needs a chat.** With no chat selected the action stays visible
 *     and disabled: creating an unowned canvas is not an option we offer.
 *  3. **Disabled entries are skipped by the keyboard**, not merely ignored on
 *     Enter, so arrowing through the list can never park on something that does
 *     nothing.
 *
 * Selection turns into an `OpenUnifiedTabInput` here too, so the identity a
 * search result opens with — normalized path, owning clone, chat scope — is
 * decided by testable code rather than by the click handler.
 */

import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** The non-search entries the menu offers. */
export type OpenMenuActionId = 'terminal' | 'explorer' | 'notes' | 'canvas' | 'changes';

export interface OpenMenuAction {
    id: OpenMenuActionId;
    label: string;
    /** Short right-aligned hint, e.g. the repo an action would act on. */
    hint?: string;
    /** Listed but not selectable; `disabledReason` says why. */
    disabled?: boolean;
    disabledReason?: string;
}

export interface OpenMenuActionsInput {
    /** The workspace new Terminal/Explorer/file resources open against. */
    targetWorkspaceId: string;
    /** The target is a stale group member or an unreachable clone. */
    targetUnavailable?: boolean;
    /** Why the target cannot be used, shown on the disabled entries. */
    targetUnavailableReason?: string;
    /** The selected chat, or null when none is. Gates the Canvas action. */
    chatId: string | null;
    /**
     * The selected chat has recorded at least one completed file change. Gates
     * the Changes entry, which is omitted rather than disabled: a chat that
     * edited nothing has no diff to explain, so an always-present dead row
     * would be noise on every read-only conversation.
     */
    chatHasChanges?: boolean;
}

/**
 * The action rows for a target + chat selection, in menu order.
 *
 * Explorer is omitted (not disabled) when the target has no single file tree: a
 * repo group's own root is the synthetic `~/.coc/repos/group-<name>` directory,
 * so a tree there would be meaningless. Selecting it toggles the panel's
 * file-tree column rather than opening a tab — the entry keeps its position and
 * label, but the Explorer is no longer a tab kind. Notes stays enabled even for
 * an unavailable target: notes belong to the panel's workspace, not to the repo
 * the terminal points at.
 *
 * Changes is the one entry that can be absent for a reason other than the
 * target: it opens the selected chat's own recorded edits, so it appears only
 * once that chat has some. It is not gated on the target's availability either
 * — the diff is replayed from the transcript, not read from the repo.
 */
export function openMenuActions(input: OpenMenuActionsInput): OpenMenuAction[] {
    const blocked = input.targetUnavailable === true;
    const reason = input.targetUnavailableReason ?? 'This repository is unavailable.';
    // Terminal and Explorer act on the target repo, so they are the two the
    // target's availability gates.
    const repoGate = blocked ? { disabled: true, disabledReason: reason } : {};

    const actions: OpenMenuAction[] = [
        { id: 'terminal', label: 'New Terminal', ...repoGate },
    ];
    if (!isRepoGroupWorkspaceId(input.targetWorkspaceId)) {
        actions.push({ id: 'explorer', label: 'Explorer', ...repoGate });
    }
    actions.push({ id: 'notes', label: 'Notes' });
    actions.push({
        id: 'canvas',
        label: 'New Canvas',
        ...(input.chatId === null
            ? { disabled: true, disabledReason: 'Select a chat first — a canvas belongs to a chat.' }
            : {}),
    });
    // Listed after New Canvas, and only for a chat that actually changed
    // files — with no chat selected there is nothing to show either.
    if (input.chatId !== null && input.chatHasChanges === true) {
        actions.push({ id: 'changes', label: 'Changes' });
    }
    return actions;
}

/** One server-side file search hit, with the match indices the scorer produced. */
export interface OpenMenuFileResult {
    path: string;
    indices?: readonly number[];
}

/** One canvas already linked to the selected chat. */
export interface OpenMenuCanvasResult {
    id: string;
    title: string;
}

export type OpenMenuItem =
    | { key: string; type: 'action'; action: OpenMenuAction }
    | { key: string; type: 'file'; file: OpenMenuFileResult }
    | { key: string; type: 'canvas'; canvas: OpenMenuCanvasResult };

export interface BuildOpenMenuItemsInput {
    actions: readonly OpenMenuAction[];
    files: readonly OpenMenuFileResult[];
    canvases: readonly OpenMenuCanvasResult[];
    query: string;
}

/**
 * Flatten the three sources into the single list the cursor walks.
 *
 * With no query the menu is a plain action list (plus the chat's canvases):
 * opening it costs no network and shows what is openable. With a query, file
 * results come first — the top hit is what Enter should open — followed by the
 * actions and canvases whose labels still match, so "term" reaches New Terminal
 * without leaving the search box.
 */
export function buildOpenMenuItems(input: BuildOpenMenuItemsInput): OpenMenuItem[] {
    const query = input.query.trim().toLowerCase();
    const matches = (text: string) => query === '' || text.toLowerCase().includes(query);

    const actionItems: OpenMenuItem[] = input.actions
        .filter(action => matches(action.label))
        .map(action => ({ key: `action:${action.id}`, type: 'action', action }));
    const canvasItems: OpenMenuItem[] = input.canvases
        .filter(canvas => matches(canvas.title))
        .map(canvas => ({ key: `canvas:${canvas.id}`, type: 'canvas', canvas }));
    const fileItems: OpenMenuItem[] = query === ''
        ? []
        : input.files.map(file => ({ key: `file:${file.path}`, type: 'file', file }));

    return query === ''
        ? [...actionItems, ...canvasItems]
        : [...fileItems, ...actionItems, ...canvasItems];
}

/** Whether the cursor may land on an item. Only actions can be disabled. */
export function isOpenMenuItemEnabled(item: OpenMenuItem): boolean {
    return item.type !== 'action' || item.action.disabled !== true;
}

/**
 * The next selectable index walking `delta` from `from`, wrapping around.
 * Returns -1 when nothing in the list is selectable, so the caller can render a
 * cursor-less menu rather than a cursor on a dead row.
 */
export function nextOpenMenuIndex(items: readonly OpenMenuItem[], from: number, delta: number): number {
    if (items.length === 0) return -1;
    for (let step = 1; step <= items.length; step++) {
        const index = (((from + delta * step) % items.length) + items.length) % items.length;
        if (isOpenMenuItemEnabled(items[index])) return index;
    }
    return -1;
}

/** The first selectable index, or -1. Used whenever the item list changes. */
export function firstOpenMenuIndex(items: readonly OpenMenuItem[]): number {
    const index = items.findIndex(isOpenMenuItemEnabled);
    return index;
}

/**
 * Canonical repo-relative path: no leading `./` or `/`, no duplicate or
 * trailing separators. Two entry points spelling the same file differently must
 * reach the same tab id, so normalization happens before identity is derived.
 */
export function normalizeResourcePath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

/** The file name segment of a path, for the tab label. */
export function resourcePathName(path: string): string {
    const normalized = normalizeResourcePath(path);
    const index = normalized.lastIndexOf('/');
    return index < 0 ? normalized : normalized.slice(index + 1);
}

export interface OpenMenuTargetContext {
    /** The clone the resource's bytes come from — where requests must route. */
    ownerWorkspaceId: string;
    /** Concrete clone route for file reads and language transport. */
    ownerRoutingRef?: string | null;
    /** The panel's own workspace; a differing owner earns a repo label. */
    scopeWorkspaceId: string;
    /** Label for the owning repo, shown when it is not the panel's own. */
    ownerLabel?: string;
    chatId: string | null;
}

/**
 * The tab a file search hit opens. Files follow the selected chat (workspace
 * when none), carry the owning clone, and are editable: the "+" menu is an
 * authorized Explorer-equivalent entry point, unlike a chat source link.
 */
export function fileOpenInput(path: string, context: OpenMenuTargetContext): OpenUnifiedTabInput {
    const resourceId = normalizeResourcePath(path);
    return {
        kind: 'file',
        ownerWorkspaceId: context.ownerWorkspaceId,
        ...(context.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: context.ownerRoutingRef }),
        chatId: context.chatId,
        resourceId,
        label: resourcePathName(resourceId),
        ...(repoLabelFor(context) ?? {}),
    };
}

/**
 * The tab a chat-linked canvas opens. A canvas is owned by the chat it is
 * linked to, so this is only ever called with a chat selected.
 */
export function canvasOpenInput(canvas: OpenMenuCanvasResult, context: OpenMenuTargetContext): OpenUnifiedTabInput {
    return {
        kind: 'canvas',
        ownerWorkspaceId: context.ownerWorkspaceId,
        chatId: context.chatId,
        resourceId: canvas.id,
        label: canvas.title.trim() === '' ? 'Untitled canvas' : canvas.title,
        ...(repoLabelFor(context) ?? {}),
    };
}

function repoLabelFor(context: OpenMenuTargetContext): { repoLabel: string } | null {
    if (context.ownerWorkspaceId === context.scopeWorkspaceId) return null;
    if (!context.ownerLabel) return null;
    return { repoLabel: context.ownerLabel };
}
