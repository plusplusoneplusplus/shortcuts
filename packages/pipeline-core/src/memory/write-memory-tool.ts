/**
 * Write Memory Tool Factory
 *
 * Creates a `write_memory` tool that AI sessions can call to capture facts
 * worth remembering. Follows the `createResolveCommentTool` per-invocation
 * factory pattern — each caller gets its own accumulator.
 */
import { defineTool, Tool } from '../copilot-sdk-wrapper/types';
import { MemoryStore, MemoryLevel, RawObservationMetadata } from './types';

// ---------------------------------------------------------------------------
// Option & argument interfaces
// ---------------------------------------------------------------------------

export interface WriteMemoryToolOptions {
    /** Source pipeline/feature name (e.g. 'code-review', 'wiki-ask') */
    source: string;
    /** Repo hash for repo-level writes. Omit for system-only. */
    repoHash?: string;
    /** Memory level to write to. Default: 'both' */
    level?: MemoryLevel;
    /** AI model name for observation metadata */
    model?: string;
    /** Repository identifier for observation metadata (e.g. 'github/shortcuts') */
    repo?: string;
}

export interface WriteMemoryArgs {
    /** A concise fact to remember (one sentence) */
    fact: string;
    /** Topic category for the fact */
    category?: string;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createWriteMemoryTool(
    store: MemoryStore,
    options: WriteMemoryToolOptions,
): { tool: Tool<WriteMemoryArgs>; getWrittenFacts: () => string[] } {
    const writtenFacts: string[] = [];
    const level = options.level ?? 'both';

    const tool = defineTool<WriteMemoryArgs>('write_memory', {
        description:
            'Store a fact worth remembering for future tasks on this codebase. '
            + 'Call this when you notice coding conventions, architecture decisions, '
            + 'common gotchas, or tool/library usage patterns.',
        parameters: {
            type: 'object',
            properties: {
                fact: { type: 'string', description: 'A concise fact to remember (one sentence)' },
                category: {
                    type: 'string',
                    enum: ['conventions', 'architecture', 'gotchas', 'tools', 'patterns'],
                    description: 'Topic category for the fact',
                },
            },
            required: ['fact'],
        },
        handler: async (args) => {
            const metadata: RawObservationMetadata = {
                pipeline: options.source,
                timestamp: new Date().toISOString(),
                ...(options.repo && { repo: options.repo }),
                ...(options.model && { model: options.model }),
            };

            const content = args.category
                ? `## ${args.category}\n\n- ${args.fact}`
                : `- ${args.fact}`;

            await store.writeRaw(level, options.repoHash, metadata, content);
            writtenFacts.push(args.fact);

            return { stored: true };
        },
    });

    return { tool, getWrittenFacts: () => [...writtenFacts] };
}
