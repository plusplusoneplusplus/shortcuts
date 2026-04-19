/**
 * Memory Tool Factory — Hermes-style bounded memory tool.
 *
 * Creates a `memory` tool with add/replace/remove actions against a
 * BoundedMemoryStore. The AI manages its own memory online during
 * conversation — no offline batch pipeline needed.
 */
import { defineTool, Tool } from '../copilot-sdk-wrapper/types';
import type { BoundedMemoryStore } from './bounded-memory-store';

// ---------------------------------------------------------------------------
// Option & argument interfaces
// ---------------------------------------------------------------------------

export interface MemoryToolOptions {
    /** Source pipeline/feature name for logging (e.g. 'chat', 'code-review') */
    source: string;
    /** Override which targets the AI can write to. Default: ['memory', 'system'] */
    allowedTargets?: Array<'memory' | 'system'>;
}

export interface MemoryToolArgs {
    /** The action to perform */
    action: 'add' | 'replace' | 'remove';
    /** Which memory store: 'memory' for repo-scoped notes, 'system' for global */
    target: 'memory' | 'system';
    /** The entry content. Required for 'add' and 'replace'. */
    content?: string;
    /** Short unique substring identifying the entry to replace or remove. */
    old_text?: string;
}

/** Map of target name → BoundedMemoryStore instance. */
export type MemoryToolStores = {
    memory?: BoundedMemoryStore;
    system?: BoundedMemoryStore;
};

// ---------------------------------------------------------------------------
// Tool description — behavioral guidance embedded in the schema (Hermes pattern)
// ---------------------------------------------------------------------------

/**
 * Full tool description with parameter docs and behavioral guidance.
 * Exported for admin dashboard prompt inspection.
 */
export const MEMORY_SCHEMA =
    'Save durable information to persistent memory that survives across sessions.\n'
    + 'Memory is injected into future turns, so keep it compact and focused on facts\n'
    + 'that will still matter later.\n'
    + '\n'
    + 'WHEN TO SAVE (do this proactively, don\'t wait to be asked):\n'
    + '- User corrects you or says \'remember this\' / \'don\'t do that again\'\n'
    + '- User shares a preference, habit, or personal detail (name, role, timezone, coding style)\n'
    + '- You discover something about the environment (OS, tools, project structure)\n'
    + '- You learn a convention, API quirk, or workflow specific to this codebase\n'
    + '- You identify a stable fact that will be useful again in future sessions\n'
    + '\n'
    + 'PRIORITY: User preferences and corrections > environment facts > procedural knowledge.\n'
    + 'The most valuable memory prevents the user from having to repeat themselves.\n'
    + '\n'
    + 'Do NOT save task progress, session outcomes, completed-work logs, or temporary TODO state.\n'
    + '\n'
    + 'TWO TARGETS:\n'
    + '- \'memory\': repo-scoped notes — project conventions, tool quirks, environment facts\n'
    + '- \'system\': global notes — cross-repo preferences, general patterns\n'
    + '\n'
    + 'ACTIONS: add (new entry), replace (update existing — old_text identifies it),\n'
    + 'remove (delete — old_text identifies it).\n'
    + '\n'
    + 'SKIP: trivial/obvious info, things easily re-discovered, raw data dumps, temporary task state.';

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createMemoryTool(
    stores: MemoryToolStores,
    options: MemoryToolOptions,
): { tool: Tool<MemoryToolArgs>; getWrittenFacts: () => string[] } {
    const writtenFacts: string[] = [];
    const allowedTargets = options.allowedTargets ?? ['memory', 'system'];

    const tool = defineTool<MemoryToolArgs>('memory', {
        description: MEMORY_SCHEMA,
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['add', 'replace', 'remove'],
                    description: 'The action to perform.',
                },
                target: {
                    type: 'string',
                    enum: ['memory', 'system'],
                    description: "Which memory store: 'memory' for repo-scoped notes, 'system' for global notes.",
                },
                content: {
                    type: 'string',
                    description: "The entry content. Required for 'add' and 'replace'.",
                },
                old_text: {
                    type: 'string',
                    description: 'Short unique substring identifying the entry to replace or remove.',
                },
            },
            required: ['action', 'target'],
        },
        handler: async (args) => {
            // 1. Validate target is allowed
            if (!allowedTargets.includes(args.target)) {
                return { success: false, error: `Target '${args.target}' is not available.` };
            }

            // 2. Resolve store for target
            const store = stores[args.target];
            if (!store) {
                return { success: false, error: `No store configured for target '${args.target}'.` };
            }

            // 3. Dispatch by action
            switch (args.action) {
                case 'add': {
                    if (!args.content) {
                        return { success: false, error: "Content is required for 'add' action." };
                    }
                    const result = await store.add(args.content);
                    if (result.success) writtenFacts.push(args.content);
                    return result;
                }
                case 'replace': {
                    if (!args.old_text) {
                        return { success: false, error: "old_text is required for 'replace' action." };
                    }
                    if (!args.content) {
                        return { success: false, error: "content is required for 'replace' action." };
                    }
                    const result = await store.replace(args.old_text, args.content);
                    if (result.success) writtenFacts.push(args.content);
                    return result;
                }
                case 'remove': {
                    if (!args.old_text) {
                        return { success: false, error: "old_text is required for 'remove' action." };
                    }
                    return store.remove(args.old_text);
                }
                default:
                    return { success: false, error: `Unknown action '${(args as any).action}'.` };
            }
        },
    });

    return { tool, getWrittenFacts: () => [...writtenFacts] };
}
