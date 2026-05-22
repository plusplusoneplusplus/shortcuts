/**
 * Pre-compression memory flush.
 *
 * Gives the model one focused turn to persist durable facts before
 * context is compressed or lost. Triggered before cold-resume when
 * the previous session's token utilization was high.
 *
 * Flow:
 * 1. Check if conversation meets minimum turn threshold
 * 2. Build snapshot from recent turns
 * 3. Create a short-lived AI session with the snapshot as context
 * 4. Send the flush prompt with only the memory tool available
 * 5. Return result (flush is invisible to the user)
 */

import type { ConversationTurn, ISDKService } from '@plusplusoneplusplus/forge';
import { BoundedMemoryStore, createMemoryTool, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { countUserTurns, buildReviewSnapshot } from './background-review';

// ── Flush Prompt ───────────────────────────────────────────────────

export const FLUSH_PROMPT = `\
[System: The session context is being compressed. Before context is lost, \
save anything worth remembering to memory — prioritize user preferences, \
corrections, and recurring patterns over task-specific details. \
Use the memory tool to save facts. If nothing is worth saving, \
just say "Nothing to save." and stop.]`;

// ── Types ──────────────────────────────────────────────────────────

export interface FlushOptions {
    /** The conversation turns to review */
    turns: ConversationTurn[];
    /** The bounded memory store to write to */
    memoryStore: BoundedMemoryStore;
    /** AI service for the flush call */
    aiService: ISDKService;
    /** Minimum user turns required to trigger flush (default: 3) */
    minTurns?: number;
    /** Model override for the flush call */
    model?: string;
    /** Timeout in ms (default: 30_000) */
    timeoutMs?: number;
}

export interface FlushResult {
    triggered: boolean;
    factsSaved: number;
    error?: string;
}

// ── Flush Logic ────────────────────────────────────────────────────

/**
 * Execute a pre-compression memory flush.
 *
 * Returns without side effects if the conversation doesn't meet the
 * minimum turn threshold.
 */
export async function flushMemories(options: FlushOptions): Promise<FlushResult> {
    const { turns, memoryStore, aiService, minTurns = 3, model, timeoutMs = 30_000 } = options;
    const logger = getLogger();

    const userTurnCount = countUserTurns(turns);
    if (userTurnCount < minTurns) {
        return { triggered: false, factsSaved: 0 };
    }

    const snapshot = buildReviewSnapshot(turns, 60);
    if (snapshot.length < 2) {
        return { triggered: false, factsSaved: 0 };
    }

    const { tool: memoryTool, getWrittenFacts } = createMemoryTool(
        { repo: memoryStore },
        { source: 'pre-compression-flush' },
    );
    const currentEntries = memoryStore.read();

    const systemParts = [
        'You are saving durable facts before context compression.',
        '',
        '<conversation>',
        ...snapshot.map(t => `[${t.role === 'user' ? 'User' : 'Assistant'}]: ${t.content}`),
        '</conversation>',
    ];
    if (currentEntries.length > 0) {
        systemParts.push('', '<current_memory>', currentEntries.join('\n'), '</current_memory>');
    }

    try {
        await aiService.sendMessage({
            prompt: FLUSH_PROMPT,
            model,
            systemMessage: { mode: 'replace', content: systemParts.join('\n') },
            tools: [memoryTool],
            workingDirectory: undefined,
            timeoutMs,
        });

        const savedFacts = getWrittenFacts();
        logger.debug(LogCategory.AI, `[FlushMemories] Saved ${savedFacts.length} fact(s)`);
        return { triggered: true, factsSaved: savedFacts.length };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(LogCategory.AI, `[FlushMemories] Flush failed: ${errorMsg}`);
        return {
            triggered: true,
            factsSaved: 0,
            error: errorMsg,
        };
    }
}
