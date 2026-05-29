/**
 * Search Conversations Tool
 *
 * Factory that creates a `search_conversations` custom tool for the Copilot SDK.
 * The model calls this tool to search past AI conversation history using FTS5
 * full-text search. Requires a SQLite-backed ProcessStore.
 *
 * Two modes:
 *   1. Keyword search — FTS5 full-text search with optional AI summarization
 *   2. Recent browse — no query, returns metadata for recent sessions (zero LLM cost)
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance
 * bound to the store instance, avoiding cross-request contamination.
 */

import type { ConversationTurn, ProcessIndexEntry, ProcessStore } from '@plusplusoneplusplus/forge';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';

export interface SearchConversationsArgs {
    query?: string;
    workspaceId?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
    summarize?: boolean;
}

/**
 * Metadata about a matched session, passed to the summarizer callback.
 */
export interface SessionMeta {
    processId: string;
    title?: string;
    startTime: string;
    status: string;
}

/**
 * Summarizer callback type.
 * Takes a truncated transcript and query, returns a focused summary or null on failure.
 */
export type Summarizer = (
    transcript: string,
    query: string,
    meta: SessionMeta,
) => Promise<string | null>;

/**
 * Options for `createSearchConversationsTool`.
 */
export interface SearchConversationsToolOptions {
    /** ProcessStore instance (must support `searchConversations` for keyword search). */
    store: ProcessStore;
    /** Optional default workspace ID to scope searches. */
    workspaceId?: string;
    /** Optional process ID to exclude from results (the current session). */
    currentProcessId?: string;
    /** Optional summarizer callback for AI-generated session summaries. */
    summarizer?: Summarizer;
}

const MAX_RESULTS = 100;
const DEFAULT_LIMIT = 10;
const MAX_SUMMARIZE_SESSIONS = 5;
const RAW_PREVIEW_LENGTH = 500;
const MAX_TRANSCRIPT_LENGTH = 100_000;

/**
 * Strip HTML `<mark>` tags from FTS5 snippet output.
 * Snippets use `<mark>...</mark>` for highlighting in the web UI,
 * but the LLM doesn't need HTML markup.
 */
export function stripMarkTags(text: string): string {
    return text.replace(/<\/?mark>/g, '');
}

// ============================================================================
// Transcript Truncation
// ============================================================================

/**
 * Find positions of query term matches within a transcript.
 * Uses a three-tier approach: full phrase → proximity co-occurrence → individual terms.
 */
function findMatchPositions(transcript: string, query: string): number[] {
    const lower = transcript.toLowerCase();
    const queryLower = query.toLowerCase().trim();
    const positions: number[] = [];

    // Tier 1: full phrase match
    let idx = lower.indexOf(queryLower);
    while (idx !== -1) {
        positions.push(idx);
        idx = lower.indexOf(queryLower, idx + 1);
    }
    if (positions.length > 0) return positions;

    // Tier 2: individual terms
    const terms = queryLower.split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return [];

    for (const term of terms) {
        idx = lower.indexOf(term);
        while (idx !== -1) {
            positions.push(idx);
            idx = lower.indexOf(term, idx + 1);
        }
    }

    return positions.sort((a, b) => a - b);
}

/**
 * Truncate a transcript around the best match cluster.
 * Keeps up to `maxLength` chars, biased 25% before / 75% after the first match cluster.
 *
 * @param transcript Full conversation transcript.
 * @param query      The search query.
 * @param maxLength  Maximum output length (default 100k).
 * @returns Truncated transcript with ellipsis markers if truncated.
 */
export function truncateAroundMatches(
    transcript: string,
    query: string,
    maxLength: number = MAX_TRANSCRIPT_LENGTH,
): string {
    if (transcript.length <= maxLength) return transcript;

    const positions = findMatchPositions(transcript, query);

    // No matches found — take from the start
    if (positions.length === 0) {
        return transcript.slice(0, maxLength) + '\n…[truncated]';
    }

    // Center window around first match cluster, biased 25% before / 75% after
    const firstMatch = positions[0];
    const beforeAlloc = Math.floor(maxLength * 0.25);
    const windowStart = Math.max(0, firstMatch - beforeAlloc);
    const windowEnd = Math.min(transcript.length, windowStart + maxLength);

    let result = transcript.slice(windowStart, windowEnd);
    if (windowStart > 0) result = '…[truncated]\n' + result;
    if (windowEnd < transcript.length) result = result + '\n…[truncated]';

    return result;
}

// ============================================================================
// Transcript Formatting
// ============================================================================

/**
 * Format conversation turns into a plain-text transcript.
 */
function formatTranscript(turns: ConversationTurn[]): string {
    return turns
        .map(t => `[${t.role === 'user' ? 'User' : 'Assistant'}]: ${t.content}`)
        .join('\n\n');
}

/**
 * Generate a raw preview from conversation turns (first N chars, no LLM).
 */
function rawPreview(turns: ConversationTurn[], maxLength: number = RAW_PREVIEW_LENGTH): string {
    const transcript = formatTranscript(turns);
    if (transcript.length <= maxLength) return transcript;
    return transcript.slice(0, maxLength) + '…';
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a `search_conversations` custom tool definition for the Copilot SDK.
 *
 * @param storeOrOptions Either a ProcessStore directly (legacy 2-arg form) or an options object.
 * @param legacyWorkspaceId Optional workspace ID (only for legacy 2-arg call).
 */
export function createSearchConversationsTool(
    storeOrOptions: ProcessStore | SearchConversationsToolOptions,
    legacyWorkspaceId?: string,
) {
    // Support both legacy (store, workspaceId?) and new (options) signatures.
    // Options objects always have a `store` property; raw ProcessStore instances don't.
    const hasStoreProperty = storeOrOptions !== null
        && typeof storeOrOptions === 'object'
        && 'store' in storeOrOptions;
    const opts: SearchConversationsToolOptions = hasStoreProperty
        ? storeOrOptions as unknown as SearchConversationsToolOptions
        : { store: storeOrOptions as ProcessStore, workspaceId: legacyWorkspaceId };

    const { store, workspaceId, currentProcessId, summarizer } = opts;

    const tool = defineTool<SearchConversationsArgs>('search_conversations', {
        description:
            'Search your conversation history in this workspace, or browse recent sessions. This is not a Teams or Slack chat history search tool. ' +
            'TWO MODES: (1) Recent sessions — call with no query to list metadata-only sessions, optionally scoped by workspaceId and since/until activity window. ' +
            '(2) Keyword search — search for specific topics across all past sessions, optionally with AI-generated summaries. ' +
            'For periodic tasks, use no query plus workspaceId + since/until to discover candidate processIds, then call get_conversation only for selected sessions. ' +
            'USE PROACTIVELY when the user says "we did this before", "remember when", "last time", "as I mentioned", ' +
            'or references a topic from a previous session. Better to search and confirm than to guess.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'The search query (supports FTS5 syntax: quoted phrases, AND/OR/NOT operators). ' +
                        'Omit or leave empty to browse recent sessions.',
                },
                workspaceId: {
                    type: 'string',
                    description: 'Optional workspace ID to scope the search to a specific repository',
                },
                since: {
                    type: 'string',
                    description:
                        'Optional ISO datetime lower bound on conversation activity time ' +
                        '(inclusive). Uses COALESCE(lastEventAt, startTime).',
                },
                until: {
                    type: 'string',
                    description:
                        'Optional ISO datetime upper bound on conversation activity time ' +
                        '(exclusive). Uses COALESCE(lastEventAt, startTime).',
                },
                limit: {
                    type: 'number',
                    description: `Maximum number of results to return (default: ${DEFAULT_LIMIT}, max: ${MAX_RESULTS})`,
                },
                offset: {
                    type: 'number',
                    description: 'Optional pagination offset (default: 0)',
                },
                summarize: {
                    type: 'boolean',
                    description:
                        'When true and searching by keyword, return AI-generated summaries for each matched session ' +
                        'instead of raw snippets. More context but slightly slower. Default: false.',
                },
            },
            required: [],
        },
        handler: async (args: SearchConversationsArgs) => {
            const effectiveLimit = Math.min(
                Math.max(1, args.limit ?? DEFAULT_LIMIT),
                MAX_RESULTS,
            );
            const effectiveOffset = Math.max(0, args.offset ?? 0);
            const effectiveWorkspaceId = args.workspaceId ?? workspaceId;
            const since = parseIsoDateArg(args.since, 'since');
            const until = parseIsoDateArg(args.until, 'until');
            const query = args.query?.trim() ?? '';

            // ================================================================
            // Mode 1: Recent sessions (no query)
            // ================================================================
            if (!query) {
                return handleRecentMode(
                    store,
                    effectiveWorkspaceId,
                    since,
                    until,
                    effectiveLimit,
                    effectiveOffset,
                    currentProcessId,
                );
            }

            // ================================================================
            // Mode 2: Keyword search
            // ================================================================
            if (!store.searchConversations) {
                return {
                    mode: 'search' as const,
                    results: [],
                    total: 0,
                    query,
                    note: 'Conversation search is not available (requires SQLite backend)',
                };
            }

            const { results, total } = await store.searchConversations(query, {
                workspaceId: effectiveWorkspaceId,
                since,
                until,
                limit: effectiveLimit,
                offset: effectiveOffset,
            });

            // Filter out current session
            const filtered = currentProcessId
                ? results.filter(r => r.processId !== currentProcessId)
                : results;

            // Summarization path
            if (args.summarize) {
                return handleSummarizeMode(store, filtered, query, summarizer);
            }

            // Default: raw snippets (existing behavior)
            return {
                mode: 'search' as const,
                results: filtered.map(r => ({
                    processId: r.processId,
                    title: r.processTitle || r.promptPreview,
                    snippet: stripMarkTags(r.snippet),
                    status: r.processStatus,
                    startTime: r.startTime,
                })),
                total,
                query,
                limit: effectiveLimit,
                offset: effectiveOffset,
            };
        },
    });

    return { tool };
}

// ============================================================================
// Mode handlers
// ============================================================================

function parseIsoDateArg(value: string | undefined, name: string): Date | undefined {
    if (value === undefined || value.trim() === '') {
        return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid ${name} datetime: ${value}. Expected an ISO 8601 datetime.`);
    }
    return date;
}

function toRecentResult(e: ProcessIndexEntry) {
    const activityAt = e.activityAt ?? e.lastEventAt ?? e.startTime;
    return {
        processId: e.id,
        workspaceId: e.workspaceId,
        title: e.title || e.promptPreview,
        status: e.status,
        type: e.type,
        startTime: e.startTime,
        endTime: e.endTime,
        lastEventAt: e.lastEventAt,
        activityAt,
        preview: e.promptPreview.length > RAW_PREVIEW_LENGTH
            ? e.promptPreview.slice(0, RAW_PREVIEW_LENGTH) + '…'
            : e.promptPreview,
    };
}

async function handleRecentMode(
    store: ProcessStore,
    workspaceId: string | undefined,
    since: Date | undefined,
    until: Date | undefined,
    limit: number,
    offset: number,
    currentProcessId: string | undefined,
) {
    if (!store.listRecentProcesses) {
        // Fallback: try getProcessSummaries
        if (store.getProcessSummaries) {
            const { entries, total } = await store.getProcessSummaries({
                workspaceId,
                since,
                until,
                limit: limit + 1, // fetch one extra to account for filtering
                offset,
            });
            const filtered = currentProcessId
                ? entries.filter(e => e.id !== currentProcessId).slice(0, limit)
                : entries.slice(0, limit);
            return {
                mode: 'recent' as const,
                results: filtered.map(toRecentResult),
                count: filtered.length,
                total,
                hasMore: offset + filtered.length < total,
                limit,
                offset,
                message: `Showing ${filtered.length} recent session metadata row(s).`,
            };
        }
        return {
            mode: 'recent' as const,
            results: [],
            count: 0,
            total: 0,
            hasMore: false,
            limit,
            offset,
            message: 'Recent session listing is not available (requires SQLite backend)',
        };
    }

    const entries = await store.listRecentProcesses({
        workspaceId,
        since,
        until,
        limit: limit + 1,
        offset,
        excludeProcessId: currentProcessId,
    });
    const pageEntries = entries.slice(0, limit);
    let total = offset + pageEntries.length;
    let hasMore = entries.length > limit;

    if (store.getProcessSummaries) {
        const summary = await store.getProcessSummaries({
            workspaceId,
            since,
            until,
            limit: 1,
        });
        total = currentProcessId ? Math.max(0, summary.total - 1) : summary.total;
        hasMore = offset + pageEntries.length < total;
    }

    return {
        mode: 'recent' as const,
        results: pageEntries.map(toRecentResult),
        count: pageEntries.length,
        total,
        hasMore,
        limit,
        offset,
        message: `Showing ${pageEntries.length} recent session metadata row(s).`,
    };
}

async function handleSummarizeMode(
    store: ProcessStore,
    filteredResults: Array<{
        processId: string;
        processTitle?: string;
        promptPreview: string;
        processStatus: string;
        startTime: string;
    }>,
    query: string,
    summarizer: Summarizer | undefined,
) {
    // Group by processId, take top N unique sessions
    const seen = new Set<string>();
    const uniqueSessions: typeof filteredResults = [];
    for (const r of filteredResults) {
        if (!seen.has(r.processId)) {
            seen.add(r.processId);
            uniqueSessions.push(r);
            if (uniqueSessions.length >= MAX_SUMMARIZE_SESSIONS) break;
        }
    }

    const sessionResults: Array<{
        processId: string;
        title: string;
        status: string;
        startTime: string;
        summary: string;
    }> = [];

    for (const session of uniqueSessions) {
        const meta: SessionMeta = {
            processId: session.processId,
            title: session.processTitle || session.promptPreview,
            startTime: session.startTime,
            status: session.processStatus,
        };

        // Load conversation turns
        let turns: ConversationTurn[] | undefined;
        if (store.getConversationTurns) {
            turns = await store.getConversationTurns(session.processId);
        } else if (store.getProcess) {
            const proc = await store.getProcess(session.processId);
            turns = proc?.conversationTurns;
        }

        if (!turns || turns.length === 0) {
            sessionResults.push({
                processId: session.processId,
                title: meta.title!,
                status: session.processStatus,
                startTime: session.startTime,
                summary: session.promptPreview || '(no content)',
            });
            continue;
        }

        // Try summarizer, fall back to raw preview
        if (summarizer) {
            const transcript = formatTranscript(turns);
            const truncated = truncateAroundMatches(transcript, query);
            try {
                const summaryText = await summarizer(truncated, query, meta);
                if (summaryText) {
                    sessionResults.push({
                        processId: session.processId,
                        title: meta.title!,
                        status: session.processStatus,
                        startTime: session.startTime,
                        summary: summaryText,
                    });
                    continue;
                }
            } catch {
                // Fall through to raw preview
            }
        }

        // Fallback: raw preview
        sessionResults.push({
            processId: session.processId,
            title: meta.title!,
            status: session.processStatus,
            startTime: session.startTime,
            summary: rawPreview(turns),
        });
    }

    return {
        mode: 'summarized' as const,
        results: sessionResults,
        query,
        sessionsSearched: uniqueSessions.length,
    };
}
