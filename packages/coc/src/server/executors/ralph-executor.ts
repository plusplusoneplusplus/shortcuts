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
 * A ralph-mode task is not always an iteration — final-check and PR-submit tasks
 * ride the same executor. `getRalphTaskKind` (ralph/task-kind.ts) tells them
 * apart; only `'iteration'` gets its prompt rebuilt, the other kinds arrive with
 * a purpose-built prompt that must reach the model unchanged.
 *
 * Per-iteration history lives in `progress.md`, with an agent-owned `context.md`
 * map beside it, under
 *   `~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/`
 * and is referenced by absolute path in the user prompt — see
 * AGENTS.md: "Prefer use file path in the prompt instead of expanding the
 * prompt with file's content."
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as os from 'os';
import * as path from 'path';
import type { AgentMode, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { systemMessageBuilder } from './system-message-builder';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildChatTurnContext } from './chat-turn-context-builder';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { getRalphTaskKind } from '../ralph/task-kind';
import { buildRalphIterationPrompt } from '@plusplusoneplusplus/coc-workflow/ralph';
import { buildSourceLocationMarkdownLinkSystemMessage } from './prompt-builder';

// ============================================================================
// RalphExecutor
// ============================================================================

/**
 * No extra members: the WebSocket accessor arrives through
 * `ChatModeExecutorOptions.runtime`.
 */
export type RalphExecutorOptions = ChatModeExecutorOptions;

export class RalphExecutor extends ChatBaseExecutor {

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

        const kind = getRalphTaskKind(ralphCtx);
        const isIteration = kind === 'iteration';
        const progressPath = this.resolveProgressPath(payload.workspaceId, ralphCtx?.sessionId);
        const contextPath = isIteration
            ? this.resolveContextPath(payload.workspaceId, ralphCtx?.sessionId)
            : undefined;

        const processId = toQueueProcessId(task.id);
        const cronDeps = this.buildCronToolDeps(processId);

        const ctx = await buildChatTurnContext({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            query: prompt,
            followUpSuggestions: this.followUpSuggestions,
            enqueueChat: this.runtime.getEnqueueChat?.(),
            sendMessage: this.runtime.getSendMessage?.(),
            sendToConversationRuntime: this.runtime.getSendToConversationRuntime?.(),
            scheduleWakeup: cronDeps.scheduleWakeup,
            cronTools: cronDeps.cronTools,
        });

        // System message carries only generic, non-Ralph blocks. All Ralph
        // framing lives in the user message (AC-01, AC-02).
        const systemMessage = await systemMessageBuilder()
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            // Final-check is read-only; iterations and submits both need write
            // access (submit pushes a branch and opens the PR).
            .withRepoInstructions(workingDirectory, kind === 'final-check' ? 'ask' : 'ralph')
            .append(buildSourceLocationMarkdownLinkSystemMessage(payload.provider ?? this.provider)?.content)
            .appendMemoryV2(ctx.memoryV2)
            .appendToolGuidance(ctx.toolGuidance)
            .build();

        // Only iterations get their prompt rewritten, so the counter and the
        // context-map pointer are current on every execution. Final-check and
        // submit arrive with a purpose-built prompt — pass it through verbatim,
        // or they end up running an iteration instead of their own job.
        const effectivePrompt = isIteration
            ? buildRalphIterationPrompt({
                originalGoal: ralphCtx?.originalGoal,
                progressPath,
                contextPath,
                currentIteration: ralphCtx?.currentIteration,
                maxIterations: ralphCtx?.maxIterations,
            })
            : prompt;

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
