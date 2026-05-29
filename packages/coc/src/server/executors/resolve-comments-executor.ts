/**
 * Resolve Comments Executor
 *
 * Concrete executor for resolve-comments chat tasks.
 * Injects a `resolve_comment` AI tool so the model can explicitly mark each
 * comment it addresses, then broadcasts WebSocket events and persists comment
 * status after the AI call completes.
 *
 * Extends ChatBaseExecutor so that the shared execute() lifecycle is reused.
 * The `buildModeOptions()` creates the resolve-comment tool and stores
 * `getResolvedIds` in a per-process Map for retrieval after the AI call.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import { createResolveCommentTool } from '../llm-tools/resolve-comment-tool';
import type { ChatModeAIOptions, ChatModeExecutionResult, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildModeSystemMessage } from './prompt-builder';
import type { ProcessWebSocketServer } from '../streaming/websocket';

// ============================================================================
// ResolveCommentsExecutor
// ============================================================================

export class ResolveCommentsExecutor extends ChatBaseExecutor {
    private readonly getWsServer?: () => ProcessWebSocketServer | undefined;

    /** Stores getResolvedIds callbacks keyed by processId during execution. */
    private readonly resolvedIdGetters = new Map<string, () => string[]>();

    constructor(
        store: ProcessStore,
        options: ChatModeExecutorOptions,
        getWsServer?: () => ProcessWebSocketServer | undefined,
        dataDir?: string,
    ) {
        super(store, options, dataDir);
        this.getWsServer = getWsServer;
    }

    /**
     * Execute a resolve-comments chat task.
     *
     * Flow:
     * 1. Update process store with preview
     * 2. Call this.execute(task, aiPrompt) — buildModeOptions() injects the resolve_comment tool
     * 3. Read resolved comment IDs from the Map populated during buildModeOptions()
     * 4. Persist comment status and broadcast WS events (best-effort)
     * 5. Return { revisedContent, commentIds }
     */
    async executeTask(task: QueuedTask): Promise<ChatModeExecutionResult & { revisedContent?: string; commentIds: string[] }> {
        const payload = task.payload as unknown as ChatPayload;
        const rc = payload.context?.resolveComments;
        const aiPrompt = payload.prompt;
        const processId = toQueueProcessId(task.id);

        const rdcm = payload.context?.resolveDiffCommentsMulti;
        const payloadCommentIds = rc?.commentIds ?? rdcm?.files?.flatMap((f: any) => f.commentIds) ?? [];
        const commentCount = payloadCommentIds.length;
        const fileCount = rdcm?.files?.length;
        const targetFile = rc?.filePath || rc?.documentUri || (fileCount ? `${fileCount} file(s)` : 'document');
        const previewPrefix = fileCount ? `Resolve ${commentCount} comment(s) across ${fileCount} file(s)` : `Resolve ${commentCount} comment(s) in ${targetFile}`;
        try {
            await this.store.updateProcess(processId, {
                fullPrompt: aiPrompt,
                promptPreview: previewPrefix,
            });
        } catch {
            // Non-fatal: store may be a stub
        }

        try {
            const chatResult = await this.execute(task, aiPrompt);

            const getResolvedIds = this.resolvedIdGetters.get(processId);
            const resolvedIds = getResolvedIds ? getResolvedIds() : [];
            const commentIds = resolvedIds.length > 0 ? resolvedIds : payloadCommentIds;

            // Server-side resolution: persist comment status and broadcast WS events
            if (this.dataDir && rc?.wsId && commentIds.length > 0) {
                try {
                    const { TaskCommentsManager } = await import('../tasks/comments/task-comments-handler');
                    const mgr = new TaskCommentsManager(this.dataDir);
                    const wsServer = this.getWsServer?.();
                    await Promise.all(
                        commentIds.map(async (id) => {
                            try {
                                await mgr.updateComment(rc.wsId!, rc.filePath, id, { status: 'resolved' });
                                if (wsServer) {
                                    wsServer.broadcastFileEvent(rc.filePath, {
                                        type: 'comment-resolved',
                                        filePath: rc.filePath,
                                        commentId: id,
                                    });
                                }
                            } catch {
                                // Non-fatal: best-effort resolution
                            }
                        })
                    );
                } catch {
                    // Non-fatal: server-side resolution is best-effort
                }
            }

            // Server-side resolution for multi-file diff comments
            if (this.dataDir && rdcm?.wsId && commentIds.length > 0) {
                try {
                    const { DiffCommentsManager } = await import('../tasks/comments/diff-comments-manager');
                    const manager = new DiffCommentsManager(this.dataDir);
                    const wsServer = this.getWsServer?.();
                    // Build a commentId→storageKey lookup from files[]
                    const commentToStorageKey = new Map<string, string>();
                    for (const file of rdcm.files) {
                        for (const id of file.commentIds) {
                            commentToStorageKey.set(id, file.storageKey);
                        }
                    }
                    // Resolve each comment the AI addressed
                    await Promise.all(
                        commentIds.map(async (commentId) => {
                            try {
                                const storageKey = commentToStorageKey.get(commentId);
                                if (!storageKey) return;
                                await manager.updateComment(rdcm.wsId, storageKey, commentId, { status: 'resolved' });
                                if (wsServer) {
                                    wsServer.broadcastProcessEvent({
                                        type: 'diff-comment-updated',
                                        action: 'updated',
                                        workspaceId: rdcm.wsId,
                                        storageKey,
                                        commentId,
                                    });
                                }
                            } catch {
                                // Non-fatal: best-effort resolution
                            }
                        })
                    );
                } catch {
                    // Non-fatal: server-side resolution is best-effort
                }
            }

            return { ...chatResult, revisedContent: chatResult.response, commentIds };
        } finally {
            this.resolvedIdGetters.delete(processId);
        }
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const processId = toQueueProcessId(task.id);
        const { tool, getResolvedIds } = createResolveCommentTool();
        this.resolvedIdGetters.set(processId, getResolvedIds);
        const payload = task.payload as unknown as ChatPayload;
        const isMultiFile = !!payload.context?.resolveDiffCommentsMulti;
        return {
            agentMode: isMultiFile ? 'autopilot' : 'interactive',
            systemMessage: isMultiFile ? undefined : buildModeSystemMessage('ask'),
            tools: [tool as Tool<unknown>],
            effectivePrompt: prompt,
        };
    }
}
