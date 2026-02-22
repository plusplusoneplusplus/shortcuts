/**
 * ConversationTurnBubble — role-aware chat bubble for conversation turns.
 */
import { useMemo, useState } from 'react';
import { cn } from '../shared';
import type { ClientConversationTurn } from '../types/dashboard';
import { MarkdownView } from './MarkdownView';
import { ToolCallView } from './ToolCallView';
import { renderMarkdownToHtml } from '../../markdown-renderer';
import { useDisplaySettings } from '../hooks/useDisplaySettings';

interface ConversationTurnBubbleProps {
    turn: ClientConversationTurn;
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

interface RenderChunk {
    kind: 'content' | 'tool';
    key: string;
    html?: string;
    toolId?: string;
}

const HTML_LIKE_RE = /<[a-z][\s\S]*>/i;

function toContentHtml(content: string): string {
    if (!content) return '';
    return HTML_LIKE_RE.test(content) ? content : renderMarkdownToHtml(content);
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

function toMillis(iso?: string): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Infer parent relationships when events do not include explicit parent IDs.
 * This mirrors the legacy renderer behavior to keep subagent tool nesting.
 */
function inferParentToolCalls(calls: RenderToolCall[]): RenderToolCall[] {
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
    toolById: Map<string, RenderToolCall>;
    toolDepthById: Map<string, number>;
    toolParentById: Map<string, string>;
    toolsWithChildren: Set<string>;
} {
    const chunks: RenderChunk[] = [];
    const timeline = Array.isArray(turn.timeline) ? turn.timeline : [];
    let hasContent = false;

    const callsById = new Map<string, RenderToolCall>();
    const callOrder: string[] = [];

    for (let i = 0; i < timeline.length; i++) {
        const item: any = timeline[i];
        if (!item) continue;

        if (item.type === 'content') {
            const html = toContentHtml(item.content || '');
            if (html) {
                chunks.push({ kind: 'content', key: `content-${i}`, html });
                hasContent = true;
            }
            continue;
        }

        if (typeof item.type === 'string' && item.type.startsWith('tool-') && item.toolCall) {
            const incoming = normalizeToolCall(item.toolCall, `tool-${i}`);
            const existing = callsById.get(incoming.id);
            if (existing) {
                mergeToolCall(existing, incoming);
            } else {
                callsById.set(incoming.id, incoming);
                callOrder.push(incoming.id);
                chunks.push({ kind: 'tool', key: `tool-${incoming.id}`, toolId: incoming.id });
            }
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
    const inferred = inferParentToolCalls(orderedCalls);
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

    return { chunks, toolById: inferredById, toolDepthById, toolParentById, toolsWithChildren };
}

export function ConversationTurnBubble({ turn }: ConversationTurnBubbleProps) {
    const isUser = turn.role === 'user';
    const assistantRender = !isUser ? buildAssistantRender(turn) : null;
    const userContentHtml = isUser ? toContentHtml(turn.content || '') : '';
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Record<string, boolean>>({});
    const { showReportIntent } = useDisplaySettings();

    const isToolHiddenByCollapsedTask = useMemo(() => {
        if (!assistantRender) return (_toolId: string) => false;
        return (toolId: string): boolean => {
            let current = assistantRender.toolParentById.get(toolId);
            while (current) {
                if (collapsedTaskIds[current]) return true;
                current = assistantRender.toolParentById.get(current);
            }
            return false;
        };
    }, [assistantRender, collapsedTaskIds]);

    return (
        <div className={cn(
            'flex', isUser ? 'justify-end' : 'justify-start',
            'chat-message', isUser ? 'user' : 'assistant',
            turn.streaming && 'streaming'
        )}>
            <div
                className={cn(
                    'group w-full max-w-[95%] rounded-lg border px-3 py-2 shadow-sm',
                    isUser
                        ? 'bg-[#e8f3ff] dark:bg-[#0f2a42] border-[#b3d7ff] dark:border-[#2a4a66]'
                        : 'bg-[#f8f8f8] dark:bg-[#252526] border-[#e0e0e0] dark:border-[#3c3c3c]'
                )}
            >
                <div className="flex items-center gap-2 text-[11px] text-[#848484] mb-2">
                    <span
                        className={cn(
                            'font-medium uppercase tracking-wide role-label',
                            isUser ? 'text-[#005a9e] dark:text-[#7bbef3]' : 'text-[#5f6a7a] dark:text-[#b0b8c3]'
                        )}
                    >
                        {isUser ? 'You' : 'Assistant'}
                    </span>
                    {turn.timestamp && (
                        <span className="ml-auto timestamp">{new Date(turn.timestamp).toLocaleTimeString()}</span>
                    )}
                    {turn.streaming && (
                        <span className="text-[#f14c4c] streaming-indicator">Live</span>
                    )}
                    {!isUser && (
                        <button
                            className="bubble-copy-btn ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                            title="Copy to clipboard"
                            onClick={() => {
                                const text = turn.content || '';
                                navigator.clipboard?.writeText(text).catch(() => {});
                            }}
                        >
                            📋
                        </button>
                    )}
                </div>

                <div className="space-y-2 chat-message-content">
                    {isUser && userContentHtml && <MarkdownView html={userContentHtml} />}
                    {!isUser && assistantRender && assistantRender.chunks.map((chunk) => {
                        if (chunk.kind === 'content' && chunk.html) {
                            return <MarkdownView key={chunk.key} html={chunk.html} />;
                        }
                        if (chunk.kind === 'tool' && chunk.toolId) {
                            const toolCall = assistantRender.toolById.get(chunk.toolId);
                            if (!toolCall) return null;
                            if (isToolHiddenByCollapsedTask(toolCall.id)) return null;

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
                                        key={chunk.key}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f0f0f0] dark:bg-[#2d2d2d] text-xs italic text-[#848484] max-w-full"
                                        title="report_intent"
                                    >
                                        <span>🏷</span>
                                        <span className="truncate">{intentText || 'Intent logged'}</span>
                                    </div>
                                );
                            }

                            const depth = assistantRender.toolDepthById.get(chunk.toolId) || 0;
                            const hasSubtools = toolCall.toolName === 'task' && assistantRender.toolsWithChildren.has(toolCall.id);

                            return (
                                <ToolCallView
                                    key={chunk.key}
                                    toolCall={toolCall}
                                    depth={depth}
                                    hasSubtools={hasSubtools}
                                    subtoolsCollapsed={!!collapsedTaskIds[toolCall.id]}
                                    onToggleSubtools={() =>
                                        setCollapsedTaskIds((prev) => ({
                                            ...prev,
                                            [toolCall.id]: !prev[toolCall.id],
                                        }))
                                    }
                                />
                            );
                        }
                        return null;
                    })}
                </div>
            </div>
        </div>
    );
}
