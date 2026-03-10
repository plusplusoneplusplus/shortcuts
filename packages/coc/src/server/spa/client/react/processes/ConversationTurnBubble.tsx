/**
 * ConversationTurnBubble — role-aware chat bubble for conversation turns.
 */
import React, { useState, useMemo } from 'react';
import { cn, ImageGallery, Spinner } from '../shared';
import type { ClientConversationTurn, ClientTokenUsage } from '../types/dashboard';
import { MarkdownView } from './MarkdownView';
import { ToolCallView } from './ToolCallView';
import { mergeConsecutiveContentItems } from './timeline-utils';
import { Marked } from 'marked';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { fetchApi } from '../hooks/useApi';
import { copyToClipboard, splitMarkdownSections } from '../utils/format';
import { linkifyFilePaths } from '../shared/file-path-utils';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
import type { ToolGroupCategory, GroupContentItem, GroupOrderedItem } from './toolGroupUtils';
import { groupConsecutiveToolChunks } from './toolGroupUtils';
import { ToolCallGroupView } from './ToolCallGroupView';

const chatMarked = new Marked({
    gfm: true,
    breaks: true,
});

/**
 * Pre-normalize Windows-style paths (backslash) to forward slashes before markdown
 * parsing, so that `marked` does not treat `\.` as an escape sequence (GFM treats
 * backslash-followed-by-ASCII-punctuation as an escape, silently dropping the `\`).
 */
function normalizeWindowsPathsInText(text: string): string {
    return text.replace(/[A-Za-z]:[\\\/][\w.\\/@-]+/g, (match) => toForwardSlashes(match));
}

/**
 * Convert markdown to semantic HTML using `marked` for chat messages.
 * Produces proper `<h3>`, `<strong>`, `<ul>`, `<pre><code>`, etc.
 * File paths are linkified for hover previews.
 */
export function chatMarkdownToHtml(content: string): string {
    if (!content || !content.trim()) return '';
    const normalized = normalizeWindowsPathsInText(content);
    return linkifyFilePaths(chatMarked.parse(normalized) as string);
}

interface ConversationTurnBubbleProps {
    turn: ClientConversationTurn;
    /** Queue task ID — when provided, enables lazy image fetching for turns with imagesCount */
    taskId?: string;
    /** Called when the user clicks the Retry button on an error assistant bubble. */
    onRetry?: () => void;
    /** Process type (e.g. 'run-script') — used to label non-AI responses differently. */
    processType?: string;
}

interface RenderToolCall {
    id: string;
    toolName: string;
    name?: string;
    args: any;
    result?: string;
    error?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
}

type RenderChunk =
    | { kind: 'content';    key: string; html?: string; toolId?: string; parentToolId?: string }
    | { kind: 'tool';       key: string; html?: string; toolId?: string; parentToolId?: string }
    | {
        kind:         'tool-group';
        key:          string;
        category:     ToolGroupCategory;
        /** Ordered list of RenderToolCall IDs that are collapsed into this group. */
        toolIds:      string[];
        /** Absorbed single-line content messages (rendered inline when expanded). */
        contentItems: GroupContentItem[];
        /** Interleaved order of tools and content for faithful rendering. */
        orderedItems: GroupOrderedItem[];
        /** Epoch ms of the earliest startTime among grouped tools (undefined if none have timing). */
        startTime?:   number;
        /** Epoch ms of the latest endTime among grouped tools (undefined if any are still running). */
        endTime?:     number;
        /** true only when every tool in the group has status === 'completed'. */
        allSucceeded: boolean;
        parentToolId?: string;
      };

export function toContentHtml(content: string): string {
    // Escape raw HTML so user-pasted HTML sections render as plain text, not rendered HTML.
    const htmlEscaped = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return chatMarkdownToHtml(htmlEscaped);
}

function normalizeToolCall(raw: any, fallbackId: string): RenderToolCall {
    const rawId = raw?.id || raw?.toolCallId || raw?.tool_call_id;
    const toolName = raw?.toolName || raw?.name || 'unknown';

    return {
        id: typeof rawId === 'string' && rawId ? rawId : fallbackId,
        toolName: typeof toolName === 'string' && toolName ? toolName : 'unknown',
        name: typeof raw?.name === 'string' ? raw.name : undefined,
        args: raw?.args ?? raw?.parameters ?? {},
        result: raw?.result,
        error: raw?.error,
        status: raw?.status || 'pending',
        startTime: raw?.startTime,
        endTime: raw?.endTime,
        parentToolCallId: raw?.parentToolCallId || raw?.parent_tool_call_id,
    };
}

function mergeToolCall(target: RenderToolCall, incoming: RenderToolCall): void {
    if ((!target.toolName || target.toolName === 'unknown') && incoming.toolName) {
        target.toolName = incoming.toolName;
    }
    if ((!target.name || target.name === 'unknown') && incoming.name) {
        target.name = incoming.name;
    }
    if (incoming.args != null) {
        const shouldReplaceArgs =
            typeof incoming.args !== 'object' ||
            incoming.args === null ||
            Object.keys(incoming.args).length > 0;
        if (shouldReplaceArgs) {
            target.args = incoming.args;
        }
    }
    if (incoming.status) target.status = incoming.status;
    if (incoming.result !== undefined) target.result = incoming.result;
    if (incoming.error !== undefined) target.error = incoming.error;
    if (incoming.startTime && !target.startTime) target.startTime = incoming.startTime;
    if (incoming.endTime) target.endTime = incoming.endTime;
    if (incoming.parentToolCallId && !target.parentToolCallId) {
        target.parentToolCallId = incoming.parentToolCallId;
    }
}

/**
 * Merge consecutive content chunks into a single chunk to avoid rendering
 * multiple bordered boxes for text that is logically one message.
 * Non-content chunks (e.g. hidden tool calls like report_intent) act as
 * potential separators in the array but should not break the visual flow.
 */
export function mergeConsecutiveContentChunks(chunks: RenderChunk[]): RenderChunk[] {
    if (chunks.length === 0) return chunks;

    const result: RenderChunk[] = [];
    let pendingHtml = '';
    let pendingKey = '';
    let pendingParentToolId: string | undefined;

    const flush = () => {
        if (pendingKey) {
            result.push({ kind: 'content', key: pendingKey, html: pendingHtml, parentToolId: pendingParentToolId });
            pendingHtml = '';
            pendingKey = '';
            pendingParentToolId = undefined;
        }
    };

    for (const chunk of chunks) {
        if (chunk.kind === 'content' && chunk.html) {
            if (!pendingKey) {
                pendingKey = chunk.key;
                pendingParentToolId = chunk.parentToolId;
            }
            pendingHtml += chunk.html;
        } else {
            flush();
            result.push(chunk);
        }
    }

    flush();
    return result;
}

function removeFromTaskStack(activeTaskStack: string[], toolCallId: string): void {
    const idx = activeTaskStack.lastIndexOf(toolCallId);
    if (idx >= 0) {
        activeTaskStack.splice(idx, 1);
    }
}

function toMillis(iso?: string): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Infer parent relationships when events do not include explicit parent IDs.
 * This mirrors the legacy renderer behavior to keep subagent tool nesting.
 */
function inferParentToolCalls(
    calls: RenderToolCall[],
    options?: { enableTrailingTaskFallback?: boolean }
): RenderToolCall[] {
    const enableTrailingTaskFallback = options?.enableTrailingTaskFallback ?? true;
    const cloned = calls.map((call) => ({ ...call }));
    const ordered = cloned.map((call, originalIndex) => ({
        call,
        originalIndex,
        startMs: toMillis(call.startTime),
        endMs: toMillis(call.endTime),
    }));

    ordered.sort((a, b) => {
        const aKey = a.startMs ?? Number.MAX_SAFE_INTEGER;
        const bKey = b.startMs ?? Number.MAX_SAFE_INTEGER;
        if (aKey !== bKey) return aKey - bKey;
        return a.originalIndex - b.originalIndex;
    });

    const activeTaskStack: Array<{ id: string; endMs: number | null }> = [];

    for (const item of ordered) {
        const currentStart = item.startMs;
        if (currentStart != null) {
            while (activeTaskStack.length > 0) {
                const top = activeTaskStack[activeTaskStack.length - 1];
                if (top.endMs != null && top.endMs <= currentStart) {
                    activeTaskStack.pop();
                } else {
                    break;
                }
            }
        }

        const call = item.call;
        const explicitParent = call.parentToolCallId;
        const activeParent = activeTaskStack.length > 0
            ? activeTaskStack[activeTaskStack.length - 1].id
            : undefined;

        if (!explicitParent && call.toolName !== 'task' && activeParent && currentStart != null) {
            call.parentToolCallId = activeParent;
        }

        if (call.toolName === 'task') {
            if (!call.parentToolCallId && activeParent && call.id !== activeParent && currentStart != null) {
                call.parentToolCallId = activeParent;
            }
            activeTaskStack.push({ id: call.id, endMs: item.endMs });
        }
    }

    if (enableTrailingTaskFallback) {
        // Fallback for records that lack reliable timing: bind trailing calls to the latest task.
        let lastTaskId: string | undefined;
        for (const call of cloned) {
            if (call.toolName === 'task') {
                lastTaskId = call.id;
                continue;
            }
            if (!call.parentToolCallId && lastTaskId) {
                call.parentToolCallId = lastTaskId;
            }
        }
    }

    return cloned;
}

function buildToolDepthMap(calls: RenderToolCall[]): Map<string, number> {
    const byId = new Map<string, RenderToolCall>();
    for (const call of calls) {
        byId.set(call.id, call);
    }

    const memo = new Map<string, number>();
    const visiting = new Set<string>();

    const getDepth = (id: string): number => {
        if (memo.has(id)) return memo.get(id)!;
        if (visiting.has(id)) return 0;

        visiting.add(id);
        const call = byId.get(id);
        if (!call) {
            visiting.delete(id);
            memo.set(id, 0);
            return 0;
        }

        const parentId = call.parentToolCallId;
        let depth = 0;
        if (parentId && parentId !== id && byId.has(parentId)) {
            depth = Math.min(getDepth(parentId) + 1, 8);
        }
        visiting.delete(id);
        memo.set(id, depth);
        return depth;
    };

    const depthMap = new Map<string, number>();
    for (const call of calls) {
        depthMap.set(call.id, getDepth(call.id));
    }

    return depthMap;
}

function buildAssistantRender(turn: ClientConversationTurn): {
    chunks: RenderChunk[];
    chunksByParent: Map<string, RenderChunk[]>;
    toolById: Map<string, RenderToolCall>;
    toolDepthById: Map<string, number>;
    toolParentById: Map<string, string>;
    toolsWithChildren: Set<string>;
} {
    const chunks: RenderChunk[] = [];
    const timeline = mergeConsecutiveContentItems(Array.isArray(turn.timeline) ? turn.timeline : []);
    let hasContent = false;

    const callsById = new Map<string, RenderToolCall>();
    const callOrder: string[] = [];
    const activeTaskStack: string[] = [];
    let hasTimelineToolEvents = false;
    // Track content texts rendered inline so we can suppress duplicate tool results.
    // This handles the case where a sub-agent (e.g. explore task) streams its output as a
    // content event and the SDK also surfaces the same text as the tool-complete result.
    const renderedContentTexts = new Set<string>();

    for (let i = 0; i < timeline.length; i++) {
        const item: any = timeline[i];
        if (!item) continue;

        if (item.type === 'content') {
            const html = toContentHtml(item.content || '');
            if (html) {
                const parentToolId = activeTaskStack.length > 0
                    ? activeTaskStack[activeTaskStack.length - 1]
                    : undefined;
                chunks.push({ kind: 'content', key: `content-${i}`, html, parentToolId });
                hasContent = true;
                if (item.content) renderedContentTexts.add((item.content as string).trim());
            }
            continue;
        }

        if (typeof item.type === 'string' && item.type.startsWith('tool-') && item.toolCall) {
            hasTimelineToolEvents = true;
            const incoming = normalizeToolCall(item.toolCall, `tool-${i}`);
            const activeParent = activeTaskStack.length > 0
                ? activeTaskStack[activeTaskStack.length - 1]
                : undefined;

            // Timeline order is the most reliable signal for task enter/exit boundaries.
            if (!incoming.parentToolCallId && activeParent) {
                if (incoming.toolName === 'task') {
                    if (item.type === 'tool-start' && incoming.id !== activeParent) {
                        incoming.parentToolCallId = activeParent;
                    }
                } else {
                    incoming.parentToolCallId = activeParent;
                }
            }

            const existing = callsById.get(incoming.id);
            if (existing) {
                mergeToolCall(existing, incoming);
            } else {
                callsById.set(incoming.id, incoming);
                callOrder.push(incoming.id);
                chunks.push({ kind: 'tool', key: `tool-${incoming.id}`, toolId: incoming.id });
            }

            if (item.type === 'tool-start' && incoming.toolName === 'task') {
                removeFromTaskStack(activeTaskStack, incoming.id);
                activeTaskStack.push(incoming.id);
            } else if ((item.type === 'tool-complete' || item.type === 'tool-failed') && incoming.toolName === 'task') {
                removeFromTaskStack(activeTaskStack, incoming.id);
            }
        }
    }

    // Suppress tool results that are already shown as inline content to avoid duplication.
    for (const call of callsById.values()) {
        if (call.result && typeof call.result === 'string' && renderedContentTexts.has(call.result.trim())) {
            call.result = undefined;
        }
    }

    if (callOrder.length === 0 && Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
        for (let i = 0; i < turn.toolCalls.length; i++) {
            const normalized = normalizeToolCall(turn.toolCalls[i], `toolcalls-${i}`);
            callsById.set(normalized.id, normalized);
            callOrder.push(normalized.id);
        }
    }

    const orderedCalls = callOrder
        .map((id) => callsById.get(id))
        .filter((call): call is RenderToolCall => Boolean(call));
    const inferred = inferParentToolCalls(orderedCalls, {
        enableTrailingTaskFallback: !hasTimelineToolEvents,
    });
    const inferredById = new Map<string, RenderToolCall>();
    inferred.forEach((call) => inferredById.set(call.id, call));
    const toolDepthById = buildToolDepthMap(inferred);
    const toolParentById = new Map<string, string>();
    const toolsWithChildren = new Set<string>();

    for (const call of inferred) {
        const parentId = call.parentToolCallId;
        if (parentId && parentId !== call.id && inferredById.has(parentId)) {
            toolParentById.set(call.id, parentId);
            toolsWithChildren.add(parentId);
        }
    }

    const chunksByParent = new Map<string, RenderChunk[]>();
    for (const chunk of chunks) {
        const parentId = chunk.kind === 'tool'
            ? (chunk.toolId ? toolParentById.get(chunk.toolId) : undefined)
            : (chunk.parentToolId && inferredById.has(chunk.parentToolId) ? chunk.parentToolId : undefined);
        if (!parentId) continue;
        if (!chunksByParent.has(parentId)) {
            chunksByParent.set(parentId, []);
        }
        chunksByParent.get(parentId)!.push(chunk);
        toolsWithChildren.add(parentId);
    }

    if (!hasContent) {
        const fallbackHtml = toContentHtml(turn.content || '');
        if (fallbackHtml) {
            chunks.unshift({ kind: 'content', key: 'content-fallback', html: fallbackHtml });
        }
    }

    if (!chunks.some((chunk) => chunk.kind === 'tool') && inferred.length > 0) {
        for (const call of inferred) {
            chunks.push({ kind: 'tool', key: `tool-${call.id}`, toolId: call.id });
        }
    }

    return {
        chunks,
        chunksByParent,
        toolById: inferredById,
        toolDepthById,
        toolParentById,
        toolsWithChildren,
    };
}

function buildRawContent(turn: ClientConversationTurn): string {
    const parts: string[] = [];
    if (turn.content) {
        parts.push(turn.content);
    }

    const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    const timeline = Array.isArray(turn.timeline) ? turn.timeline : [];

    // Collect tool calls from timeline or fallback to turn.toolCalls
    const seen = new Set<string>();
    const allCalls: Array<{ toolName: string; status?: string; args: any; result?: string; error?: string }> = [];

    for (const item of timeline) {
        if (item?.toolCall) {
            const tc = item.toolCall;
            const id = tc.id || '';
            if (id && seen.has(id)) {
                // Merge: update status/result/error on existing entry
                const existing = allCalls.find((c) => (c as any)._id === id);
                if (existing) {
                    if (tc.status) existing.status = tc.status;
                    if (tc.result !== undefined) existing.result = tc.result;
                    if (tc.error !== undefined) existing.error = tc.error;
                }
                continue;
            }
            if (id) seen.add(id);
            allCalls.push({ toolName: (tc as any).name || tc.toolName || 'unknown', status: tc.status, args: tc.args, result: tc.result, error: tc.error, _id: id } as any);
        }
    }

    if (allCalls.length === 0) {
        for (const tc of toolCalls) {
            allCalls.push({ toolName: (tc as any).name || tc.toolName || 'unknown', status: tc.status, args: tc.args, result: tc.result, error: tc.error });
        }
    }

    for (const call of allCalls) {
        parts.push('');
        parts.push(`--- tool: ${call.toolName} [${call.status || 'pending'}] ---`);
        if (call.args) {
            const argsStr = typeof call.args === 'string' ? call.args : JSON.stringify(call.args, null, 2);
            parts.push(`Args: ${argsStr}`);
        }
        if (call.result !== undefined) {
            const resultStr = typeof call.result === 'string'
                ? (call.result.length > 2000 ? call.result.slice(0, 2000) + '\n... (truncated)' : call.result)
                : JSON.stringify(call.result, null, 2);
            parts.push(`Result: ${resultStr}`);
        }
        if (call.error !== undefined) {
            parts.push(`Error: ${call.error}`);
        }
    }

    return parts.join('\n');
}

export { buildRawContent as _buildRawContent };

/** Small badge showing per-turn token cost on assistant bubbles. */
function TokenUsageBadge({ tokenUsage }: { tokenUsage: ClientTokenUsage }) {
    const [expanded, setExpanded] = useState(false);

    function fmt(n: number): string {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
        return String(n);
    }

    const summary = `↓${fmt(tokenUsage.inputTokens)} ↑${fmt(tokenUsage.outputTokens)}`;
    const detail = [
        `Input: ${tokenUsage.inputTokens.toLocaleString()}`,
        `Output: ${tokenUsage.outputTokens.toLocaleString()}`,
        tokenUsage.cacheReadTokens > 0 ? `Cache read: ${tokenUsage.cacheReadTokens.toLocaleString()}` : null,
        tokenUsage.cacheWriteTokens > 0 ? `Cache write: ${tokenUsage.cacheWriteTokens.toLocaleString()}` : null,
        `Total: ${tokenUsage.totalTokens.toLocaleString()}`,
    ].filter(Boolean).join(' · ');

    return (
        <button
            className="token-usage-badge inline-flex items-center px-1.5 py-0.5 rounded text-[10px] tabular-nums bg-[#f0f0f0] dark:bg-[#2d2d2d] text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#383838] transition-colors cursor-pointer border border-transparent hover:border-[#d0d0d0] dark:hover:border-[#505050]"
            title={expanded ? 'Click to collapse' : detail}
            onClick={() => setExpanded(v => !v)}
        >
            {expanded ? detail : summary}
        </button>
    );
}

export function ConversationTurnBubble({ turn, taskId, onRetry, processType }: ConversationTurnBubbleProps) {
    const isUser = turn.role === 'user';
    const isScript = !isUser && processType === 'run-script';
    const assistantRender = !isUser ? buildAssistantRender(turn) : null;
    const userContentHtml = isUser ? toContentHtml(turn.content || '') : '';
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Record<string, boolean>>({});
    const [showRaw, setShowRaw] = useState(false);
    const [copied, setCopied] = useState(false);
    const { showReportIntent, toolCompactness, groupSingleLineMessages } = useDisplaySettings();

    // Pre-compute section markdown slices for section-level copy buttons on assistant turns.
    const sectionMarkdown = useMemo(() => {
        if (isUser || !turn.content) return undefined;
        const sections = splitMarkdownSections(turn.content);
        // Only show section copy when there are multiple sections with headings.
        const headingSections = sections.filter(s => s.level > 0);
        return headingSections.length >= 1 ? sections : undefined;
    }, [isUser, turn.content]);

    const displayChunks = useMemo(() => {
        if (!assistantRender) return [];
        if (toolCompactness < 1) return assistantRender.chunks;
        // Exclude both parent tools (rendered as expandable trees) and
        // child tools (rendered under their parent) from grouping.
        const excludeFromGrouping = new Set([
            ...assistantRender.toolsWithChildren,
            ...assistantRender.toolParentById.keys(),
        ]);
        return groupConsecutiveToolChunks(
            assistantRender.chunks,
            assistantRender.toolById,
            excludeFromGrouping,
            { groupSingleLineMessages },
        );
    }, [assistantRender, toolCompactness, groupSingleLineMessages]);

    // Lazy image fetching state
    const [imageLoadState, setImageLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
    const [fetchedImages, setFetchedImages] = useState<string[]>([]);

    const hasInlineImages = turn.images && turn.images.length > 0;
    const needsLazyImages = isUser && !hasInlineImages && !!taskId && (turn.imagesCount ?? 0) > 0;

    const handleLoadImages = async () => {
        if (!taskId) return;
        setImageLoadState('loading');
        try {
            const data = await fetchApi(`/queue/${encodeURIComponent(taskId)}/images`);
            setFetchedImages(data.images || []);
            setImageLoadState('loaded');
        } catch {
            setImageLoadState('error');
        }
    };

    function renderToolTree(toolId: string, depth: number): React.ReactNode {
        if (depth > 20) return null;
        const toolCall = assistantRender!.toolById.get(toolId);
        if (!toolCall) return null;

        // Handle report_intent tool calls
        if (toolCall.toolName === 'report_intent') {
            if (!showReportIntent) return null;
            const intentText = typeof toolCall.args === 'object' && toolCall.args?.intent
                ? String(toolCall.args.intent)
                : typeof toolCall.args === 'string'
                    ? (() => { try { return JSON.parse(toolCall.args).intent || ''; } catch { return ''; } })()
                    : '';
            return (
                <div
                    key={toolId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f0f0f0] dark:bg-[#2d2d2d] text-xs italic text-[#848484] max-w-full"
                    title="report_intent"
                >
                    <span>🏷</span>
                    <span className="truncate">{intentText || 'Intent logged'}</span>
                </div>
            );
        }

        // Hide suggest_follow_ups — its output is rendered as suggestion chips, not as a tool call.
        if (toolCall.toolName === 'suggest_follow_ups') return null;

        const childChunks = assistantRender!.chunksByParent.get(toolId) ?? [];
        const hasSubtools = childChunks.length > 0;
        const isCollapsed = collapsedTaskIds[toolId] ?? true;
        return (
            <ToolCallView
                key={toolId}
                toolCall={toolCall}
                depth={depth}
                hasSubtools={hasSubtools}
                subtoolsCollapsed={isCollapsed}
                onToggleSubtools={() =>
                    setCollapsedTaskIds((prev) => ({ ...prev, [toolId]: !(prev[toolId] ?? true) }))
                }
            >
                {hasSubtools
                    ? (() => {
                        const nodes: React.ReactNode[] = [];
                        let accHtml = '';
                        let accKey = '';
                        const flushContent = () => {
                            if (accKey && accHtml) {
                                nodes.push(<MarkdownView key={accKey} html={accHtml} />);
                                accHtml = '';
                                accKey = '';
                            }
                        };
                        for (const childChunk of childChunks) {
                            if (childChunk.kind === 'content' && childChunk.html) {
                                if (!accKey) accKey = childChunk.key;
                                accHtml += childChunk.html;
                            } else if (childChunk.kind === 'tool' && childChunk.toolId) {
                                const toolNode = renderToolTree(childChunk.toolId, depth + 1);
                                if (toolNode !== null) {
                                    flushContent();
                                    nodes.push(toolNode);
                                }
                            }
                        }
                        flushContent();
                        return nodes;
                    })()
                    : undefined}
            </ToolCallView>
        );
    }

    return (
        <div className={cn(
            'flex', isUser ? 'justify-end' : 'justify-start',
            'chat-message', isUser ? 'user' : 'assistant',
            turn.streaming && 'streaming',
            turn.isError && 'error'
        )}>
            <div
                className={cn(
                    'group w-full max-w-[95%] rounded-lg border px-3 py-2 shadow-sm',
                    isUser
                        ? 'bg-[#e8f3ff] dark:bg-[#0f2a42] border-[#b3d7ff] dark:border-[#2a4a66]'
                        : turn.isError
                            ? 'bg-[#fff5f5] dark:bg-[#2a1a1a] border-[#f14c4c] dark:border-[#8b2020]'
                            : 'bg-[#f8f8f8] dark:bg-[#252526] border-[#e0e0e0] dark:border-[#3c3c3c]'
                )}
            >
                <div className="flex items-center gap-2 text-[11px] text-[#848484] mb-2">
                    <span
                        className={cn(
                            'font-medium uppercase tracking-wide role-label',
                            isUser
                                ? 'text-[#005a9e] dark:text-[#7bbef3]'
                                : isScript
                                    ? 'text-[#16825d] dark:text-[#4ec9b0]'
                                    : 'text-[#5f6a7a] dark:text-[#b0b8c3]'
                        )}
                    >
                        {isUser ? 'You' : isScript ? 'Script Output' : 'Assistant'}
                    </span>
                    {turn.isError && (
                        <span className="text-[#f14c4c] error-indicator text-[10px]">⚠ Error</span>
                    )}
                    {turn.timestamp && (
                        <span className="ml-auto timestamp">{new Date(turn.timestamp).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })} {new Date(turn.timestamp).toLocaleTimeString()}</span>
                    )}
                    {turn.streaming && (
                        <span className="text-[#f14c4c] streaming-indicator">Live</span>
                    )}
                    {!isUser && turn.tokenUsage && !turn.streaming && (
                        <TokenUsageBadge tokenUsage={turn.tokenUsage} />
                    )}
                    {!isUser && turn.isError && onRetry && (
                        <button
                            className="bubble-retry-btn text-[#f14c4c] hover:text-[#d32f2f] transition-colors text-[10px] font-medium"
                            title="Retry this message"
                            onClick={onRetry}
                            data-testid="retry-turn-btn"
                        >
                            ↺ Retry
                        </button>
                    )}
                    <button
                        className="bubble-raw-btn ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                        title={showRaw ? 'View rendered content' : 'View raw content'}
                        onClick={() => setShowRaw((v) => !v)}
                        style={showRaw ? { opacity: 1, color: '#0078d4' } : undefined}
                    >
                        &lt;/&gt;
                    </button>
                    <button
                        className="bubble-copy-btn text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                        title="Copy to clipboard"
                        onClick={async () => {
                            const text = showRaw ? buildRawContent(turn) : (turn.content || '');
                            try {
                                await copyToClipboard(text);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            } catch (e) {
                                console.error('Copy failed:', e);
                            }
                        }}
                    >
                        {copied ? '✓' : '📋'}
                    </button>
                </div>

                <div className="space-y-2 chat-message-content">
                    {isUser && turn.skillNames && turn.skillNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 skill-badges">
                            {turn.skillNames.map(skill => (
                                <span
                                    key={skill}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#dceeff] dark:bg-[#0d2a42] text-[#005a9e] dark:text-[#7bbef3] border border-[#b3d7ff] dark:border-[#2a4a66]"
                                    title={`Skill invoked: ${skill}`}
                                >
                                    /{skill}
                                </span>
                            ))}
                        </div>
                    )}
                    {isUser && !showRaw && userContentHtml && <MarkdownView html={userContentHtml} />}
                    {isUser && showRaw && (
                        <div className="raw-content-view rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#ffffff] dark:bg-[#1e1e1e] overflow-auto max-h-[600px]">
                            <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{turn.content || ''}</code>
                            </pre>
                        </div>
                    )}
                    {isUser && turn.images && turn.images.length > 0 && (
                        <ImageGallery images={turn.images} />
                    )}
                    {isUser && needsLazyImages && imageLoadState === 'idle' && (
                        <button
                            className="text-[11px] text-[#848484] hover:text-[#005a9e] dark:hover:text-[#7bbef3] cursor-pointer bg-transparent border-none p-0"
                            data-testid="load-images-btn"
                            onClick={handleLoadImages}
                        >
                            📷 Load {turn.imagesCount} image{(turn.imagesCount ?? 0) > 1 ? 's' : ''}
                        </button>
                    )}
                    {isUser && needsLazyImages && imageLoadState === 'loading' && (
                        <ImageGallery images={[]} loading={true} imagesCount={turn.imagesCount} />
                    )}
                    {isUser && imageLoadState === 'loaded' && fetchedImages.length > 0 && (
                        <ImageGallery images={fetchedImages} />
                    )}
                    {isUser && needsLazyImages && imageLoadState === 'error' && (
                        <button
                            className="text-[11px] text-[#f14c4c] hover:text-[#d32f2f] cursor-pointer bg-transparent border-none p-0"
                            data-testid="retry-images-btn"
                            onClick={handleLoadImages}
                        >
                            ⚠ Failed to load images · Retry
                        </button>
                    )}
                    {!isUser && showRaw && (
                        <div className="raw-content-view rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#ffffff] dark:bg-[#1e1e1e] overflow-auto max-h-[600px]">
                            <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{buildRawContent(turn)}</code>
                            </pre>
                        </div>
                    )}
                    {!isUser && !showRaw && assistantRender && (() => {
                        const nodes: React.ReactNode[] = [];
                        let accHtml = '';
                        let accKey = '';
                        const flushContent = () => {
                            if (accKey && accHtml) {
                                nodes.push(<MarkdownView key={accKey} html={accHtml} sectionMarkdown={sectionMarkdown} fullMarkdown={turn.content ?? ''} hideSectionCopy={!!turn.streaming} />);
                                accHtml = '';
                                accKey = '';
                            }
                        };
                        for (const chunk of displayChunks) {
                            if (chunk.kind === 'content' && chunk.html) {
                                // Content emitted while a sub-task is active should render under that task.
                                if (chunk.parentToolId && assistantRender.toolById.has(chunk.parentToolId)) continue;
                                if (!accKey) accKey = chunk.key;
                                accHtml += chunk.html;
                            } else if (chunk.kind === 'tool' && chunk.toolId) {
                                // Skip children — they are rendered inside their parent's .tool-call-children
                                if (assistantRender.toolParentById.has(chunk.toolId)) continue;
                                const toolNode = renderToolTree(chunk.toolId, 0);
                                if (toolNode !== null) {
                                    flushContent();
                                    nodes.push(toolNode);
                                }
                            } else if (chunk.kind === 'tool-group' && chunk.toolIds) {
                                flushContent();
                                const toolCalls = chunk.toolIds
                                    .map(id => assistantRender.toolById.get(id))
                                    .filter((tc): tc is NonNullable<typeof tc> => tc != null);
                                nodes.push(
                                    <ToolCallGroupView
                                        key={chunk.key}
                                        category={chunk.category}
                                        toolCalls={toolCalls}
                                        contentItems={chunk.contentItems}
                                        orderedItems={chunk.orderedItems}
                                        isStreaming={!!turn.streaming}
                                        compactness={toolCompactness}
                                        renderToolTree={renderToolTree}
                                    />
                                );
                            }
                        }
                        flushContent();
                        return nodes;
                    })()}
                </div>
            </div>
        </div>
    );
}
