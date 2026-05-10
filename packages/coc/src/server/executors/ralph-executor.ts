/**
 * Ralph Executor
 *
 * Concrete executor for `ralph`-mode chat tasks.
 *
 * Ralph mode is a structured AI orchestration loop:
 * - agentMode: 'autopilot' (full read/write permissions)
 * - systemMessage: Ralph framework instructions + goal spec + accumulated progress
 * - Each task is one iteration; the loop is driven by RALPH_NEXT / RALPH_COMPLETE signals
 *
 * Phase 1 (MVP): Single iteration per task, no auto-loop. User supplies goal in prompt
 * or via `context.ralph.originalGoal`. Auto-loop and grill-me are Phase 2/3.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { systemMessageBuilder } from './system-message-builder';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildChatToolBundle } from './chat-tool-builder';

// ============================================================================
// System prompt template
// ============================================================================

const RALPH_BASE_INSTRUCTIONS = `\
You are a focused AI coding agent running in Ralph mode.

Your task:
1. Review the goal spec and any accumulated progress below.
2. Pick the next logical subtask toward the goal — implement one subtask only.
3. Run tests/build to verify your change, then commit with a clear message.

End your response with:

RALPH_PROGRESS:
<file paths created/modified, decisions made, what remains>

Then exactly one of:
RALPH_COMPLETE
RALPH_NEXT`;

function buildRalphSystemMessage(ralph: {
    originalGoal?: string;
    accumulatedProgress?: string;
    currentIteration?: number;
    maxIterations?: number;
}): string {
    const parts: string[] = [RALPH_BASE_INSTRUCTIONS];

    if (ralph.originalGoal) {
        parts.push(`## Goal Spec\n${ralph.originalGoal}`);
    }

    if (ralph.accumulatedProgress) {
        parts.push(`## Progress from Previous Iterations\n${ralph.accumulatedProgress}`);
    }

    const current = ralph.currentIteration ?? 1;
    const max = ralph.maxIterations ?? 10;
    parts.push(`Iteration ${current} of ${max}.`);

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

        const ralphSystemPrompt = buildRalphSystemMessage({
            originalGoal: ralphCtx?.originalGoal,
            accumulatedProgress: ralphCtx?.accumulatedProgress,
            currentIteration: ralphCtx?.currentIteration,
            maxIterations: ralphCtx?.maxIterations,
        });

        const boundedMemory = await this.buildMemoryAddon(payload.workspaceId, this.buildCaptureContext(task), prompt);

        const systemMessage = await systemMessageBuilder()
            .append(ralphSystemPrompt)
            .withRepoInstructions(workingDirectory, 'ralph')
            .appendMemory(boundedMemory)
            .build();

        const { tools, suffix } = buildChatToolBundle({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId: toQueueProcessId(task.id),
            followUpSuggestions: this.followUpSuggestions,
            broadcastWorkItem: this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                : undefined,
            boundedMemory,
        });

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + suffix,
            dispose: boundedMemory.dispose,
        };
    }
}

// ============================================================================
// Helpers (exported for testing)
// ============================================================================

export { buildRalphSystemMessage };
