/**
 * PUT /api/workspaces/:workspaceId/pin-order — reorder the Pinned section.
 *
 * Pin time is the sort key: entry `i` is restamped to `now - i ms` so every
 * existing "newest pin first" sort follows the requested order. Only entries
 * that are already pinned in this workspace are touched; others are skipped.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError } from '../errors';
import { parseBodyOrReject, resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import { GroupPinStore, normalizeGroupId, normalizeGroupPinType, type GroupPinType } from './group-pin-store';

export const MAX_PIN_ORDER_ENTRIES = 500;

export interface PinOrderStore {
    setPinOrder(workspaceId: string, entries: Array<{ id: string; pinnedAt: string }>): string[];
}

type ParsedEntry =
    | { kind: 'chat'; id: string }
    | { kind: 'group'; type: GroupPinType; groupId: string };

export function parsePinOrderEntries(value: unknown): ParsedEntry[] | string {
    if (!Array.isArray(value) || value.length === 0) {
        return 'entries must be a non-empty array';
    }
    if (value.length > MAX_PIN_ORDER_ENTRIES) {
        return `entries must contain at most ${MAX_PIN_ORDER_ENTRIES} items`;
    }
    const seen = new Set<string>();
    const parsed: ParsedEntry[] = [];
    for (const raw of value) {
        const entry = raw as Record<string, unknown> | null;
        let item: ParsedEntry;
        let key: string;
        if (entry?.kind === 'chat') {
            if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
                return 'Invalid chat id';
            }
            item = { kind: 'chat', id: entry.id };
            key = `chat:${entry.id}`;
        } else if (entry?.kind === 'group') {
            const type = normalizeGroupPinType(entry.type);
            if (!type) return 'Invalid group pin type';
            const groupId = normalizeGroupId(entry.groupId);
            if (!groupId) return 'Invalid group ID';
            item = { kind: 'group', type, groupId };
            key = `group:${type}:${groupId}`;
        } else {
            return 'Unknown entry kind';
        }
        if (seen.has(key)) return 'Duplicate entry';
        seen.add(key);
        parsed.push(item);
    }
    return parsed;
}

export function registerPinOrderRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {
    const groupPinStore = new GroupPinStore(dataDir);

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/pin-order$/,
        handler: async (req, res, match) => {
            const workspace = await resolveWorkspaceOrFail(store, match!, res);
            if (!workspace) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const entries = parsePinOrderEntries(body?.entries);
            if (typeof entries === 'string') {
                handleAPIError(res, badRequest(entries));
                return;
            }

            const now = Date.now();
            const stamp = (i: number) => new Date(now - i).toISOString();
            const chatStamps: Array<{ id: string; pinnedAt: string }> = [];
            const groupStamps: Array<{ type: GroupPinType; groupId: string; pinnedAt: string }> = [];
            entries.forEach((entry, i) => {
                if (entry.kind === 'chat') {
                    chatStamps.push({ id: entry.id, pinnedAt: stamp(i) });
                } else {
                    groupStamps.push({ type: entry.type, groupId: entry.groupId, pinnedAt: stamp(i) });
                }
            });

            const updatedIds = new Set(
                chatStamps.length > 0 ? (store as unknown as PinOrderStore).setPinOrder(workspace.id, chatStamps) : [],
            );
            const groups = groupStamps.length > 0
                ? groupPinStore.setPinOrder(workspace.id, groupStamps, stamp(0))
                : groupPinStore.listPins(workspace.id);

            sendJSON(res, 200, {
                chats: chatStamps.filter(entry => updatedIds.has(entry.id)),
                groups,
            });
        },
    });
}
