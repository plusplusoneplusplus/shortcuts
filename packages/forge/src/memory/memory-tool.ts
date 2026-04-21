/**
 * Memory Tool Factory — Hermes-style bounded memory tool.
 *
 * Creates a `memory` tool with add/replace/remove actions against a
 * BoundedMemoryStore. Supports two modes:
 *
 *  - `bounded` (default) — direct MEMORY.md mutation, retained for
 *    internal reconciliation flows and backward compatibility.
 *  - `capture` — chat-time mode where `add` appends a raw record to
 *    a RawMemoryRecordStore and returns a success payload without
 *    changing MEMORY.md. `replace`/`remove` are disabled until the
 *    queued reconciler is implemented.
 */
import { defineTool, Tool } from '../copilot-sdk-wrapper/types';
import type { BoundedMemoryStore } from './bounded-memory-store';
import type { RawMemoryRecordStore } from './raw-memory-record-store';
import { scanMemoryContent } from './memory-security-scanner';

// ---------------------------------------------------------------------------
// Option & argument interfaces
// ---------------------------------------------------------------------------

/** Mode for the memory tool — determines how `add` is handled. */
export type MemoryToolMode = 'bounded' | 'capture';

export interface MemoryToolOptions {
    /** Source pipeline/feature name for logging (e.g. 'chat', 'code-review') */
    source: string;
    /** Override which targets the AI can write to. Default: ['memory', 'system'] */
    allowedTargets?: Array<'memory' | 'system'>;
    /** Operating mode. Default: 'bounded'. */
    mode?: MemoryToolMode;
}

/** Extra context for capture mode — attached as metadata to raw records. */
export interface MemoryToolCaptureContext {
    /** Workspace identifier for provenance tracking */
    workspaceId?: string;
    /** Process identifier for provenance tracking */
    processId?: string;
    /** Turn index within the conversation */
    turnIndex?: number;
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

/** Map of target name → RawMemoryRecordStore instance (for capture mode). */
export type MemoryToolRawStores = {
    memory?: RawMemoryRecordStore;
    system?: RawMemoryRecordStore;
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
// Capture-mode result shape
// ---------------------------------------------------------------------------

/** Result returned by a successful capture-mode `add`. */
export interface MemoryToolCaptureResult {
    success: true;
    message: string;
    /** The raw record ID that was persisted */
    recordId: string;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createMemoryTool(
    stores: MemoryToolStores,
    options: MemoryToolOptions,
    captureConfig?: {
        rawStores: MemoryToolRawStores;
        context: MemoryToolCaptureContext;
    },
): { tool: Tool<MemoryToolArgs>; getWrittenFacts: () => string[] } {
    const writtenFacts: string[] = [];
    const allowedTargets = options.allowedTargets ?? ['memory', 'system'];
    const mode: MemoryToolMode = options.mode ?? 'bounded';

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

            // Capture mode: route through raw record store
            if (mode === 'capture') {
                return handleCaptureMode(args, captureConfig, options, writtenFacts);
            }

            // Bounded mode: direct MEMORY.md mutation (original behavior)
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

// ---------------------------------------------------------------------------
// Capture-mode handler (private)
// ---------------------------------------------------------------------------

async function handleCaptureMode(
    args: MemoryToolArgs,
    captureConfig: { rawStores: MemoryToolRawStores; context: MemoryToolCaptureContext } | undefined,
    options: MemoryToolOptions,
    writtenFacts: string[],
): Promise<MemoryToolCaptureResult | { success: false; error: string }> {
    // replace/remove not supported in capture mode
    if (args.action === 'replace' || args.action === 'remove') {
        return {
            success: false,
            error: `'${args.action}' is not supported in capture mode. Memory updates will be reconciled during aggregation.`,
        };
    }

    if (args.action !== 'add') {
        return { success: false, error: `Unknown action '${args.action}'.` };
    }

    if (!args.content) {
        return { success: false, error: "Content is required for 'add' action." };
    }

    if (!captureConfig) {
        return { success: false, error: 'Capture mode is enabled but no raw stores are configured.' };
    }

    const rawStore = captureConfig.rawStores[args.target];
    if (!rawStore) {
        return { success: false, error: `No raw store configured for target '${args.target}'.` };
    }

    // Security scan before accepting
    const trimmed = args.content.trim();
    if (!trimmed) {
        return { success: false, error: 'Content cannot be empty.' };
    }

    const scan = scanMemoryContent(trimmed);
    if (scan.blocked) {
        return { success: false, error: `Content blocked by security scanner: ${scan.reason}` };
    }

    // Map tool target ('memory'/'system') to raw record target ('repo'/'system')
    const rawTarget = args.target === 'memory' ? 'repo' : 'system';

    const record = await rawStore.append({
        target: rawTarget,
        content: trimmed,
        source: options.source,
        workspaceId: captureConfig.context.workspaceId ?? '',
        processId: captureConfig.context.processId ?? null,
        turnIndex: captureConfig.context.turnIndex ?? null,
    });

    writtenFacts.push(trimmed);

    return {
        success: true,
        message: 'Memory candidate captured; memory will update after aggregation.',
        recordId: record.id,
    };
}
