import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../map-reduce/types';
import type { MemoryStore, MemoryLevel } from './types';
import { MemoryRetriever } from './memory-retriever';
import { createWriteMemoryTool } from './write-memory-tool';
import { MemoryAggregator } from './memory-aggregator';
import { getLogger, LogCategory } from '../logger';

export interface WithMemoryOptions {
    store: MemoryStore;
    source: string;
    repoHash?: string;
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
        getLogger().warn(LogCategory.Memory, `withMemory: retrieve failed, proceeding without context: ${err}`);
    }

    // 2. Create write_memory tool and merge with existing tools
    const { tool: memoryTool } = createWriteMemoryTool(memoryOptions.store, {
        source: memoryOptions.source,
        repoHash: memoryOptions.repoHash,
        level,
        model: memoryOptions.model,
        repo: memoryOptions.repo,
    });
    const existingTools = invokerOptions.tools ?? [];
    const mergedOptions: AIInvokerOptions = {
        ...invokerOptions,
        tools: [...existingTools, memoryTool],
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
        getLogger().warn(LogCategory.Memory, `withMemory: aggregation check failed: ${err}`);
    }

    // 5. Return original AI result unchanged
    return result;
}
