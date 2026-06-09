/**
 * Get Conversation Tool
 *
 * Factory that creates a `get_conversation` custom tool for the Copilot SDK.
 * The model calls this tool to fetch the full transcript of a past session
 * (typically discovered via `search_conversations`), compacted to fit within
 * a token budget so it doesn't blow context.
 *
 * Compaction is applied progressively in 5 levels until the result fits the
 * caller-supplied `maxChars` budget:
 *   0. Strip noise (timeline, images, tokenUsage, deleted/archived turns)
 *   1. Compact tool calls (1-line arg summary, truncated results)
 *   2. Drop unimportant tool calls (Read/Glob/Grep/etc.) entirely
 *   3. Truncate long assistant prose (head + tail)
 *   4. Drop middle turns (keep first 2 + last N that fit)
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance
 * bound to the store instance, avoiding cross-request contamination.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore, ConversationTurn, ToolCall } from '@plusplusoneplusplus/forge';

export interface GetConversationArgs {
    processId: string;
    maxChars?: number;
    includeToolCalls?: boolean;
    fromTurn?: number;
    toTurn?: number;
}

export interface GetConversationToolOptions {
    /** ProcessStore instance. Must support `getConversationTurns` or `getProcess`. */
    store: ProcessStore;
    /** Optional default workspace ID used when calling `getProcess`. */
    workspaceId?: string;
}

const DEFAULT_MAX_CHARS = 15_000;
const HARD_MAX_CHARS = 60_000;
const PROSE_HEAD_CHARS = 300;
const PROSE_TAIL_CHARS = 100;
const TOOL_RESULT_HEAD_CHARS = 200;
const TOOL_ARG_SUMMARY_MAX = 80;
const KEEP_FIRST_TURNS = 2;

/**
 * Compaction level — higher means more was dropped.
 * 0 = noise stripped only, 4 = middle turns dropped.
 */
export type CompactionLevel = 0 | 1 | 2 | 3 | 4;

export interface GetConversationResult {
    processId: string;
    title?: string;
    status?: string;
    startTime?: string;
    totalTurns: number;
    returnedTurns: number;
    truncated: boolean;
    compactionLevel: CompactionLevel;
    transcript: string;
    note?: string;
}

// ============================================================================
// Tool-call importance classification
// ============================================================================

/**
 * Tool names whose calls are worth keeping in the compacted transcript.
 * These represent state changes or decisions; everything else is treated
 * as read-only noise that the model can re-derive if needed.
 */
const IMPORTANT_TOOL_NAMES = new Set([
    'edit',
    'write',
    'notebookedit',
    'bash',
    'taskcreate',
    'taskupdate',
    'ask_user',
    'add_diff_comment',
    'resolve_comment',
    'create_update_work_item',
]);

function isImportantToolCall(call: ToolCall): boolean {
    if (call.status === 'failed') return true;
    return IMPORTANT_TOOL_NAMES.has(call.name.toLowerCase());
}

// ============================================================================
// Per-call argument summarization
// ============================================================================

/**
 * Render a one-line summary of a tool's arguments suitable for inclusion in a
 * compacted transcript. Picks the most informative field per tool name.
 */
function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
    const lower = name.toLowerCase();
    const pickStr = (key: string): string | undefined => {
        const v = args?.[key];
        return typeof v === 'string' ? v : undefined;
    };

    const truncate = (s: string): string =>
        s.length > TOOL_ARG_SUMMARY_MAX ? s.slice(0, TOOL_ARG_SUMMARY_MAX) + '…' : s;

    // File-oriented tools
    if (['read', 'write', 'edit', 'notebookedit'].includes(lower)) {
        const p = pickStr('file_path') ?? pickStr('path') ?? pickStr('notebook_path');
        if (p) return `file=${truncate(p)}`;
    }
    // Search tools
    if (lower === 'glob') {
        const p = pickStr('pattern');
        if (p) return `pattern=${truncate(p)}`;
    }
    if (lower === 'grep') {
        const p = pickStr('pattern');
        if (p) return `pattern=${truncate(p)}`;
    }
    // Shell
    if (lower === 'bash') {
        const c = pickStr('command');
        if (c) return `cmd=${truncate(c.replace(/\s+/g, ' '))}`;
    }
    // Web
    if (lower === 'webfetch' || lower === 'websearch') {
        const u = pickStr('url') ?? pickStr('query');
        if (u) return truncate(u);
    }

    // Generic fallback: first string-valued arg
    if (args && typeof args === 'object') {
        for (const [k, v] of Object.entries(args)) {
            if (typeof v === 'string' && v.length > 0) {
                return `${k}=${truncate(v)}`;
            }
        }
    }
    return '';
}

function truncateResult(result: string | undefined): string {
    if (!result) return '';
    if (result.length <= TOOL_RESULT_HEAD_CHARS) return result;
    const omitted = result.length - TOOL_RESULT_HEAD_CHARS;
    return result.slice(0, TOOL_RESULT_HEAD_CHARS) + `…[${omitted} chars omitted]`;
}

// ============================================================================
// Turn rendering at each compaction level
// ============================================================================

interface RenderOptions {
    includeToolCalls: boolean;
    /** When true, truncate long tool-call results (and errors) to a head slice. */
    compactToolResults: boolean;
    /** When true, drop tool calls that are not in IMPORTANT_TOOL_NAMES. */
    dropUnimportantToolCalls: boolean;
    /** When true, truncate prose with head + tail clipping. */
    truncateProse: boolean;
}

/**
 * Render a single turn into a plain-text block. Honors the compaction options.
 */
function renderTurn(turn: ConversationTurn, opts: RenderOptions): string {
    const role = turn.role === 'user' ? 'User' : 'Assistant';
    let content = turn.content ?? '';

    if (opts.truncateProse && content.length > PROSE_HEAD_CHARS + PROSE_TAIL_CHARS + 20) {
        const omitted = content.length - PROSE_HEAD_CHARS - PROSE_TAIL_CHARS;
        content =
            content.slice(0, PROSE_HEAD_CHARS) +
            `\n…[${omitted} chars omitted]\n` +
            content.slice(-PROSE_TAIL_CHARS);
    }

    const lines: string[] = [`[${role}]: ${content}`];

    if (opts.includeToolCalls && turn.toolCalls && turn.toolCalls.length > 0) {
        const kept: string[] = [];
        let droppedCount = 0;
        for (const call of turn.toolCalls) {
            if (opts.dropUnimportantToolCalls && !isImportantToolCall(call)) {
                droppedCount++;
                continue;
            }
            const argSummary = summarizeToolArgs(call.name, call.args);
            const header = argSummary
                ? `  - ${call.name}(${argSummary}) [${call.status}]`
                : `  - ${call.name}() [${call.status}]`;
            kept.push(header);
            const maybeTruncate = (s: string): string =>
                opts.compactToolResults ? truncateResult(s) : s;
            if (call.error) {
                kept.push(`    error: ${maybeTruncate(call.error)}`);
            } else if (call.result) {
                kept.push(`    result: ${maybeTruncate(call.result)}`);
            }
        }
        if (kept.length > 0) {
            lines.push('  tool_calls:');
            lines.push(...kept);
        }
        if (droppedCount > 0) {
            lines.push(`  [+ ${droppedCount} read/search call(s) omitted]`);
        }
    }

    return lines.join('\n');
}

/**
 * Strip noise that is never useful to the LLM, regardless of budget.
 * Always applied (level 0).
 */
function stripNoise(turns: ConversationTurn[]): ConversationTurn[] {
    return turns.filter(t => !t.deletedAt);
}

/**
 * Render the full transcript at the given compaction level for the supplied turns.
 */
function renderAtLevel(
    turns: ConversationTurn[],
    level: CompactionLevel,
    includeToolCalls: boolean,
): string {
    const opts: RenderOptions = {
        includeToolCalls,
        compactToolResults: level >= 1,
        dropUnimportantToolCalls: level >= 2,
        truncateProse: level >= 3,
    };
    const blocks = turns.map(t => renderTurn(t, opts));
    return blocks.join('\n\n');
}

/**
 * Apply level 4: keep the first KEEP_FIRST_TURNS turns and append as many
 * trailing turns as possible without exceeding maxChars. Returns the rendered
 * transcript and the count of turns actually included.
 */
function renderWithMiddleDrop(
    turns: ConversationTurn[],
    maxChars: number,
    includeToolCalls: boolean,
): { transcript: string; returnedTurns: number } {
    const opts: RenderOptions = {
        includeToolCalls,
        compactToolResults: true,
        dropUnimportantToolCalls: true,
        truncateProse: true,
    };
    const rendered = turns.map(t => renderTurn(t, opts));
    const SEP = '\n\n';

    if (turns.length <= KEEP_FIRST_TURNS) {
        return { transcript: rendered.join(SEP), returnedTurns: turns.length };
    }

    const head = rendered.slice(0, KEEP_FIRST_TURNS);
    const headLen = head.join(SEP).length;

    // Walk tail backwards, accumulating turns until we'd exceed budget.
    const tail: string[] = [];
    let tailLen = 0;
    for (let i = rendered.length - 1; i >= KEEP_FIRST_TURNS; i--) {
        const block = rendered[i];
        const addLen = (tail.length === 0 ? 0 : SEP.length) + block.length;
        // Budget for marker: account for "…[N turns omitted]…" worst-case.
        const markerBudget = 40;
        if (headLen + SEP.length + markerBudget + SEP.length + tailLen + addLen > maxChars) {
            break;
        }
        tail.unshift(block);
        tailLen += addLen;
    }

    const omittedCount = turns.length - head.length - tail.length;
    const marker = omittedCount > 0 ? `…[${omittedCount} turn(s) omitted]…` : '';
    const parts = [...head];
    if (marker) parts.push(marker);
    parts.push(...tail);

    return {
        transcript: parts.join(SEP),
        returnedTurns: head.length + tail.length,
    };
}

// ============================================================================
// Compaction driver
// ============================================================================

/**
 * Apply progressive compaction until the rendered transcript fits within `maxChars`.
 * Returns the final transcript along with the level reached and the count of
 * turns actually included.
 *
 * Exported for unit testing.
 */
export function compactTranscript(
    turnsIn: ConversationTurn[],
    maxChars: number,
    includeToolCalls: boolean,
): {
    transcript: string;
    compactionLevel: CompactionLevel;
    truncated: boolean;
    returnedTurns: number;
    totalTurns: number;
} {
    const stripped = stripNoise(turnsIn);
    const totalTurns = stripped.length;

    for (const level of [0, 1, 2, 3] as const) {
        const transcript = renderAtLevel(stripped, level, includeToolCalls);
        if (transcript.length <= maxChars) {
            return {
                transcript,
                compactionLevel: level,
                truncated: level > 0,
                returnedTurns: stripped.length,
                totalTurns,
            };
        }
    }

    // Level 4: drop middle turns
    const dropped = renderWithMiddleDrop(stripped, maxChars, includeToolCalls);
    return {
        transcript: dropped.transcript,
        compactionLevel: 4,
        truncated: true,
        returnedTurns: dropped.returnedTurns,
        totalTurns,
    };
}

// ============================================================================
// Tool factory
// ============================================================================

/**
 * Create a `get_conversation` custom tool definition for the Copilot SDK.
 *
 * @param options Tool options (store + optional workspaceId).
 */
export function createGetConversationTool(options: GetConversationToolOptions) {
    const { store, workspaceId: defaultWorkspaceId } = options;

    const tool = defineTool<GetConversationArgs>('get_conversation', {
        description:
            'Fetch the full transcript of a past conversation by processId, compacted to fit a token budget. ' +
            'Use this AFTER `search_conversations` returns a relevant session and you need to see what was actually discussed or done. ' +
            'TIP: call with `includeToolCalls: false` first for a prose-only view (much cheaper); re-call with tool calls only if you need to see what was executed. ' +
            'Use `fromTurn`/`toTurn` to page into a long conversation.',
        parameters: {
            type: 'object',
            properties: {
                processId: {
                    type: 'string',
                    description: 'The process ID of the conversation to fetch (from `search_conversations` results).',
                },
                maxChars: {
                    type: 'number',
                    description: `Maximum characters in the rendered transcript (default: ${DEFAULT_MAX_CHARS}, max: ${HARD_MAX_CHARS}). Larger budgets = more context but more tokens.`,
                },
                includeToolCalls: {
                    type: 'boolean',
                    description: 'When true (default), include compacted tool-call summaries. Set to false for a prose-only view.',
                },
                fromTurn: {
                    type: 'number',
                    description: 'Optional: start at this zero-based turn index (inclusive). Useful for paging.',
                },
                toTurn: {
                    type: 'number',
                    description: 'Optional: end at this zero-based turn index (inclusive). Useful for paging.',
                },
            },
            required: ['processId'],
        },
        handler: async (args: GetConversationArgs): Promise<GetConversationResult> => {
            const processId = args.processId;
            const maxChars = Math.min(
                Math.max(1_000, args.maxChars ?? DEFAULT_MAX_CHARS),
                HARD_MAX_CHARS,
            );
            const includeToolCalls = args.includeToolCalls ?? true;

            // Load process metadata + turns.
            // Prefer getConversationTurns (lighter) but fall back to getProcess.
            let turns: ConversationTurn[] | undefined;
            let title: string | undefined;
            let status: string | undefined;
            let startTime: string | undefined;

            const proc = store.getProcess
                ? await store.getProcess(processId, defaultWorkspaceId)
                : undefined;

            if (proc) {
                title = proc.title ?? proc.promptPreview;
                status = proc.status;
                startTime =
                    proc.startTime instanceof Date
                        ? proc.startTime.toISOString()
                        : (proc.startTime as unknown as string);
            }

            if (store.getConversationTurns) {
                turns = await store.getConversationTurns(processId);
            } else if (proc) {
                turns = proc.conversationTurns;
            }

            if (!turns) {
                return {
                    processId,
                    totalTurns: 0,
                    returnedTurns: 0,
                    truncated: false,
                    compactionLevel: 0,
                    transcript: '',
                    note: 'Conversation not found or store does not support transcript retrieval.',
                };
            }

            // Apply paging window (fromTurn/toTurn are inclusive turn indices).
            let windowed = turns;
            if (typeof args.fromTurn === 'number' || typeof args.toTurn === 'number') {
                const from = args.fromTurn ?? 0;
                const to = args.toTurn ?? Number.MAX_SAFE_INTEGER;
                windowed = turns.filter(t => t.turnIndex >= from && t.turnIndex <= to);
            }

            const result = compactTranscript(windowed, maxChars, includeToolCalls);

            return {
                processId,
                title,
                status,
                startTime,
                totalTurns: turns.length,
                returnedTurns: result.returnedTurns,
                truncated: result.truncated || windowed.length !== turns.length,
                compactionLevel: result.compactionLevel,
                transcript: result.transcript,
            };
        },
    });

    return { tool };
}
