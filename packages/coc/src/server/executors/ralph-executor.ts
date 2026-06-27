/**
 * Ralph Executor
 *
 * Concrete executor for `ralph`-mode chat tasks.
 *
 * Ralph mode is a structured AI orchestration loop:
 * - agentMode: 'autopilot' (full read/write permissions)
 * - systemMessage: generic non-Ralph blocks only (repo instructions, memory,
 *   tool guidance) — no Ralph-specific content
 * - Each iteration's user message is built fresh from buildRalphIterationPrompt,
 *   carrying the ultra-ralph skill pointer, progress/context paths, iteration
 *   counter, and goal
 * - Each task is one iteration; the loop is driven by RALPH_NEXT / RALPH_COMPLETE signals
 *
 * Per-iteration history lives in `progress.md`, with an agent-owned `context.md`
 * map beside it, under
 *   `~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/`
 * and is referenced by absolute path in the user prompt — see
 * AGENTS.md: "Prefer use file path in the prompt instead of expanding the
 * prompt with file's content."
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as os from 'os';
import * as path from 'path';
import type { AgentMode, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { systemMessageBuilder } from './system-message-builder';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildChatTurnContext } from './chat-turn-context-builder';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { buildRalphIterationPrompt } from '@plusplusoneplusplus/coc-workflow/ralph';
import { buildSourceLocationMarkdownLinkSystemMessage } from './prompt-builder';

// ============================================================================
// RalphExecutor
// ============================================================================

export interface RalphExecutorOptions extends ChatModeExecutorOptions {
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

export class RalphExecutor extends ChatBaseExecutor {
    private readonly getWsServerFn?: () => ProcessWebSocketServer | undefined;

    constructor(store: ProcessStore, options: RalphExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
        this.getWsServerFn = options.getWsServer;
    }

    /** Ralph runs back-to-back chat turns — keep the client warm between them. */
    protected override keepClientWarm(): boolean {
        return true;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const ralphCtx = payload.context?.ralph;

        const isFinalCheck = !!ralphCtx?.finalCheck;
        const progressPath = this.resolveProgressPath(payload.workspaceId, ralphCtx?.sessionId);
        const contextPath = isFinalCheck
            ? undefined
            : this.resolveContextPath(payload.workspaceId, ralphCtx?.sessionId);

        const processId = toQueueProcessId(task.id);
        const loopDeps = this.buildLoopToolDeps(processId);

        const ctx = await buildChatTurnContext({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            query: prompt,
            followUpSuggestions: this.followUpSuggestions,
            broadcastWorkItem: this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                : undefined,
            enqueueChat: this.getEnqueueChat?.(),
            scheduleWakeup: loopDeps.scheduleWakeup,
            loopTools: loopDeps.loopTools,
        });

        // System message carries only generic, non-Ralph blocks. All Ralph
        // framing lives in the user message (AC-01, AC-02).
        const systemMessage = await systemMessageBuilder()
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .withRepoInstructions(workingDirectory, isFinalCheck ? 'ask' : 'ralph')
            .append(buildSourceLocationMarkdownLinkSystemMessage(payload.provider ?? this.provider)?.content)
            .appendMemoryV2(ctx.memoryV2)
            .appendToolGuidance(ctx.toolGuidance)
            .build();

        // Build a fresh user prompt on every execution so the iteration counter
        // and progress path are always current (the bridge re-enqueues with the
        // original stored prompt; overriding here ensures correctness for every
        // iteration).
        const effectivePrompt = isFinalCheck
            ? prompt
            : buildRalphIterationPrompt({
                originalGoal: ralphCtx?.originalGoal,
                progressPath,
                contextPath,
                currentIteration: ralphCtx?.currentIteration,
                maxIterations: ralphCtx?.maxIterations,
            });

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools: ctx.tools,
            effectivePrompt,
            excludedTools: ctx.excludedTools,
            dispose: ctx.dispose,
        };
    }

    private resolveProgressPath(workspaceId?: string, sessionId?: string): string | undefined {
        if (!workspaceId || !sessionId) return undefined;
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const store = new RalphSessionStore({ dataDir: effectiveDataDir });
        return store.getProgressPath(workspaceId, sessionId);
    }

    private resolveContextPath(workspaceId?: string, sessionId?: string): string | undefined {
        if (!workspaceId || !sessionId) return undefined;
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const store = new RalphSessionStore({ dataDir: effectiveDataDir });
        return store.getContextPath(workspaceId, sessionId);
    }
}

// ============================================================================
// Helpers (exported for testing)
// ============================================================================
