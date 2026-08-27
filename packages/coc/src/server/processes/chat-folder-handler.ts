/**
 * Chat Folder REST API Handler
 *
 * HTTP API routes for user-created chat folders — a manual organizing layer
 * over the chat list. Folders are stored as `task_groups` rows of type
 * `chat-folder`; membership is one `task_group_members` row per filed process.
 *
 * Modeled on `pin-archive-handler.ts`: folder CRUD is workspace-scoped, and
 * membership is written as a property of the process (single + batch), which
 * is what structurally enforces one folder per row.
 *
 * Generic task-group mutation is deliberately NOT exposed over HTTP — a client
 * must not be able to mutate a live for-each run's group record — so this is a
 * dedicated `/chat-folders` namespace rather than a generic group endpoint.
 */

import { randomUUID } from 'crypto';
import { sendJSON } from '../core/api-handler';
import { parseBodyOrReject, resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import {
    CHAT_FOLDER_GROUP_TYPE,
    type ProcessStore,
    type TaskGroupChildLink,
    type TaskGroupRecord,
    type TaskGroupSummaryRecord,
} from '@plusplusoneplusplus/forge';
import {
    DEFAULT_CHAT_FOLDER_COLOR,
    normalizeChatFolderColor,
    normalizeChatFolderName,
    type ChatFolderColor,
    type ValidationResult,
} from './chat-folder-validation';

// The name/color rules live in a dependency-free module because the SPA's
// inline create/rename row enforces exactly the same ones; re-exported here so
// existing importers of this handler keep working.
export {
    CHAT_FOLDER_COLORS,
    DEFAULT_CHAT_FOLDER_COLOR,
    MAX_CHAT_FOLDER_NAME_LENGTH,
    clampChatFolderNameInput,
    normalizeChatFolderColor,
    normalizeChatFolderName,
} from './chat-folder-validation';
export type { ChatFolderColor, ValidationResult } from './chat-folder-validation';

// ============================================================================
// Types & constants
// ============================================================================

/** Membership role recorded on `task_group_members` for a filed chat. */
export const CHAT_FOLDER_MEMBER_ROLE = 'member';

/** Wire shape of one folder. */
export interface ChatFolder {
    id: string;
    name: string;
    color: ChatFolderColor;
    sortIndex: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Narrow slice of `SqliteTaskGroupStore` this handler needs. Keeping it narrow
 * lets route tests drive the handler with a fake group store.
 */
export interface ChatFolderGroupStore {
    upsertGroup(record: TaskGroupRecord): TaskGroupRecord;
    updateGroup(
        workspaceId: string,
        groupId: string,
        updates: Partial<Pick<TaskGroupRecord, 'title' | 'extra'>> & { updatedAt: string },
    ): TaskGroupSummaryRecord | undefined;
    getGroup(workspaceId: string, groupId: string): TaskGroupSummaryRecord | undefined;
    listGroups(workspaceId: string, options?: { type?: string }): TaskGroupSummaryRecord[];
    linkChild(
        workspaceId: string,
        groupId: string,
        link: Omit<TaskGroupChildLink, 'linkedAt'> & { linkedAt?: string },
    ): void;
    unlinkChild(workspaceId: string, groupId: string, processId: string): number;
    findMembership(
        workspaceId: string,
        processId: string,
        options?: { type?: string },
    ): { groupId: string; link: TaskGroupChildLink } | undefined;
    findGroupAnywhere(groupId: string, options?: { type?: string }): TaskGroupRecord | undefined;
    removeGroup(workspaceId: string, groupId: string): boolean;
}

// ============================================================================
// Record <-> wire mapping
// ============================================================================

function readColor(extra: Record<string, unknown> | undefined): ChatFolderColor {
    const raw = extra?.color;
    const parsed = normalizeChatFolderColor(raw);
    return parsed.ok ? parsed.value : DEFAULT_CHAT_FOLDER_COLOR;
}

function readSortIndex(extra: Record<string, unknown> | undefined): number {
    const raw = extra?.sortIndex;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function toChatFolder(record: TaskGroupRecord): ChatFolder {
    return {
        id: record.groupId,
        name: record.title ?? '',
        color: readColor(record.extra),
        sortIndex: readSortIndex(record.extra),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

/** Manual order: sortIndex ascending, ties broken by createdAt descending. */
export function sortChatFolders(folders: ChatFolder[]): ChatFolder[] {
    return [...folders].sort((a, b) => {
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
        return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });
}

function listFolders(groups: ChatFolderGroupStore, workspaceId: string): ChatFolder[] {
    const records = groups.listGroups(workspaceId, { type: CHAT_FOLDER_GROUP_TYPE });
    return sortChatFolders(records.map(toChatFolder));
}

// ============================================================================
// Membership helpers
// ============================================================================

/**
 * File `processId` into `folderId`, or unfile it when `folderId` is null.
 * One folder per row: any prior membership is removed first.
 */
function applyFolder(
    groups: ChatFolderGroupStore,
    workspaceId: string,
    processId: string,
    folderId: string | null,
): void {
    const existing = groups.findMembership(workspaceId, processId, { type: CHAT_FOLDER_GROUP_TYPE });
    if (existing) {
        if (existing.groupId === folderId) return; // already there — no write
        groups.unlinkChild(workspaceId, existing.groupId, processId);
    }
    if (folderId === null) return;
    groups.linkChild(workspaceId, folderId, { role: CHAT_FOLDER_MEMBER_ROLE, processId });
}

/**
 * Resolve the target folder for a move, or send the failing response.
 * Returns `undefined` when a response was already sent.
 *
 * The folder reference is checked here, at write time, so a concurrent delete
 * makes the move reject instead of filing into a folder that no longer exists.
 */
function resolveTargetFolder(
    groups: ChatFolderGroupStore,
    workspaceId: string,
    folderId: string,
    res: Parameters<typeof sendJSON>[0],
): TaskGroupRecord | undefined {
    const scoped = groups.getGroup(workspaceId, folderId);
    if (scoped && scoped.type === CHAT_FOLDER_GROUP_TYPE) return scoped;

    const anywhere = groups.findGroupAnywhere(folderId, { type: CHAT_FOLDER_GROUP_TYPE });
    if (anywhere) {
        sendJSON(res, 400, { error: 'Folder belongs to a different workspace' });
        return undefined;
    }
    sendJSON(res, 404, { error: 'Folder not found' });
    return undefined;
}

/**
 * The workspace a process belongs to. The canonical home is the metadata
 * envelope; the top-level field is only populated on some in-memory shapes.
 */
function processWorkspaceId(process: unknown): string {
    const record = process as { workspaceId?: string; metadata?: { workspaceId?: unknown } };
    const fromMetadata = record.metadata?.workspaceId;
    if (typeof fromMetadata === 'string' && fromMetadata.length > 0) return fromMetadata;
    return record.workspaceId ?? '';
}

function parseFolderIdField(body: unknown): ValidationResult<string | null> {
    const raw = (body as { folderId?: unknown } | null)?.folderId;
    if (raw === null) return { ok: true, value: null };
    if (typeof raw === 'string' && raw.length > 0) return { ok: true, value: raw };
    return { ok: false, error: 'Body must contain folderId: string | null' };
}

// ============================================================================
// Route registration
// ============================================================================

export function registerChatFolderRoutes(
    routes: Route[],
    store: ProcessStore,
    groups: ChatFolderGroupStore,
): void {
    // GET /api/workspaces/:workspaceId/chat-folders — list folders
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/chat-folders$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            sendJSON(res, 200, { folders: listFolders(groups, ws.id) });
        },
    });

    // POST /api/workspaces/:workspaceId/chat-folders — create a folder at the top
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/chat-folders$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const name = normalizeChatFolderName((body as any).name);
            if (!name.ok) {
                sendJSON(res, 400, { error: name.error });
                return;
            }
            let color: ChatFolderColor = DEFAULT_CHAT_FOLDER_COLOR;
            if ((body as any).color !== undefined) {
                const parsed = normalizeChatFolderColor((body as any).color);
                if (!parsed.ok) {
                    sendJSON(res, 400, { error: parsed.error });
                    return;
                }
                color = parsed.value;
            }

            // New folders land at the top; everything else shifts down one slot.
            const now = new Date().toISOString();
            for (const existing of listFolders(groups, ws.id)) {
                groups.updateGroup(ws.id, existing.id, {
                    extra: { sortIndex: existing.sortIndex + 1 },
                    updatedAt: now,
                });
            }

            const groupId = `folder-${randomUUID()}`;
            groups.upsertGroup({
                groupId,
                workspaceId: ws.id,
                type: CHAT_FOLDER_GROUP_TYPE,
                title: name.value,
                // Folders have no run lifecycle; `status` is inert for this
                // group type and never leaves the server, so it stays on the
                // neutral member of the shared TaskGroupStatus enum rather
                // than widening that enum for every other group type.
                status: 'draft',
                hidden: false,
                parentGroupId: undefined,
                createdAt: now,
                updatedAt: now,
                extra: { color, sortIndex: 0 },
            });

            const created = groups.getGroup(ws.id, groupId);
            if (!created) {
                sendJSON(res, 500, { error: 'Failed to create folder' });
                return;
            }
            sendJSON(res, 200, { folder: toChatFolder(created) });
        },
    });

    // PATCH /api/workspaces/:workspaceId/chat-folders/:folderId — rename / recolor / reorder
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/chat-folders\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const folderId = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const existing = groups.getGroup(ws.id, folderId);
            if (!existing || existing.type !== CHAT_FOLDER_GROUP_TYPE) {
                sendJSON(res, 404, { error: 'Folder not found' });
                return;
            }

            const updates: Partial<Pick<TaskGroupRecord, 'title' | 'extra'>> = {};
            const extra: Record<string, unknown> = {};

            if ((body as any).name !== undefined) {
                const name = normalizeChatFolderName((body as any).name);
                if (!name.ok) {
                    sendJSON(res, 400, { error: name.error });
                    return;
                }
                updates.title = name.value;
            }
            if ((body as any).color !== undefined) {
                const color = normalizeChatFolderColor((body as any).color);
                if (!color.ok) {
                    sendJSON(res, 400, { error: color.error });
                    return;
                }
                extra.color = color.value;
            }
            if ((body as any).sortIndex !== undefined) {
                const sortIndex = (body as any).sortIndex;
                if (typeof sortIndex !== 'number' || !Number.isFinite(sortIndex)) {
                    sendJSON(res, 400, { error: 'sortIndex must be a finite number' });
                    return;
                }
                extra.sortIndex = sortIndex;
            }
            if (Object.keys(extra).length > 0) updates.extra = extra;

            const updated = groups.updateGroup(ws.id, folderId, {
                ...updates,
                updatedAt: new Date().toISOString(),
            });
            if (!updated) {
                sendJSON(res, 404, { error: 'Folder not found' });
                return;
            }
            sendJSON(res, 200, { folder: toChatFolder(updated) });
        },
    });

    // DELETE /api/workspaces/:workspaceId/chat-folders/:folderId — delete, unfiling members
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/chat-folders\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const folderId = decodeURIComponent(match![2]);

            const existing = groups.getGroup(ws.id, folderId);
            if (!existing || existing.type !== CHAT_FOLDER_GROUP_TYPE) {
                sendJSON(res, 404, { error: 'Folder not found' });
                return;
            }

            // Read members before the delete — removeGroup cascades them away.
            const unfiled = existing.children
                .map(child => child.processId)
                .filter((id): id is string => typeof id === 'string');

            groups.removeGroup(ws.id, folderId);
            sendJSON(res, 200, { deleted: true, unfiled });
        },
    });

    // PATCH /api/processes/:id/folder — file or unfile one process
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)\/folder$/,
        handler: async (req, res, match) => {
            const processId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const folderId = parseFolderIdField(body);
            if (!folderId.ok) {
                sendJSON(res, 400, { error: folderId.error });
                return;
            }

            const process = await store.getProcess(processId);
            if (!process) {
                sendJSON(res, 404, { error: 'Process not found' });
                return;
            }
            const workspaceId = processWorkspaceId(process);

            if (folderId.value !== null) {
                const folder = resolveTargetFolder(groups, workspaceId, folderId.value, res);
                if (!folder) return;
            }

            applyFolder(groups, workspaceId, processId, folderId.value);
            sendJSON(res, 200, { id: processId, folderId: folderId.value });
        },
    });

    // POST /api/processes/folder — batch file or unfile
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/folder$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const ids = (body as any).ids;
            if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== 'string')) {
                sendJSON(res, 400, { error: 'Body must contain ids: string[]' });
                return;
            }
            const folderId = parseFolderIdField(body);
            if (!folderId.ok) {
                sendJSON(res, 400, { error: folderId.error });
                return;
            }

            // Ids that no longer exist are skipped — partial success is the
            // useful behavior when the list refreshed under the user.
            const targets: Array<{ id: string; workspaceId: string }> = [];
            for (const id of ids as string[]) {
                const process = await store.getProcess(id);
                if (!process) continue;
                targets.push({ id, workspaceId: processWorkspaceId(process) });
            }

            // Validate the whole batch before writing anything, so a rejected
            // batch never lands a partial move.
            if (folderId.value !== null) {
                const folder = groups.findGroupAnywhere(folderId.value, { type: CHAT_FOLDER_GROUP_TYPE });
                if (!folder) {
                    sendJSON(res, 404, { error: 'Folder not found' });
                    return;
                }
                if (targets.some(target => target.workspaceId !== folder.workspaceId)) {
                    sendJSON(res, 400, { error: 'Folder belongs to a different workspace' });
                    return;
                }
            }

            for (const target of targets) {
                applyFolder(groups, target.workspaceId, target.id, folderId.value);
            }

            sendJSON(res, 200, { updated: targets.map(target => target.id), folderId: folderId.value });
        },
    });
}
