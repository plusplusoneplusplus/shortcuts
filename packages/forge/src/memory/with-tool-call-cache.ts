/**
 * Tool Call Cache Orchestrator
 *
 * Mirrors the withMemory() pattern: install onToolEvent callback → invoke AI →
 * trigger aggregation. Returns the AI result unchanged.
 *
 * NOTE: Pre-execution retrieval (cache hit → skip tool) requires an onBeforeToolExecution
 * hook in the SDK. For v1, we only capture + aggregate. Retrieval is available via
 * ToolCallCacheRetriever for manual use by callers.
 *
 * No VS Code dependencies — pure Node.js.
 */

import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../ai/types';
import type { ToolEvent } from '../copilot-sdk-wrapper/types';
import type { ToolCallCacheStore, ToolCallFilter, ToolCallCacheLevel } from './tool-call-cache-types';
import { ToolCallCapture } from './tool-call-capture';
import { ToolCallCacheAggregator } from './tool-call-cache-aggregator';
import { getAIServiceLogger } from '../ai-logger';

export interface WithToolCallCacheOptions {
    /** The backing store for raw Q&A entries and consolidated index */
    store: ToolCallCacheStore;
    /** Filter determining which tool calls to capture */
    filter: ToolCallFilter;
    /** Current repo hash for scoped storage */
    repoHash?: string;
    /** Current git HEAD hash for staleness tracking */
    gitHash?: string;
    /** Cache isolation level (default: 'system') */
    level?: ToolCallCacheLevel;
    /** Git remote URL hash. Required when level is 'git-remote'. */
    remoteHash?: string;
    /** AI model identifier for metadata */
    model?: string;
    /** Number of raw entries before triggering aggregation (default: 10) */
    batchThreshold?: number;
    /** How to handle stale cache entries: 'skip' ignores them, 'warn' returns with warning, 'revalidate' triggers AI re-check */
    stalenessStrategy?: 'skip' | 'warn' | 'revalidate';
}

/** Extended invoker options that may include the SDK-level onToolEvent */
interface AIInvokerOptionsWithToolEvent extends AIInvokerOptions {
    onToolEvent?: (event: ToolEvent) => void;
}

function mergeToolEventHandlers(
    existing: ((event: ToolEvent) => void) | undefined,
    capture: (event: ToolEvent) => void,
): (event: ToolEvent) => void {
    if (!existing) return capture;
    return (event: ToolEvent) => {
        // Always call existing handler first (preserve caller behavior)
        try { existing(event); } catch { /* swallow — caller's handler error shouldn't break capture */ }
        // Then call capture handler
        try { capture(event); } catch { /* swallow — capture error shouldn't break pipeline */ }
    };
}

export async function withToolCallCache(
    aiInvoker: AIInvoker,
    prompt: string,
    invokerOptions: AIInvokerOptionsWithToolEvent,
    cacheOptions: WithToolCallCacheOptions,
): Promise<AIInvokerResult> {
    // Warn if git-remote level is requested but remoteHash is missing
    if (cacheOptions.level === 'git-remote' && !cacheOptions.remoteHash) {
        getAIServiceLogger().warn({ level: cacheOptions.level }, `withToolCallCache: level 'git-remote' requested but remoteHash is missing; falling back to 'system'`);
    }

    // 1. Create capture instance and merge onToolEvent
    let mergedOptions: AIInvokerOptionsWithToolEvent = { ...invokerOptions };
    try {
        const capture = new ToolCallCapture(cacheOptions.store, cacheOptions.filter, {
            gitHash: cacheOptions.gitHash,
            repoHash: cacheOptions.repoHash,
        });
        const captureHandler = capture.createToolEventHandler();
        mergedOptions = {
            ...invokerOptions,
            onToolEvent: mergeToolEventHandlers(invokerOptions.onToolEvent, captureHandler),
        };
    } catch (err) {
        getAIServiceLogger().warn({ err }, 'withToolCallCache: capture setup failed, proceeding without capture');
    }

    // 2. Invoke AI with (possibly modified) options
    const result = await aiInvoker(prompt, mergedOptions);

    // 3. Post-invocation aggregation check (non-blocking)
    try {
        const aggregator = new ToolCallCacheAggregator(cacheOptions.store, {
            batchThreshold: cacheOptions.batchThreshold ?? 10,
        });
        await aggregator.aggregateIfNeeded(aiInvoker);
    } catch (err) {
        getAIServiceLogger().warn({ err }, 'withToolCallCache: aggregation check failed');
    }

    // 4. Return original AI result unchanged
    return result;
}
