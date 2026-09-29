/**
 * Routes for Ralph sessions parked in `phase=awaiting-input` after an
 * iteration ended with RALPH_NEEDS_INPUT.
 *
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/input
 *   Body: { answers: Array<string | string[]>, note?: string, provider?, config? }
 *   `answers` is index-aligned with `pendingInput.request.questions`. Saves the
 *   answers, appends `## Human input — <ts>` to progress.md, sets phase back
 *   to `executing`, and enqueues iteration `currentIteration + 1` with a
 *   "Human answers" prompt block. AI selection falls back like `/resume`.
 *
 * POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/stop
 *   Ends the waiting session with terminal reason USER_STOPPED and broadcasts
 *   `ralph-session-complete` with reason `user-stopped`.
 *
 * Both return 409 unless the session is `awaiting-input` (which also covers a
 * duplicate submit, since the first one moves the session out of that phase).
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { setRalphProcessPhase } from '../ralph/process-phase';
import type { RalphHumanAnswer, RalphHumanInput, RalphSessionRecord } from '../ralph/types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { parseRalphAiSelection, recoverIterationPaths } from './ralph-route-utils';

export const RALPH_INPUT_MAX_ANSWER_CHARS = 10_000;
export const RALPH_INPUT_MAX_NOTE_CHARS = 10_000;

export interface RalphInputRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    dataDir: string;
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

type ParsedInputBody =
    | { value: { answers: Array<string | string[]>; note: string | undefined } }
    | { error: string };

export function registerRalphInputRoutes(routes: Route[], ctx: RalphInputRouteContext): void {
    const { bridge, store, dataDir } = ctx;
    // Serializes submit/stop per session so two concurrent requests cannot
    // both observe `awaiting-input` and enqueue twice.
    const busySessions = new Set<string>();

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/input$/,
        handler: async (req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const sessionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId || !sessionId) {
                return sendError(res, 400, 'Missing workspaceId or sessionId');
            }

            let body: unknown;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const aiSelection = parseRalphAiSelection(body);
            if ('error' in aiSelection) {
                return sendError(res, 400, aiSelection.error);
            }
            const parsed = parseInputBody(body);
            if ('error' in parsed) {
                return sendError(res, 400, parsed.error);
            }

            const busyKey = `${workspaceId}\u0000${sessionId}`;
            if (busySessions.has(busyKey)) {
                return sendError(res, 409, 'An answer for this session is already being submitted');
            }
            busySessions.add(busyKey);
            try {
                const journal = new RalphSessionStore({ dataDir });
                const record = await journal.readSessionRecord(workspaceId, sessionId);
                if (!record) {
                    return sendError(res, 404, 'Ralph session not found');
                }
                const pending = record.pendingInput;
                if (record.phase !== 'awaiting-input' || !pending) {
                    return sendError(res, 409, `Session phase is "${record.phase}"; input is only accepted while awaiting input`);
                }

                const questions = pending.request.questions;
                if (parsed.value.answers.length !== questions.length) {
                    return sendError(res, 400, `answers must have exactly ${questions.length} entr${questions.length === 1 ? 'y' : 'ies'}`);
                }
                const answers: RalphHumanAnswer[] = questions.map((q, index) => ({
                    question: q.question,
                    answer: parsed.value.answers[index],
                }));
                const humanInput: RalphHumanInput = {
                    iteration: pending.iteration,
                    answeredAt: new Date().toISOString(),
                    answers,
                    ...(parsed.value.note ? { note: parsed.value.note } : {}),
                };

                const recovered = await recoverIterationPaths(record, store, workspaceId);
                try {
                    await journal.appendHumanInputSection(workspaceId, sessionId, humanInput, pending.request);
                } catch (err) {
                    getLogger().warn(
                        LogCategory.AI,
                        `[Ralph] appendHumanInputSection failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    return sendError(res, 500, 'Failed to save the answer in the progress journal; retry the submission');
                }
                const updated = await journal.resolvePendingInput(workspaceId, sessionId, humanInput);
                if (!updated) {
                    return sendError(res, 409, 'Session is no longer awaiting input');
                }

                await clearAwaitingProcessPhase(store, pending.processId, 'executing');

                const provider = aiSelection.value.provider ?? recovered.provider;
                const effortTier = aiSelection.value.effortTier;
                const recoverConcreteAiSettings = effortTier === undefined;
                const model = aiSelection.value.model ?? (recoverConcreteAiSettings ? recovered.model : undefined);
                const reasoningEffort = aiSelection.value.reasoningEffort
                    ?? (recoverConcreteAiSettings ? recovered.reasoningEffort : undefined);

                const nextIteration = updated.currentIteration + 1;
                const taskInput = buildRalphIterationTask({
                    workspaceId,
                    workingDirectory: recovered.workingDirectory,
                    folderPath: recovered.folderPath,
                    sessionId,
                    originalGoal: updated.originalGoal,
                    iteration: nextIteration,
                    maxIterations: updated.maxIterations,
                    dataDir,
                    extraContext: { ralph: { loopIndex: currentLoopIndex(updated) } },
                    provider,
                    model,
                    reasoningEffort,
                    effortTier,
                    autoProviderRouting: aiSelection.value.autoProviderRouting,
                    humanInput,
                });

                let taskId: string;
                try {
                    taskId = await bridge.enqueue(taskInput as any);
                } catch (err) {
                    getLogger().warn(
                        LogCategory.AI,
                        `[Ralph] input enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    // The answer is saved and the phase is executing, so /resume can retry.
                    return sendError(res, 500, 'Answer saved, but failed to enqueue the next iteration; use resume to retry');
                }

                sendJSON(res, 200, {
                    resumed: true,
                    sessionId,
                    workspaceId,
                    taskId,
                    nextIteration,
                    maxIterations: updated.maxIterations,
                });
            } finally {
                busySessions.delete(busyKey);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/ralph-sessions\/([^/]+)\/stop$/,
        handler: async (_req, res, match) => {
            const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            const sessionId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
            if (!workspaceId || !sessionId) {
                return sendError(res, 400, 'Missing workspaceId or sessionId');
            }

            const busyKey = `${workspaceId}\u0000${sessionId}`;
            if (busySessions.has(busyKey)) {
                return sendError(res, 409, 'An answer for this session is already being submitted');
            }
            busySessions.add(busyKey);
            try {
                const journal = new RalphSessionStore({ dataDir });
                const record = await journal.readSessionRecord(workspaceId, sessionId);
                if (!record) {
                    return sendError(res, 404, 'Ralph session not found');
                }
                const pending = record.pendingInput;
                const updated = await journal.stopAwaitingSession(workspaceId, sessionId);
                if (!updated) {
                    return sendError(res, 409, `Session phase is "${record.phase}"; stop is only for sessions awaiting input`);
                }

                const processId = pending?.processId
                    ?? updated.iterations[updated.iterations.length - 1]?.processId
                    ?? '';
                await clearAwaitingProcessPhase(store, pending?.processId, 'complete');
                const totalIterations = updated.currentIteration;
                try {
                    bridge.publishRalphSessionComplete({
                        type: 'ralphSessionComplete',
                        workspaceId,
                        sessionId,
                        processId,
                        totalIterations,
                        reason: 'user-stopped',
                    });
                } catch (err) {
                    getLogger().debug(LogCategory.AI, `[Ralph] Failed to publish ralphSessionComplete: ${err instanceof Error ? err.message : String(err)}`);
                }
                try {
                    ctx.getWsServer?.()?.broadcastProcessEvent({
                        type: 'ralph-session-complete',
                        workspaceId,
                        sessionId,
                        processId,
                        totalIterations,
                        reason: 'user-stopped',
                    });
                } catch (err) {
                    getLogger().debug(LogCategory.AI, `[Ralph] Failed to broadcast ralph-session-complete: ${err instanceof Error ? err.message : String(err)}`);
                }

                sendJSON(res, 200, {
                    stopped: true,
                    sessionId,
                    workspaceId,
                    phase: updated.phase,
                    terminalReason: updated.terminalReason,
                });
            } finally {
                busySessions.delete(busyKey);
            }
        },
    });
}

/** Take the asking process out of `awaiting-input` so the chat-list marker clears. */
async function clearAwaitingProcessPhase(
    store: ProcessStore,
    processId: string | undefined,
    phase: 'executing' | 'complete',
): Promise<void> {
    try {
        await setRalphProcessPhase(store, processId, phase);
    } catch (err) {
        getLogger().debug(LogCategory.AI, `[Ralph] Failed to reset process ${processId} phase: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function currentLoopIndex(record: RalphSessionRecord): number {
    return record.loops?.[record.loops.length - 1]?.loopIndex
        ?? record.iterations[record.iterations.length - 1]?.loopIndex
        ?? 1;
}

function parseInputBody(body: unknown): ParsedInputBody {
    const request = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const rawAnswers = request.answers;
    if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
        return { error: 'answers must be a non-empty array' };
    }
    const answers: Array<string | string[]> = [];
    for (const raw of rawAnswers) {
        if (typeof raw === 'string') {
            if (raw.length > RALPH_INPUT_MAX_ANSWER_CHARS) {
                return { error: `each answer must be at most ${RALPH_INPUT_MAX_ANSWER_CHARS} characters` };
            }
            answers.push(raw);
            continue;
        }
        if (Array.isArray(raw) && raw.every((v): v is string => typeof v === 'string')) {
            if (raw.join('').length > RALPH_INPUT_MAX_ANSWER_CHARS) {
                return { error: `each answer must be at most ${RALPH_INPUT_MAX_ANSWER_CHARS} characters` };
            }
            answers.push([...raw]);
            continue;
        }
        return { error: 'each answer must be a string or an array of strings' };
    }

    let note: string | undefined;
    if (request.note !== undefined && request.note !== null) {
        if (typeof request.note !== 'string') {
            return { error: 'note must be a string' };
        }
        if (request.note.length > RALPH_INPUT_MAX_NOTE_CHARS) {
            return { error: `note must be at most ${RALPH_INPUT_MAX_NOTE_CHARS} characters` };
        }
        note = request.note.trim() || undefined;
    }
    return { value: { answers, note } };
}
