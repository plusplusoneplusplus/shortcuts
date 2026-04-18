import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../ai/types';
import type { MemoryStore, MemoryLevel } from './types';
import { MemoryRetriever } from './memory-retriever';
import { createMemoryTool, MemoryToolStores } from './memory-tool';
import { MemoryAggregator } from './memory-aggregator';
import { getAIServiceLogger } from '../ai-logger';

export interface WithMemoryOptions {
    store: MemoryStore;
    /** Bounded stores for the memory tool. When provided, a `memory` tool is
     *  injected into the AI call. Map target names to store instances. */
    boundedStores?: MemoryToolStores;
    source: string;
    repoHash?: string;
    /** Explicit repo-level directory, alternative to repoHash. */
    repoDir?: string;
    level?: MemoryLevel;
    model?: string;
    repo?: string;
    batchThreshold?: number;
}

export async function withMemory(
    aiInvoker: AIInvoker,
    prompt: string,
    invokerOptions: AIInvokerOptions,
    memoryOptions: WithMemoryOptions,
): Promise<AIInvokerResult> {
    const level = memoryOptions.level ?? 'both';

    // 1. Retrieve existing memory context
    let enrichedPrompt = prompt;
    try {
        const retriever = new MemoryRetriever(memoryOptions.store);
        const context = await retriever.retrieve(level, memoryOptions.repoHash);
        if (context) {
            enrichedPrompt = context + '\n\n' + prompt;
        }
    } catch (err) {
        getAIServiceLogger().warn({ err }, 'withMemory: retrieve failed, proceeding without context');
    }

    // 2. Create memory tool if bounded stores are provided
    const existingTools = invokerOptions.tools ?? [];
    let mergedTools = existingTools;
    if (memoryOptions.boundedStores) {
        const { tool: memoryTool } = createMemoryTool(memoryOptions.boundedStores, {
            source: memoryOptions.source,
        });
        mergedTools = [...existingTools, memoryTool];
    }
    const mergedOptions: AIInvokerOptions = {
        ...invokerOptions,
        tools: mergedTools,
    };

    // 3. Invoke AI with enriched prompt and injected tool
    const result = await aiInvoker(enrichedPrompt, mergedOptions);

    // 4. Check if aggregation is needed (non-blocking)
    try {
        const aggregator = new MemoryAggregator(memoryOptions.store, {
            batchThreshold: memoryOptions.batchThreshold ?? 5,
        });
        await aggregator.aggregateIfNeeded(aiInvoker, level, memoryOptions.repoHash);
    } catch (err) {
        getAIServiceLogger().warn({ err }, 'withMemory: aggregation check failed');
    }

    // 5. Return original AI result unchanged
    return result;
}
