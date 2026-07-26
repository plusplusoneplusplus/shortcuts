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
 * A `{ image }` base64 data URL in the body switches to the figure/equation
 * region vision path (Goal 4, AC-01): the crop is written to a temp `.png`,
 * attached to a one-shot lookup, and read by a vision-capable model. No text
 * selection is required for that path.
 *
 * Cross-platform; pure Node.js.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../../shared/router';
import { sendJSON, sendError, parseQueryParams } from '../../core/api-handler';
import { parseBodyOrReject } from '../../shared/handler-utils';
import { isValidWorkspaceId } from '../../tasks/comments/base-comments-manager';
import { resolveDefaultModel } from '../../preferences/repository';
import { buildSideNotePrompt, buildRegionAskPrompt } from './chat-sidenotes-prompt';
import { invokeSideNoteAI, invokeSideNoteVisionAI } from './chat-sidenotes-ai';
import type { SideNoteVisionInvoke } from './chat-sidenotes-ai';
import type { SideNoteAIInvoke } from './chat-sidenotes-handler';
import { readPaperText } from '../../notes/paper-text-read';
import { isImageDataUrl, saveImagesToTempFiles, cleanupTempDir } from '../../core/image-utils';

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
    /** Vision invoker override for region-crop asks (defaults to the CLI vision invoker). */
    invokeVision?: SideNoteVisionInvoke;
    /**
     * Process store, used only to resolve the notes root for the optional
     * whole-paper grounding path (Goal 3, AC-04). When absent, `useFullPaper`
     * requests silently degrade to the cheap selection-only grounding.
     */
    store?: ProcessStore;
}

/**
 * Register the stateless Quick Ask answer route on the shared route table.
 */
export function registerQuickAskAnswerRoutes(opts: QuickAskAnswerRouteOptions): void {
    const { routes, dataDir, getEnabled, store } = opts;
    const invokeAI: SideNoteAIInvoke = opts.invokeAI ?? invokeSideNoteAI;
    const invokeVision: SideNoteVisionInvoke = opts.invokeVision ?? invokeSideNoteVisionAI;

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

            // Region/figure vision path (Goal 4, AC-01): the client sends a base64
            // image crop of a drag-a-box region (which has no selectable text). We
            // decode it to a temp `.png`, attach it, and let a vision-capable model
            // read it. This branch runs before the text-selection guard because a
            // region carries no `selectedText`.
            if (typeof body.image === 'string' && body.image.length > 0) {
                if (!isImageDataUrl(body.image)) {
                    return sendError(res, 400, 'Invalid image');
                }
                const { tempDir, attachments } = saveImagesToTempFiles([body.image]);
                try {
                    if (attachments.length === 0) {
                        return sendError(res, 400, 'Invalid or oversized image');
                    }
                    const regionQuestion = typeof body.question === 'string' && body.question.trim()
                        ? body.question.trim() : undefined;
                    const regionModel = resolveDefaultModel(dataDir, workspaceId, 'quickAsk');
                    const regionPrompt = buildRegionAskPrompt({
                        question: regionQuestion,
                        contextBefore: typeof body.contextBefore === 'string'
                            ? body.contextBefore.slice(-MAX_CONTEXT_CHARS) : '',
                        contextAfter: typeof body.contextAfter === 'string'
                            ? body.contextAfter.slice(0, MAX_CONTEXT_CHARS) : '',
                    });
                    const visionResult = await invokeVision(
                        regionPrompt,
                        attachments.map(a => a.path),
                        regionModel,
                    );
                    if (!visionResult.success) {
                        return sendError(res, visionResult.unavailable ? 503 : 502, visionResult.error);
                    }
                    return sendJSON(res, 200, {
                        answer: visionResult.response,
                        model: regionModel,
                        usedVision: true,
                    });
                } finally {
                    cleanupTempDir(tempDir);
                }
            }

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

            // Optional whole-paper grounding (Goal 3, AC-04). Default stays the
            // cheap selection-only path; only when the client opts in AND the
            // cached text sidecar is readable do we ground on the full paper.
            let paperText: string | undefined;
            if (body.useFullPaper === true && typeof body.paperPath === 'string' && store) {
                const root = typeof body.root === 'string' ? body.root : undefined;
                const text = await readPaperText({
                    dataDir,
                    store,
                    workspaceId,
                    root,
                    paperPath: body.paperPath,
                });
                paperText = text ?? undefined;
            }

            const model = resolveDefaultModel(dataDir, workspaceId, 'quickAsk');
            const prompt = buildSideNotePrompt({
                selectedText: trimmedSelection,
                contextBefore,
                contextAfter,
                question,
                paperText,
            });

            const aiResult = await invokeAI(prompt, model);
            if (!aiResult.success) {
                return sendError(res, aiResult.unavailable ? 503 : 502, aiResult.error);
            }

            sendJSON(res, 200, {
                answer: aiResult.response,
                model,
                usedFullPaper: paperText !== undefined,
            });
        },
    });
}
