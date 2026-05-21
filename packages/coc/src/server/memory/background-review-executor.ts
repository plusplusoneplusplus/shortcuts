/**
 * Executor for background-review tasks.
 *
 * Creates a short-lived AI session with the conversation snapshot as
 * context and the review prompt as the user message. The only tool
 * available is the bounded memory tool. The executor:
 *
 * 1. Resolves the per-workspace BoundedMemoryStore
 * 2. Builds the system message with the conversation snapshot
 * 3. Sends the MEMORY_REVIEW_PROMPT as the user message
 * 4. The AI calls the memory tool if it finds facts worth saving
 * 5. Collects results and returns
 */

import type { ISDKService, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import { BoundedMemoryStore, createMemoryTool, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { BackgroundReviewPayload } from './background-review';
import { MEMORY_REVIEW_PROMPT } from './background-review';

export class BackgroundReviewExecutor {
    constructor(
        private readonly aiService: ISDKService,
        private readonly getMemoryStore: (workspaceId: string) => BoundedMemoryStore | undefined,
    ) {}

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();
        const payload = task.payload as unknown as BackgroundReviewPayload;
        const memoryStore = this.getMemoryStore(payload.workspaceId);
        if (!memoryStore) {
            return { success: true, result: 'Memory not enabled for workspace', durationMs: 0 };
        }

        try {
            // 1. Build conversation context from snapshot
            const contextLines = payload.conversationSnapshot.map(
                t => `[${t.role === 'user' ? 'User' : 'Assistant'}]: ${t.content}`,
            );
            const conversationContext = contextLines.join('\n\n');

            // 2. Build system message with conversation + current memory state
            const currentEntries = memoryStore.read();
            const systemParts = [
                'You are reviewing a completed conversation to extract durable facts for persistent memory.',
                '',
                '<conversation>',
                conversationContext,
                '</conversation>',
            ];
            if (currentEntries.length > 0) {
                systemParts.push('', '<current_memory>', currentEntries.join('\n'), '</current_memory>');
            }

            // 3. Create memory tool for this workspace
            const { tool: memoryTool, getWrittenFacts } = createMemoryTool(
                { repo: memoryStore },
                { source: 'background-review' },
            );

            // 4. Send review prompt with only the memory tool
            await this.aiService.sendMessage({
                prompt: MEMORY_REVIEW_PROMPT,
                model: task.config.model,
                systemMessage: { mode: 'replace', content: systemParts.join('\n') },
                tools: [memoryTool],
                workingDirectory: undefined,
                timeoutMs: payload.timeoutMs ?? 60_000,
            });

            // 5. Collect what was saved
            const savedFacts = getWrittenFacts();

            logger.debug(LogCategory.AI, `[BackgroundReview] Review for ${payload.sourceProcessId}: saved ${savedFacts.length} fact(s)`);

            return {
                success: true,
                result: savedFacts.length > 0
                    ? `Saved ${savedFacts.length} fact(s) to memory`
                    : 'Nothing to save',
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.debug(LogCategory.AI, `[BackgroundReview] Review for ${payload.sourceProcessId} failed: ${errorMsg}`);
            return { success: true, result: `Review failed: ${errorMsg}`, durationMs: Date.now() - startTime };
        }
    }
}
