/**
 * chat-folder-drag — the drag payloads, drop-target arithmetic and auto-scroll
 * maths behind filing chats by drag (AC-07).
 *
 * Chat rows are *already* draggable: they emit a session-context payload so a
 * chat can be dropped into a composer. Folder filing deliberately reuses that
 * same gesture rather than inventing a second one — the drag writes a second
 * custom MIME alongside the session-context one, and the drop target decides
 * what the gesture meant. Composers keep reading the session-context MIME and
 * are untouched; folder targets read `CHAT_FOLDER_MOVE_MIME` and nothing else.
 *
 * Everything here is pure: no React, no DOM lookups, no network. The two
 * modules that consume it are `useChatFolderDragDrop` (state machine) and
 * `useChatListDragAutoScroll` (the edge-scroll timer).
 */

import type { ChatFolder } from '@plusplusoneplusplus/coc-client';
import { sortChatFolders } from './chat-folder-tree';

/**
 * Read ONLY by folder drop targets. A composer, the "+ New chat" button and the
 * queue's reorder handler all ignore it, so one gesture can mean two things
 * without either target having to know about the other.
 */
export const CHAT_FOLDER_MOVE_MIME = 'application/vnd.coc.chat-folder-move+json';
export const CHAT_FOLDER_MOVE_DRAG_KIND = 'coc.chat-folder-move';

/**
 * A *folder row* being dragged to reorder the folder list. A distinct MIME from
 * the move payload because the two gestures accept different targets: a folder
 * may be dropped between folders, never onto a chat row.
 */
export const CHAT_FOLDER_REORDER_MIME = 'application/vnd.coc.chat-folder-reorder+json';
export const CHAT_FOLDER_REORDER_DRAG_KIND = 'coc.chat-folder-reorder';

export interface ChatFolderMoveDragPayload {
    kind: typeof CHAT_FOLDER_MOVE_DRAG_KIND;
    version: 1;
    /** Folders are per-workspace; a drop from another workspace is refused. */
    workspaceId: string;
    /** The whole selection when the drag started inside one, else a single id. */
    processIds: string[];
}

export interface ChatFolderReorderDragPayload {
    kind: typeof CHAT_FOLDER_REORDER_DRAG_KIND;
    version: 1;
    workspaceId: string;
    folderId: string;
}

/** The minimum of `DataTransfer` these helpers touch, so tests can fake it. */
export type ChatFolderDataTransfer = {
    setData: (format: string, data: string) => void;
    getData: (format: string) => string;
    types?: Iterable<string> | ArrayLike<string>;
    effectAllowed?: DataTransfer['effectAllowed'];
    dropEffect?: DataTransfer['dropEffect'];
};

function typeList(dataTransfer: Pick<ChatFolderDataTransfer, 'types'> | null | undefined): string[] {
    const types = dataTransfer?.types;
    if (!types) {return [];}
    return Array.from(types as Iterable<string>);
}

// ────────────────────────────────────────────────────────────────────────────
// Move payload (a chat row dragged onto a folder)
// ────────────────────────────────────────────────────────────────────────────

export function createChatFolderMoveDragPayload(
    workspaceId: string | null | undefined,
    processIds: readonly string[],
): ChatFolderMoveDragPayload | null {
    const safeWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    if (!safeWorkspaceId) {return null;}
    const ids: string[] = [];
    for (const id of processIds) {
        if (typeof id !== 'string') {continue;}
        const trimmed = id.trim();
        if (trimmed.length > 0 && !ids.includes(trimmed)) {ids.push(trimmed);}
    }
    if (ids.length === 0) {return null;}
    return {
        kind: CHAT_FOLDER_MOVE_DRAG_KIND,
        version: 1,
        workspaceId: safeWorkspaceId,
        processIds: ids,
    };
}

/**
 * Add the folder-move flavour to a drag that may already carry session context.
 *
 * `effectAllowed` is widened to `'copyMove'` because the same gesture can end
 * as a copy (attach to a composer) or a move (file into a folder) — each drop
 * target then sets its own `dropEffect`, so the cursor tells the truth.
 * `text/plain` is deliberately NOT written here: the session-context writer
 * already owns that flavour and overwriting it would change what a drop into a
 * plain text field pastes.
 */
export function writeChatFolderMoveDragData(
    dataTransfer: ChatFolderDataTransfer,
    payload: ChatFolderMoveDragPayload,
): void {
    dataTransfer.setData(CHAT_FOLDER_MOVE_MIME, JSON.stringify(payload));
    dataTransfer.effectAllowed = 'copyMove';
}

export function dataTransferHasChatFolderMove(
    dataTransfer: Pick<ChatFolderDataTransfer, 'types'> | null | undefined,
): boolean {
    return typeList(dataTransfer).includes(CHAT_FOLDER_MOVE_MIME);
}

export function readChatFolderMoveDragPayload(
    dataTransfer: Pick<ChatFolderDataTransfer, 'getData' | 'types'> | null | undefined,
): ChatFolderMoveDragPayload | null {
    if (!dataTransfer || !dataTransferHasChatFolderMove(dataTransfer)) {return null;}
    return parseMovePayload(safeGetData(dataTransfer, CHAT_FOLDER_MOVE_MIME));
}

// ────────────────────────────────────────────────────────────────────────────
// Reorder payload (a folder row dragged between folders)
// ────────────────────────────────────────────────────────────────────────────

export function createChatFolderReorderDragPayload(
    workspaceId: string | null | undefined,
    folderId: string | null | undefined,
): ChatFolderReorderDragPayload | null {
    const safeWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    const safeFolderId = typeof folderId === 'string' ? folderId.trim() : '';
    if (!safeWorkspaceId || !safeFolderId) {return null;}
    return {
        kind: CHAT_FOLDER_REORDER_DRAG_KIND,
        version: 1,
        workspaceId: safeWorkspaceId,
        folderId: safeFolderId,
    };
}

export function writeChatFolderReorderDragData(
    dataTransfer: ChatFolderDataTransfer,
    payload: ChatFolderReorderDragPayload,
): void {
    dataTransfer.setData(CHAT_FOLDER_REORDER_MIME, JSON.stringify(payload));
    dataTransfer.setData('text/plain', payload.folderId);
    dataTransfer.effectAllowed = 'move';
}

export function dataTransferHasChatFolderReorder(
    dataTransfer: Pick<ChatFolderDataTransfer, 'types'> | null | undefined,
): boolean {
    return typeList(dataTransfer).includes(CHAT_FOLDER_REORDER_MIME);
}

export function readChatFolderReorderDragPayload(
    dataTransfer: Pick<ChatFolderDataTransfer, 'getData' | 'types'> | null | undefined,
): ChatFolderReorderDragPayload | null {
    if (!dataTransfer || !dataTransferHasChatFolderReorder(dataTransfer)) {return null;}
    return parseReorderPayload(safeGetData(dataTransfer, CHAT_FOLDER_REORDER_MIME));
}

function safeGetData(dataTransfer: Pick<ChatFolderDataTransfer, 'getData'>, mime: string): string {
    try {
        return dataTransfer.getData(mime) ?? '';
    } catch {
        // `getData` throws in some browsers while a drag is only being observed
        // (dragover). A target that cannot read the payload simply declines.
        return '';
    }
}

function parseJson(raw: string): any {
    if (!raw) {return null;}
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function parseMovePayload(raw: string): ChatFolderMoveDragPayload | null {
    const parsed = parseJson(raw);
    if (!parsed || parsed.kind !== CHAT_FOLDER_MOVE_DRAG_KIND || parsed.version !== 1) {return null;}
    return createChatFolderMoveDragPayload(parsed.workspaceId, Array.isArray(parsed.processIds) ? parsed.processIds : []);
}

function parseReorderPayload(raw: string): ChatFolderReorderDragPayload | null {
    const parsed = parseJson(raw);
    if (!parsed || parsed.kind !== CHAT_FOLDER_REORDER_DRAG_KIND || parsed.version !== 1) {return null;}
    return createChatFolderReorderDragPayload(parsed.workspaceId, parsed.folderId);
}

// ────────────────────────────────────────────────────────────────────────────
// Drop-target arithmetic
// ────────────────────────────────────────────────────────────────────────────

/**
 * What a folder row is currently offering the pointer.
 *  - `into`  — file the dragged chats here (accent tint + dashed outline)
 *  - `above` / `below` — reorder insertion line (folder drag only)
 */
export type ChatFolderDropMode = 'into' | 'above' | 'below';

export interface ChatFolderDropTarget {
    folderId: string;
    mode: ChatFolderDropMode;
}

/** The part of a folder subtree the pointer is over. */
export type ChatFolderDropZone = 'row' | 'body';

export interface ResolveFolderDropTargetInput {
    /** The folder whose row/body is under the pointer. */
    folderId: string;
    zone: ChatFolderDropZone;
    /**
     * Whether the drag advertises each folder MIME. Deliberately booleans, not
     * payloads: `dataTransfer.getData()` is blocked during `dragover` in every
     * browser (only `types` is readable), so highlighting decisions can only
     * ever be made from the MIME list. The payload itself is validated on
     * `drop`, where reading it is allowed.
     */
    hasMove: boolean;
    hasReorder: boolean;
    /** The folder row this list is currently dragging, if any. */
    draggingFolderId?: string | null;
    /** Folders the dragged chats are already in — dropping there is a no-op. */
    sourceFolderIds?: ReadonlySet<string> | null;
    /** Pointer Y and the hovered row's box, for the above/below split. */
    clientY?: number;
    rect?: { top: number; height: number } | null;
}

/**
 * Decide what a drop at this position would do, or `null` for "not a target"
 * (in which case the caller must NOT call `preventDefault`, so the browser
 * never fires a `drop` here and the drag stays available to its real target).
 *
 * The rules, straight from the AC:
 *  - a chat move is accepted on a folder row and anywhere in its expanded body;
 *  - a folder reorder is accepted only between folder *rows*, never in a body
 *    (that would read as nesting, which is v2) and never onto itself;
 *  - a drag carrying neither folder MIME — a queue reorder, an OS file, a text
 *    selection — is not a folder target at all.
 */
export function resolveFolderDropTarget(input: ResolveFolderDropTargetInput): ChatFolderDropTarget | null {
    const { folderId, zone, hasMove, hasReorder } = input;
    if (!folderId) {return null;}

    if (hasReorder) {
        // Dropping a folder into a folder's body would mean nesting.
        if (zone !== 'row') {return null;}
        if (input.draggingFolderId && input.draggingFolderId === folderId) {return null;}
        return { folderId, mode: splitAboveBelow(input.clientY, input.rect) };
    }

    if (hasMove) {
        // Every dragged row already lives here: nothing to offer.
        if (input.sourceFolderIds && input.sourceFolderIds.size === 1 && input.sourceFolderIds.has(folderId)) {
            return null;
        }
        return { folderId, mode: 'into' };
    }

    return null;
}

/** Above/below by the row's vertical midpoint; defaults to `above` with no box. */
function splitAboveBelow(clientY: number | undefined, rect: { top: number; height: number } | null | undefined): 'above' | 'below' {
    if (typeof clientY !== 'number' || !rect || !Number.isFinite(rect.height)) {return 'above';}
    return clientY >= rect.top + rect.height / 2 ? 'below' : 'above';
}

/**
 * The ids a folder-move drop should actually write, dropping the rows already
 * filed in the target. Dropping a chat onto the folder it is already in must
 * issue no request at all.
 */
export function resolveFolderDropMoveIds(
    payload: ChatFolderMoveDragPayload,
    folderIdByProcess: ReadonlyMap<string, string>,
    targetFolderId: string | null,
): string[] {
    return payload.processIds.filter(id => (folderIdByProcess.get(id) ?? null) !== targetFolderId);
}

/**
 * Reorder the folder list, returning a fresh list with contiguous `sortIndex`
 * values, or `null` when the drop would not change the order (which must issue
 * no requests).
 */
export function reorderChatFolders(
    folders: readonly ChatFolder[],
    draggedFolderId: string,
    targetFolderId: string,
    position: 'above' | 'below',
): ChatFolder[] | null {
    if (draggedFolderId === targetFolderId) {return null;}
    const ordered = sortChatFolders(folders);
    const fromIndex = ordered.findIndex(f => f.id === draggedFolderId);
    const targetIndex = ordered.findIndex(f => f.id === targetFolderId);
    if (fromIndex === -1 || targetIndex === -1) {return null;}

    const [dragged] = ordered.splice(fromIndex, 1);
    // The target's index shifts left when the dragged folder used to sit above it.
    const adjustedTarget = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
    const insertAt = position === 'below' ? adjustedTarget + 1 : adjustedTarget;
    ordered.splice(insertAt, 0, dragged);

    if (ordered[fromIndex]?.id === draggedFolderId) {return null;}
    return ordered.map((folder, index) => ({ ...folder, sortIndex: index }));
}

/**
 * The folders whose `sortIndex` actually changed, so a reorder PATCHes two rows
 * instead of the whole list.
 */
export function diffFolderSortIndexes(
    before: readonly ChatFolder[],
    after: readonly ChatFolder[],
): { id: string; sortIndex: number }[] {
    const previous = new Map(before.map(f => [f.id, f.sortIndex ?? 0]));
    const changed: { id: string; sortIndex: number }[] = [];
    for (const folder of after) {
        const next = folder.sortIndex ?? 0;
        if (previous.get(folder.id) !== next) {changed.push({ id: folder.id, sortIndex: next });}
    }
    return changed;
}

// ────────────────────────────────────────────────────────────────────────────
// Auto-scroll
// ────────────────────────────────────────────────────────────────────────────

/** How close to an edge (px) the pointer must get before the list scrolls. */
export const CHAT_LIST_AUTO_SCROLL_EDGE_PX = 48;
/** Peak scroll step, in px per tick, right at the edge. */
export const CHAT_LIST_AUTO_SCROLL_MAX_STEP_PX = 16;
/** Tick interval for the auto-scroll timer, in ms. */
export const CHAT_LIST_AUTO_SCROLL_INTERVAL_MS = 16;

export interface AutoScrollOptions {
    edgePx?: number;
    maxStepPx?: number;
}

/**
 * Pixels to scroll this tick: negative near the top edge, positive near the
 * bottom, `0` everywhere else (including outside the box entirely, so a drag
 * that leaves the window stops scrolling rather than running away).
 *
 * The step ramps linearly with how deep into the edge band the pointer is, so
 * hovering the very edge scrolls fast and the band's inner boundary is a
 * no-op — no discontinuity when the timer starts.
 */
export function computeDragAutoScrollDelta(
    clientY: number,
    rect: { top: number; bottom: number },
    options: AutoScrollOptions = {},
): number {
    const edge = options.edgePx ?? CHAT_LIST_AUTO_SCROLL_EDGE_PX;
    const maxStep = options.maxStepPx ?? CHAT_LIST_AUTO_SCROLL_MAX_STEP_PX;
    if (!Number.isFinite(clientY) || edge <= 0 || maxStep <= 0) {return 0;}
    if (clientY < rect.top || clientY > rect.bottom) {return 0;}

    const fromTop = clientY - rect.top;
    if (fromTop < edge) {
        return -Math.max(1, Math.round(maxStep * (1 - fromTop / edge)));
    }
    const fromBottom = rect.bottom - clientY;
    if (fromBottom < edge) {
        return Math.max(1, Math.round(maxStep * (1 - fromBottom / edge)));
    }
    return 0;
}
