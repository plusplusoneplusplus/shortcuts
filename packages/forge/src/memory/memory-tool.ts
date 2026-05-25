/**
 * Memory Tool Factory — capture-mode memory tool.
 *
 * Creates a `memory` tool that captures add requests for later promotion.
 * replace/remove actions are not supported.
 */
import * as crypto from 'crypto';
import { defineTool, Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { scanMemoryContent } from './memory-security-scanner';
import type { MemoryScanResult, ThreatPatternId } from './memory-security-scanner';

// Re-export for consumers
export type { MemoryScanResult, ThreatPatternId };

// ---------------------------------------------------------------------------
// Option & argument interfaces
// ---------------------------------------------------------------------------

/** How aggressively the AI should write memory entries. */
export type MemoryWriteFrequency = 'low' | 'medium' | 'high';

/** Mode for the memory tool. */
export type MemoryToolMode = 'capture';

export interface MemoryToolOptions {
    /** Source pipeline/feature name for logging (e.g. 'chat', 'code-review') */
    source: string;
    /** Override which targets the AI can write to. Default: ['repo', 'system'] */
    allowedTargets?: Array<'repo' | 'system'>;
    /** Operating mode. Default: 'capture'. */
    mode?: MemoryToolMode;
    /** Controls how aggressively the AI writes memory entries. Default: 'medium'. */
    writeFrequency?: MemoryWriteFrequency;
}

/** Extra context for capture mode — attached as candidate provenance. */
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
    /** Which memory store: 'repo' for repo-scoped notes, 'system' for global */
    target: 'repo' | 'system';
    /** The entry content. Required for 'add' and 'replace'. */
    content?: string;
    /** Short unique substring identifying the entry to replace or remove. */
    old_text?: string;
    /** True only when the user explicitly asked to remember/save this fact. */
    explicitMemoryIntent?: boolean;
}

/** Captured candidate shape passed to onCandidateCaptured. */
export interface CapturedCandidate {
    id: string;
    target: 'repo' | 'system';
    content: string;
    source: string;
    workspaceId: string;
    processId: string | null;
    turnIndex: number | null;
    explicitMemoryIntent: boolean;
    score: number;
}

export type MemoryCandidateCapturedCallback = (
    event: {
        target: 'repo' | 'system';
        candidate: CapturedCandidate;
        context: MemoryToolCaptureContext;
    },
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Tool description — behavioral guidance embedded in the schema (Hermes pattern)
// ---------------------------------------------------------------------------

/**
 * Full tool description with parameter docs and behavioral guidance.
 * Exported for admin dashboard prompt inspection.
 */
export const MEMORY_SCHEMA =
    'Save durable, high-value facts to persistent memory that survives across sessions.\n'
    + 'Memory is injected into every future turn — keep entries compact and high-signal.\n'
    + '\n'
    + 'WHEN TO SAVE (proactively, when the fact is clearly worth keeping):\n'
    + '- User corrects you, says \'remember this\', or \'don\'t do that again\'\n'
    + '- User shares a preference, habit, or personal detail (name, role, timezone, style)\n'
    + '- You discover something stable about the environment (OS, tools, layout, key paths)\n'
    + '- You learn a convention, quirk, or workflow specific to this user\'s setup\n'
    + '- A failure has a non-obvious fix worth keeping for next time\n'
    + '- Any fact that took >1 tool call to discover and will clearly be useful again\n'
    + '\n'
    + 'PRIORITY: user corrections > preferences > environment facts > procedure.\n'
    + 'The most valuable memory prevents the user from repeating themselves and\n'
    + 'prevents you from re-deriving the same fact next session.\n'
    + '\n'
    + 'SKIP everything else: task progress, completed-work logs, current TODO state,\n'
    + 'trivia, one-shot ephemera, things already in context files (AGENTS.md, repo docs,\n'
    + 'user profile), or facts that are easily re-derived. If a fact isn\'t clearly\n'
    + 'valuable for future sessions, don\'t save it.\n'
    + '\n'
    + 'TARGETS: \'repo\' = current project/workspace. \'system\' = cross-project / user-wide.\n'
    + 'ACTIONS: add | replace (old_text identifies entry) | remove (old_text identifies entry).';

// ---------------------------------------------------------------------------
// Frequency-specific prompt text
// ---------------------------------------------------------------------------

const MEMORY_SCHEMA_LOW =
    'Save facts to persistent memory that survives across sessions.\n'
    + 'Memory is injected into every future turn — keep entries compact and high-signal.\n'
    + '\n'
    + 'WHEN TO SAVE (only on explicit request):\n'
    + '- User explicitly says \'remember this\', \'save this\', or \'don\'t do that again\'\n'
    + '- User corrects you and the correction matters for future sessions\n'
    + '\n'
    + 'SKIP everything else: preferences you infer, environment facts you discover,\n'
    + 'conventions, workflow patterns, project structure, debugging strategies,\n'
    + 'task progress, completed-work logs, trivia, one-shot ephemera, things already\n'
    + 'in context files, or facts that are easily re-derived. Do NOT proactively\n'
    + 'save facts the user did not explicitly ask you to remember.\n'
    + '\n'
    + 'TARGETS: \'repo\' = current project/workspace. \'system\' = cross-project / user-wide.\n'
    + 'ACTIONS: add | replace (old_text identifies entry) | remove (old_text identifies entry).';

const MEMORY_SCHEMA_HIGH =
    'Save durable facts to persistent memory that survives across sessions.\n'
    + 'Memory is injected into every future turn — keep entries compact and high-signal.\n'
    + '\n'
    + 'WHEN TO SAVE (actively capture; err on the side of saving):\n'
    + '- User corrects you, says \'remember this\', or \'don\'t do that again\'\n'
    + '- User shares a preference, habit, or personal detail (name, role, timezone, style)\n'
    + '- You discover something stable about the environment (OS, tools, layout, key paths)\n'
    + '- You learn a convention, quirk, or workflow specific to this user\'s setup\n'
    + '- A failure has a non-obvious fix worth keeping for next time\n'
    + '- Any fact that took >1 tool call to discover and will clearly be useful again\n'
    + '- Workflow patterns, recurring tool configurations, project structure insights\n'
    + '- Dependency choices, debugging strategies, naming conventions observed in code\n'
    + '- Architectural decisions discussed during the conversation\n'
    + '\n'
    + 'PRIORITY: user corrections > preferences > environment facts > patterns > procedure.\n'
    + 'When in doubt, save it — storage is cheap and forgetting is expensive.\n'
    + '\n'
    + 'SKIP only: exact duplicates of existing entries, raw task progress/status,\n'
    + 'and content already in AGENTS.md or MEMORY.md.\n'
    + '\n'
    + 'TARGETS: \'repo\' = current project/workspace. \'system\' = cross-project / user-wide.\n'
    + 'ACTIONS: add | replace (old_text identifies entry) | remove (old_text identifies entry).';

/**
 * Returns the level-specific tool description for the memory tool.
 * Falls back to `MEMORY_SCHEMA` (medium) when frequency is undefined.
 */
export function getMemorySchema(frequency?: MemoryWriteFrequency): string {
    switch (frequency) {
        case 'low': return MEMORY_SCHEMA_LOW;
        case 'high': return MEMORY_SCHEMA_HIGH;
        default: return MEMORY_SCHEMA;
    }
}

// ---------------------------------------------------------------------------
// Capture-mode result shape
// ---------------------------------------------------------------------------

/** Result returned by a successful capture-mode `add`. */
export interface MemoryToolCaptureResult {
    success: true;
    message: string;
    /** The candidate ID that was persisted */
    candidateId?: string;
    /** The persisted candidate ID */
    recordId: string;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createMemoryTool(
    options: MemoryToolOptions,
    captureConfig?: {
        context: MemoryToolCaptureContext;
        onCandidateCaptured?: MemoryCandidateCapturedCallback;
    },
): { tool: Tool<MemoryToolArgs>; getWrittenFacts: () => string[] } {
    const writtenFacts: string[] = [];
    const allowedTargets = options.allowedTargets ?? ['repo', 'system'];

    const tool = defineTool<MemoryToolArgs>('memory', {
        description: getMemorySchema(options.writeFrequency),
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
                    enum: ['repo', 'system'],
                    description: "Which memory store: 'repo' for repo-scoped memory, 'system' for global memory. Use 'repo' for most cases.",
                },
                content: {
                    type: 'string',
                    description: "The entry content. Required for 'add' and 'replace'.",
                },
                old_text: {
                    type: 'string',
                    description: 'Short unique substring identifying the entry to replace or remove.',
                },
                explicitMemoryIntent: {
                    type: 'boolean',
                    description: "Set true only when the user explicitly asked to remember/save this fact or gave a durable correction.",
                },
            },
            required: ['action', 'target'],
        },
        handler: async (args) => {
            if (!allowedTargets.includes(args.target)) {
                return { success: false, error: `Target '${args.target}' is not available.` };
            }
            return handleCaptureMode(args, captureConfig, options, writtenFacts);
        },
    });

    return { tool, getWrittenFacts: () => [...writtenFacts] };
}

// ---------------------------------------------------------------------------
// Capture-mode handler (private)
// ---------------------------------------------------------------------------

async function handleCaptureMode(
    args: MemoryToolArgs,
    captureConfig: {
        context: MemoryToolCaptureContext;
        onCandidateCaptured?: MemoryCandidateCapturedCallback;
    } | undefined,
    options: MemoryToolOptions,
    writtenFacts: string[],
): Promise<MemoryToolCaptureResult | { success: false; error: string }> {
    if (args.action === 'replace' || args.action === 'remove') {
        return {
            success: false,
            error: `'${args.action}' is not supported in capture mode. Memory updates require explicit candidate promotion.`,
        };
    }

    if (args.action !== 'add') {
        return { success: false, error: `Unknown action '${args.action}'.` };
    }

    if (!args.content) {
        return { success: false, error: "Content is required for 'add' action." };
    }

    const trimmed = args.content.trim();
    if (!trimmed) {
        return { success: false, error: 'Content cannot be empty.' };
    }

    const scan = scanMemoryContent(trimmed);
    if (scan.blocked) {
        return { success: false, error: `Content blocked by security scanner: ${scan.reason}` };
    }

    const explicitIntent = args.explicitMemoryIntent === true;
    const captureScore = getCaptureScore(explicitIntent, options.writeFrequency);
    const id = crypto.randomUUID();

    const candidate: CapturedCandidate = {
        id,
        target: args.target,
        content: trimmed,
        source: options.source,
        workspaceId: captureConfig?.context.workspaceId ?? '',
        processId: captureConfig?.context.processId ?? null,
        turnIndex: captureConfig?.context.turnIndex ?? null,
        explicitMemoryIntent: explicitIntent,
        score: captureScore,
    };

    writtenFacts.push(trimmed);

    await captureConfig?.onCandidateCaptured?.({
        target: args.target,
        candidate,
        context: captureConfig.context,
    });

    return {
        success: true,
        message: 'Memory candidate captured; memory will update after promotion.',
        candidateId: id,
        recordId: id,
    };
}

function getCaptureScore(explicitIntent: boolean, frequency: MemoryWriteFrequency | undefined): number {
    if (explicitIntent) return 1.0;
    switch (frequency) {
        case 'high': return 0.8;
        case 'low': return 0.5;
        default: return 0.7;
    }
}
