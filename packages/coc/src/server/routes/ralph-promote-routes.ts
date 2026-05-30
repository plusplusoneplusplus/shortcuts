/**
 * Ralph promotion route.
 *
 * POST /api/processes/:id/promote-to-ralph — promote a completed ask-mode
 * conversation into a Ralph session in place. Attaches a `grilling`-phase
 * ralph context to the existing process and enqueues a follow-up synthesis
 * turn (mode=ask + grill-me skill) against the same `processId`. The
 * existing `RalphStartPanel` then renders below the synthesis output and
 * kicks off the standard Ralph execution flow.
 *
 * Eligibility: process must exist, be `completed`, have payload mode === `ask`,
 * carry no existing `context.ralph` / `metadata.ralph`, and contain at least
 * one assistant turn.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    isQueueProcessId,
    toTaskId,
    toQueueProcessId,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/forge';
import { getRalphContext } from '../tasks/task-types';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import {
    buildRalphSynthesisPrompt,
    RALPH_SYNTHESIS_HINT_MAX_LENGTH,
} from '../ralph/synthesis-prompt';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';

export interface RalphPromoteRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore;
    /** Repo-scoped data root (`~/.coc` or override). Used for the per-session journal. */
    dataDir?: string;
}

function mintSessionId(): string {
    return `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function registerRalphPromoteRoutes(routes: Route[], ctx: RalphPromoteRouteContext): void {
    const { bridge, store, dataDir } = ctx;

    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/promote-to-ralph$/,
        handler: async (req, res, match) => {
            const rawId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!rawId) return sendError(res, 400, 'Missing process ID');

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            body = body ?? {};

            const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId
                ? body.workspaceId
                : undefined;

            const rawHint = typeof body.extraGuidance === 'string' ? body.extraGuidance.trim() : '';
            if (rawHint.length > RALPH_SYNTHESIS_HINT_MAX_LENGTH) {
                return sendError(
                    res,
                    400,
                    `extraGuidance exceeds ${RALPH_SYNTHESIS_HINT_MAX_LENGTH} characters`,
                );
            }
            const extraGuidance = rawHint || undefined;

            // Resolve process (handle queue_ prefix vs bare UUID).
            let proc = await store.getProcess(rawId, workspaceId);
            if (!proc && isQueueProcessId(rawId)) {
                proc = await store.getProcess(toTaskId(rawId), workspaceId);
            }
            if (!proc) return sendError(res, 404, 'Process not found');

            const procPayload = (proc as any).payload as Record<string, any> | undefined;
            const procMetadata = (proc.metadata ?? {}) as Record<string, any>;

            // For persisted processes, the queue-task `payload` is not always
            // mirrored onto the process record — `kind`/`mode` live on
            // `metadata.type`/`metadata.mode` instead. Accept either source.
            const procKind = procPayload?.kind ?? procMetadata.type;
            const procMode = procPayload?.mode ?? procMetadata.mode;

            // Validation gates — order is significant for clearest error messages.
            if (proc.status !== 'completed') {
                return sendError(res, 400, 'Process is not completed');
            }
            if (procKind !== 'chat' || procMode !== 'ask') {
                return sendError(res, 400, 'Only completed ask-mode chats can be promoted to Ralph');
            }
            if (getRalphContext(proc)) {
                return sendError(res, 400, 'Process already has a Ralph context');
            }
            const turns = Array.isArray((proc as any).conversationTurns)
                ? (proc as any).conversationTurns
                : [];
            const hasAssistantTurn = turns.some((t: any) => t?.role === 'assistant');
            if (!hasAssistantTurn) {
                return sendError(res, 400, 'Process has no assistant turns to synthesize');
            }

            // Detect a pre-existing ## Goal block in the last assistant turn so the
            // synthesis prompt can treat it as authoritative (AC-02).
            const lastAssistantTurn = [...turns].reverse().find((t: any) => t?.role === 'assistant');
            let seedGoal: string | undefined;
            if (lastAssistantTurn) {
                const content = typeof lastAssistantTurn.content === 'string'
                    ? lastAssistantTurn.content
                    : '';
                const goalMatch = content.match(/(##\s+Goal[\s\S]*)/);
                if (goalMatch) {
                    seedGoal = goalMatch[1].trim() || undefined;
                }
            }

            const wsId: string | undefined = workspaceId
                ?? procPayload?.workspaceId
                ?? (procMetadata.workspaceId as string | undefined);

            const workingDirectory: string | undefined =
                procPayload?.workingDirectory
                ?? procPayload?.folderPath
                ?? proc.workingDirectory
                ?? (procMetadata.folderPath as string | undefined);
            const folderPath: string | undefined =
                procPayload?.folderPath
                ?? (procMetadata.folderPath as string | undefined);

            // maxIterations resolution: per-repo preference > hardcoded default.
            // The grilling phase itself does not use maxIterations, but we
            // initialise the per-session journal with the value RalphStart
            // will see, so the user's "Start Ralph" click does not need to
            // re-resolve.
            let prefMax: number | undefined;
            if (dataDir && wsId) {
                try {
                    prefMax = readRepoPreferences(dataDir, wsId).maxRalphIterations;
                } catch {
                    // Preferences are optional.
                }
            }
            const maxIterations = prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;

            const sessionId = mintSessionId();
            const ralphMetadata = { phase: 'grilling' as const, sessionId };

            // Best-effort: attach the ralph metadata to the existing process
            // so getRalphContext() returns immediately and grouping picks it up.
            // The freshly enqueued follow-up payload also carries the same
            // ralph context, so even if this metadata write loses a race the
            // chat-base-executor will still inject the grilling system prompt
            // for the synthesis turn.
            const existingMetadata = procMetadata as Record<string, unknown>;
            const nextMetadata = { ...existingMetadata, ralph: ralphMetadata };
            try {
                await store.updateProcess(proc.id, { metadata: nextMetadata as any });
            } catch (err) {
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph promote] metadata patch failed for ${proc.id}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to attach Ralph context');
            }

            // Initialise the per-session journal directory. originalGoal is
            // backfilled by /ralph-start once the user confirms the synthesised
            // goal. initSession is idempotent.
            if (dataDir && wsId) {
                try {
                    const journal = new RalphSessionStore({ dataDir });
                    await journal.initSession(wsId, sessionId, {
                        originalGoal: '',
                        maxIterations,
                    });
                } catch (err) {
                    getLogger().debug(
                        LogCategory.AI,
                        `[Ralph promote] initSession failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }

            // Enqueue the synthesis follow-up turn against the same process.
            // mode=ask + grill-me skill + context.ralph.phase=grilling triggers
            // the grilling system prompt in chat-base-executor.
            let synthesisTaskId: string;
            try {
                synthesisTaskId = await bridge.enqueue({
                    ...(isQueueProcessId(proc.id) ? { id: toTaskId(proc.id) } : {}),
                    processId: proc.id,
                    type: 'chat',
                    priority: 'normal',
                    repoId: wsId,
                    folderPath,
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt: buildRalphSynthesisPrompt({
                            seedGoal,
                            extraGuidance,
                        }),
                        processId: proc.id,
                        workspaceId: wsId,
                        workingDirectory,
                        folderPath,
                        context: {
                            ralph: ralphMetadata,
                            skills: ['grill-me'],
                        },
                    },
                    config: {},
                } as any);
            } catch (err) {
                // Rollback: best-effort detach of the freshly attached ralph
                // metadata so the chat returns to a clean ask-mode state.
                try {
                    await store.updateProcess(proc.id, { metadata: existingMetadata as any });
                } catch { /* swallow rollback failure */ }
                getLogger().warn(
                    LogCategory.AI,
                    `[Ralph promote] enqueue failed for ${proc.id}: ${err instanceof Error ? err.message : String(err)}`,
                );
                return sendError(res, 500, 'Failed to enqueue Ralph synthesis turn');
            }

            sendJSON(res, 200, {
                promoted: true,
                processId: toQueueProcessId(proc.id),
                sessionId,
                synthesisTaskId: toQueueProcessId(synthesisTaskId),
            });
        },
    });
}
