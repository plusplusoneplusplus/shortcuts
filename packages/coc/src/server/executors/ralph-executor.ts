/**
 * Ralph Executor
 *
 * Concrete executor for `ralph`-mode chat tasks.
 *
 * Ralph mode is a structured AI orchestration loop:
 * - agentMode: 'autopilot' (full read/write permissions)
 * - systemMessage: Ralph framework instructions + goal spec + a *file path*
 *   to the per-session progress journal (no inlined history)
 * - Each task is one iteration; the loop is driven by RALPH_NEXT / RALPH_COMPLETE signals
 *
 * Per-iteration history lives in `progress.md` under
 *   `~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/`
 * and is referenced by absolute path in the system prompt — see
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
import { getPromptOverride } from '../admin/ralph-prompt-overrides';

// ============================================================================
// System prompt template
// ============================================================================

export const RALPH_BASE_INSTRUCTIONS = `\
You are a focused AI coding agent running in Ralph mode.

Your task each iteration:
1. Read the goal spec below.
2. Read your accumulated progress journal at the path noted below — grep
   for filenames or decisions before choosing the next subtask, so you do
   not redo prior work.
3. Pick the next logical subtask toward the goal — implement one subtask only.
4. Run tests/build to verify your change, then commit with a clear message.

When done with this iteration, you MUST:

A. Append a new section to the progress journal with this exact header
   grammar (em-dash or ASCII dash; ISO timestamp):

       ## Iteration <N> — <SIGNAL> — <ISO timestamp>
       Files: <comma-separated list of files created/modified>
       Decisions: <one-line rationale for the key choices made>
       Remaining: <what still has to happen, or "none">

   <SIGNAL> is RALPH_NEXT or RALPH_COMPLETE — same value you end the
   response with. Use the iteration counter from the system prompt.

B. End the response with exactly one of:
       RALPH_COMPLETE
       RALPH_NEXT

If you cannot append to the file, fall back to the legacy format and
the server will write the section for you:

        RALPH_PROGRESS:
        <files / decisions / remaining>
        <SIGNAL>`;

export const RALPH_FINAL_CHECK_BASE_INSTRUCTIONS = `\
You are a read-only validation agent for a completed Ralph implementation loop.

You are still running with autopilot execution capabilities so you can inspect
the repository and run validation commands, but you must not change repository
or CoC state.

Allowed:
1. Read files and the Ralph progress journal.
2. Inspect git history, status, and diffs.
3. Run validation commands that do not modify files, commits, branches, remotes,
   work items, sessions, loops, schedules, or other persistent state.

Forbidden:
1. Do not edit, create, delete, rename, or format files.
2. Do not commit, amend, rebase, merge, push, checkout, reset, or stash.
3. Do not call APIs or tools that create/update work items, sessions, loops,
   schedules, notes, memories, or other persistent state.
4. Do not start another Ralph session or loop yourself.

Your only job is to compare the original goal/spec, the progress journal, the
actual repository state, and validation evidence. Your final response must
contain exactly one RALPH_FINAL_CHECK_RESULT JSON block as requested by the user
prompt. Do not end with RALPH_NEXT or RALPH_COMPLETE. The server will append the
final-check result to progress.md after parsing your response.`;

export interface BuildRalphSystemMessageInput {
    originalGoal?: string;
    /** Absolute path to the per-session `progress.md` (when known). */
    progressPath?: string;
    currentIteration?: number;
    maxIterations?: number;
}

function buildRalphSystemMessage(ralph: BuildRalphSystemMessageInput, baseInstructions?: string): string {
    const parts: string[] = [baseInstructions ?? RALPH_BASE_INSTRUCTIONS];

    if (ralph.originalGoal) {
        parts.push(`## Goal Spec\n${ralph.originalGoal}`);
    }

    if (ralph.progressPath) {
        parts.push(
            `## Progress Journal\nYour accumulated progress journal is at:\n  ${ralph.progressPath}\nRead and grep this file before deciding the next subtask. It is append-only Markdown with one \`## Iteration N — SIGNAL — TIMESTAMP\` section per completed iteration.`,
        );
    }

    const current = ralph.currentIteration ?? 1;
    const max = ralph.maxIterations ?? 20;
    parts.push(`Iteration ${current} of ${max}.`);

    return parts.join('\n\n');
}

function buildRalphFinalCheckSystemMessage(ralph: BuildRalphSystemMessageInput): string {
    const parts: string[] = [RALPH_FINAL_CHECK_BASE_INSTRUCTIONS];

    if (ralph.originalGoal) {
        parts.push(`## Goal Spec\n${ralph.originalGoal}`);
    }

    if (ralph.progressPath) {
        parts.push(
            `## Progress Journal\nRead the Ralph progress journal at:\n  ${ralph.progressPath}\nUse it only as input evidence. Do not append to or edit it.`,
        );
    }

    const current = ralph.currentIteration ?? 1;
    const max = ralph.maxIterations ?? current;
    parts.push(`Final check for Ralph iteration ${current} of ${max}.`);

    return parts.join('\n\n');
}

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

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const ralphCtx = payload.context?.ralph;

        const progressPath = this.resolveProgressPath(payload.workspaceId, ralphCtx?.sessionId);

        const isFinalCheck = !!ralphCtx?.finalCheck;

        const resolvedBaseInstructions = this.dataDir
            ? (getPromptOverride('ralph-execution-system', this.dataDir) ?? RALPH_BASE_INSTRUCTIONS)
            : RALPH_BASE_INSTRUCTIONS;

        const ralphPromptInput = {
            originalGoal: ralphCtx?.originalGoal,
            progressPath,
            currentIteration: ralphCtx?.currentIteration,
            maxIterations: ralphCtx?.maxIterations,
        };

        const ralphSystemPrompt = isFinalCheck
            ? buildRalphFinalCheckSystemMessage(ralphPromptInput)
            : buildRalphSystemMessage(ralphPromptInput, resolvedBaseInstructions);

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
            scheduleWakeup: loopDeps.scheduleWakeup,
            loopTools: loopDeps.loopTools,
        });

        const systemMessage = await systemMessageBuilder()
            .append(ralphSystemPrompt)
            .withRepoInstructions(workingDirectory, isFinalCheck ? 'ask' : 'ralph')
            .appendMemoryV2(ctx.memoryV2)
            .appendToolGuidance(ctx.toolGuidance)
            .build();

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools: ctx.tools,
            effectivePrompt: prompt,
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
}

// ============================================================================
// Helpers (exported for testing)
// ============================================================================

export { buildRalphSystemMessage, buildRalphFinalCheckSystemMessage };
