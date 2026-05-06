/**
 * Plan Executor
 *
 * Concrete executor for `plan`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply plan-mode specific AI options:
 * - agentMode: 'plan'
 * - systemMessage: READ_ONLY_SYSTEM_MESSAGE + auto-folder location block (AI
 *   proposes changes but may write plan files to the tasks directory)
 * - tools: follow-up suggestion tool (when configured)
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

// ============================================================================
// PlanExecutor
// ============================================================================

export interface PlanExecutorOptions extends ChatModeExecutorOptions {
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

export class PlanExecutor extends ChatBaseExecutor {
    private readonly getWsServerFn?: () => ProcessWebSocketServer | undefined;

    constructor(store: ProcessStore, options: PlanExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
        this.getWsServerFn = options.getWsServer;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        return this.buildStandardModeOptions(
            task,
            prompt,
            'plan',
            workingDirectory,
            this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event)
                : undefined,
        );
    }
}
