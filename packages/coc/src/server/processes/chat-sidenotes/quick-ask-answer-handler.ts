/**
 * Stateless Quick Ask answer endpoint.
 *
 * Runs the same one-shot, grounded lookup as the chat side-notes POST route
 * ({@link buildSideNotePrompt} + {@link invokeSideNoteAI}) but persists nothing
 * and is not tied to a chat process/turn. This is the ask→answer half of the
 * Quick Ask loop for note/paper selections (Goal 1): the client sends the
 * selected passage plus surrounding context and gets a Markdown answer back to
 * show in the side-note popover. Persistence (the dual-anchor annotations
 * sidecar) is a separate concern (Goal 2).
 *
 * Endpoint (guarded behind the admin `features.quickAskSidenotes` flag):
 *   POST /api/quick-ask/answer?workspace=<id>
 *     body: { selectedText, contextBefore?, contextAfter?, question? }
 *     → 200 { answer, model }
 *
 * Cross-platform; pure Node.js.
 */

import type { Route } from '../../shared/router';
import { sendJSON, sendError, parseQueryParams } from '../../core/api-handler';
import { parseBodyOrReject } from '../../shared/handler-utils';
import { isValidWorkspaceId } from '../../tasks/comments/base-comments-manager';
import { resolveDefaultModel } from '../../preferences/repository';
import { buildSideNotePrompt } from './chat-sidenotes-prompt';
import { invokeSideNoteAI } from './chat-sidenotes-ai';
import type { SideNoteAIInvoke } from './chat-sidenotes-handler';

/** Minimum selectable length that produces an answer (parity with the persisted route). */
const MIN_SELECTION_CHARS = 2;
/** Max context forwarded to the model on each side of the selection. */
const MAX_CONTEXT_CHARS = 400;

const ANSWER_PATTERN = /^\/api\/quick-ask\/answer$/;

export interface QuickAskAnswerRouteOptions {
    routes: Route[];
    dataDir: string;
    /** Live getter for the admin `features.quickAskSidenotes` flag. */
    getEnabled: () => boolean;
    /** AI invoker override (defaults to the one-shot CLI invoker). */
    invokeAI?: SideNoteAIInvoke;
}

/**
 * Register the stateless Quick Ask answer route on the shared route table.
 */
export function registerQuickAskAnswerRoutes(opts: QuickAskAnswerRouteOptions): void {
    const { routes, dataDir, getEnabled } = opts;
    const invokeAI: SideNoteAIInvoke = opts.invokeAI ?? invokeSideNoteAI;

    // POST /api/quick-ask/answer
    routes.push({
        method: 'POST',
        pattern: ANSWER_PATTERN,
        handler: async (req, res) => {
            if (!getEnabled()) {return sendError(res, 404, 'Quick Ask is disabled');}
            const workspaceId = parseQueryParams(req.url || '/').workspaceId;
            if (!workspaceId || !isValidWorkspaceId(workspaceId)) {
                return sendError(res, 400, 'Missing or invalid workspaceId');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) {return;}

            const selectedText: string = typeof body.selectedText === 'string' ? body.selectedText : '';
            const trimmedSelection = selectedText.trim();
            if (trimmedSelection.length < MIN_SELECTION_CHARS) {
                return sendError(res, 400, 'Selection too short');
            }

            const contextBefore = typeof body.contextBefore === 'string'
                ? body.contextBefore.slice(-MAX_CONTEXT_CHARS) : '';
            const contextAfter = typeof body.contextAfter === 'string'
                ? body.contextAfter.slice(0, MAX_CONTEXT_CHARS) : '';
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

            sendJSON(res, 200, { answer: aiResult.response, model });
        },
    });
}
