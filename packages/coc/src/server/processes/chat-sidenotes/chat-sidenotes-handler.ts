/**
 * Quick Ask side-notes REST API handler.
 *
 * Side-notes are per-process annotations created by the Quick Ask feature: a
 * cheap one-shot AI lookup for a text selection inside an assistant turn. They
 * never enter the main conversation thread.
 *
 * Endpoints (all guarded behind the admin `features.quickAskSidenotes` flag):
 *   GET    /api/processes/:processId/sidenotes            — list (hydrate on open)
 *   POST   /api/processes/:processId/sidenotes            — create (runs the lookup)
 *   DELETE /api/processes/:processId/sidenotes/:id        — delete one
 *
 * The workspace is supplied via `?workspace=` (the SPA always knows it); the
 * store is used to confirm the process exists.
 *
 * Cross-platform; pure Node.js.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import type { Route } from '../../shared/router';
import { sendJSON, sendError, parseQueryParams } from '../../core/api-handler';
import { parseBodyOrReject } from '../../shared/handler-utils';
import { isValidWorkspaceId } from '../../tasks/comments/base-comments-manager';
import { resolveDefaultModel } from '../../preferences/repository';
import {
    ChatSideNotesManager,
    buildSideNoteLabel,
    fingerprintSelection,
} from './chat-sidenotes-manager';
import { buildSideNotePrompt } from './chat-sidenotes-prompt';
import { invokeSideNoteAI } from './chat-sidenotes-ai';

/** Minimum selectable length that produces a side-note. */
const MIN_SELECTION_CHARS = 2;
/** Max context stored on each side of the selection. */
const MAX_CONTEXT_STORE_CHARS = 400;

const LIST_PATTERN = /^\/api\/processes\/([^/]+)\/sidenotes$/;
const ITEM_PATTERN = /^\/api\/processes\/([^/]+)\/sidenotes\/([^/]+)$/;

/** Injectable AI invoker signature (overridable in tests). */
export type SideNoteAIInvoke = (
    prompt: string,
    model?: string,
) => Promise<
    | { success: true; response: string }
    | { success: false; error: string; unavailable: boolean }
>;

export interface ChatSideNotesRouteOptions {
    routes: Route[];
    store: ProcessStore;
    dataDir: string;
    /** Live getter for the admin `features.quickAskSidenotes` flag. */
    getEnabled: () => boolean;
    /** AI invoker override (defaults to the one-shot CLI invoker). */
    invokeAI?: SideNoteAIInvoke;
    /** Manager override (defaults to a repo-scoped disk manager). */
    manager?: ChatSideNotesManager;
}

/**
 * Register Quick Ask side-note routes on the shared route table.
 */
export function registerChatSidenotesRoutes(opts: ChatSideNotesRouteOptions): void {
    const { routes, store, dataDir, getEnabled } = opts;
    const manager = opts.manager ?? new ChatSideNotesManager(dataDir);
    const invokeAI: SideNoteAIInvoke = opts.invokeAI ?? invokeSideNoteAI;

    /** Confirm the process exists (tolerating the queue_ prefix). */
    async function processExists(id: string, workspaceId: string): Promise<boolean> {
        try {
            const proc = await store.getProcess(id, workspaceId);
            if (proc) {return true;}
            if (isQueueProcessId(id)) {
                const bare = toTaskId(id);
                return !!(await store.getProcess(bare, workspaceId));
            }
        } catch {
            /* fall through */
        }
        return false;
    }

    // GET /api/processes/:processId/sidenotes
    routes.push({
        method: 'GET',
        pattern: LIST_PATTERN,
        handler: async (req, res, match) => {
            if (!getEnabled()) {return sendError(res, 404, 'Quick Ask side-notes are disabled');}
            const processId = decodeURIComponent(match![1]);
            const workspaceId = parseQueryParams(req.url || '/').workspaceId;
            if (!workspaceId || !isValidWorkspaceId(workspaceId)) {
                return sendError(res, 400, 'Missing or invalid workspaceId');
            }
            try {
                const sidenotes = await manager.list(workspaceId, processId);
                sendJSON(res, 200, { sidenotes });
            } catch {
                sendError(res, 500, 'Failed to list side-notes');
            }
        },
    });

    // POST /api/processes/:processId/sidenotes
    routes.push({
        method: 'POST',
        pattern: LIST_PATTERN,
        handler: async (req, res, match) => {
            if (!getEnabled()) {return sendError(res, 404, 'Quick Ask side-notes are disabled');}
            const processId = decodeURIComponent(match![1]);
            const workspaceId = parseQueryParams(req.url || '/').workspaceId;
            if (!workspaceId || !isValidWorkspaceId(workspaceId)) {
                return sendError(res, 400, 'Missing or invalid workspaceId');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) {return;}

            const turnIndex = body.turnIndex;
            const selectedText: string = typeof body.selectedText === 'string' ? body.selectedText : '';
            if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) {
                return sendError(res, 400, 'Invalid turnIndex');
            }
            const trimmedSelection = selectedText.trim();
            if (trimmedSelection.length < MIN_SELECTION_CHARS) {
                return sendError(res, 400, 'Selection too short');
            }

            if (!(await processExists(processId, workspaceId))) {
                return sendError(res, 404, 'Process not found');
            }

            const contextBefore = typeof body.contextBefore === 'string'
                ? body.contextBefore.slice(-MAX_CONTEXT_STORE_CHARS) : '';
            const contextAfter = typeof body.contextAfter === 'string'
                ? body.contextAfter.slice(0, MAX_CONTEXT_STORE_CHARS) : '';
            const question = typeof body.question === 'string' && body.question.trim()
                ? body.question.trim() : undefined;

            const model = resolveDefaultModel(dataDir, workspaceId, 'quickAsk');
            const prompt = buildSideNotePrompt({
                selectedText: trimmedSelection,
                contextBefore,
                contextAfter,
                question,
            });

            const aiResult = await invokeAI(prompt, model);
            if (!aiResult.success) {
                return sendError(res, aiResult.unavailable ? 503 : 502, aiResult.error);
            }

            try {
                const created = await manager.add(workspaceId, processId, {
                    turnIndex,
                    anchor: {
                        selectedText: trimmedSelection,
                        contextBefore,
                        contextAfter,
                        fingerprint: fingerprintSelection(trimmedSelection),
                    },
                    question,
                    answer: aiResult.response,
                    label: buildSideNoteLabel(trimmedSelection),
                    model,
                });
                sendJSON(res, 201, { sidenote: created });
            } catch {
                sendError(res, 500, 'Failed to persist side-note');
            }
        },
    });

    // DELETE /api/processes/:processId/sidenotes/:id
    routes.push({
        method: 'DELETE',
        pattern: ITEM_PATTERN,
        handler: async (req, res, match) => {
            if (!getEnabled()) {return sendError(res, 404, 'Quick Ask side-notes are disabled');}
            const processId = decodeURIComponent(match![1]);
            const id = decodeURIComponent(match![2]);
            const workspaceId = parseQueryParams(req.url || '/').workspaceId;
            if (!workspaceId || !isValidWorkspaceId(workspaceId)) {
                return sendError(res, 400, 'Missing or invalid workspaceId');
            }
            try {
                const removed = await manager.delete(workspaceId, processId, id);
                if (!removed) {return sendError(res, 404, 'Side-note not found');}
                res.writeHead(204);
                res.end();
            } catch {
                sendError(res, 500, 'Failed to delete side-note');
            }
        },
    });
}
