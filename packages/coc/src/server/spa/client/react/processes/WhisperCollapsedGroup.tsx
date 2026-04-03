/**
 * WhisperCollapsedGroup — a single collapsed summary for all preceding chunks
 * in Whisper verbosity mode (level 3). Shows an aggregate header with tool call
 * and message counts. Expands to reveal Compact-level (level 1) rendering.
 */
import React, { useState, useMemo } from 'react';
import { cn } from '../shared';
import type { WhisperSummary } from './toolGroupUtils';
import { groupConsecutiveToolChunks } from './toolGroupUtils';
import { ToolCallGroupView } from './ToolCallGroupView';
import type { RenderToolCall } from './ToolCallGroupView';
import { MarkdownView } from './MarkdownView';
import { detectCommitsInToolGroup } from './commitDetection';
import { CommitStrip } from './CommitStrip';

interface ToolLike {
    toolName: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    args?: Record<string, unknown>;
    id?: string;
    result?: string;
}

interface ToolChunk {
    kind: string;
    key: string;
    html?: string;
    toolId?: string;
    parentToolId?: string;
    [key: string]: unknown;
}

export interface WhisperCollapsedGroupProps {
    precedingChunks: ToolChunk[];
    summary: WhisperSummary;
    toolById: Map<string, ToolLike>;
    toolsWithChildren: Set<string>;
    toolParentById: Map<string, string>;
    isStreaming?: boolean;
    groupSingleLineMessages: boolean;
    workspaceId?: string;
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
}

function formatDuration(startTime?: number, endTime?: number): string {
    if (startTime == null || endTime == null) return '';
    const ms = endTime - startTime;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function WhisperCollapsedGroup({
    precedingChunks,
    summary,
    toolById,
    toolsWithChildren,
    toolParentById,
    isStreaming,
    groupSingleLineMessages,
    workspaceId,
    renderToolTree,
}: WhisperCollapsedGroupProps) {
    const [expanded, setExpanded] = useState(false);

    const headerParts: string[] = [];
    if (summary.toolCallCount > 0) {
        headerParts.push(`${summary.toolCallCount} tool call${summary.toolCallCount !== 1 ? 's' : ''}`);
    }
    if (summary.messageCount > 0) {
        headerParts.push(`${summary.messageCount} message${summary.messageCount !== 1 ? 's' : ''}`);
    }
    const duration = formatDuration(summary.startTime, summary.endTime);
    const headerText = headerParts.join(' · ') + (duration ? ` (${duration})` : '');

    // When expanded, apply Compact-level grouping to preceding chunks
    const groupedChunks = useMemo(() => {
        if (!expanded) return [];
        const excludeFromGrouping = new Set([
            ...toolsWithChildren,
            ...toolParentById.keys(),
        ]);
        return groupConsecutiveToolChunks(
            precedingChunks,
            toolById as Map<string, any>,
            excludeFromGrouping,
            { groupSingleLineMessages },
        );
    }, [expanded, precedingChunks, toolById, toolsWithChildren, toolParentById, groupSingleLineMessages]);

    return (
        <div
            className="whisper-collapsed-group rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden"
            data-testid="whisper-collapsed-group"
        >
            <button
                type="button"
                className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    'bg-[#f5f5f5] dark:bg-[#2a2a2a] text-[#848484] hover:bg-[#ebebeb] dark:hover:bg-[#333]',
                    'opacity-70 hover:opacity-100',
                )}
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                data-testid="whisper-toggle"
            >
                <span>🔇</span>
                <span className="flex-1 truncate">{headerText}</span>
                <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
            </button>
            {expanded && (
                <div className="px-3 py-2 space-y-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] opacity-80" data-testid="whisper-expanded-content">
                    {(() => {
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
                        for (const chunk of groupedChunks) {
                            if (chunk.kind === 'content' && (chunk as any).html) {
                                if ((chunk as any).parentToolId && toolById.has((chunk as any).parentToolId)) continue;
                                if (!accKey) accKey = chunk.key;
                                accHtml += (chunk as any).html;
                            } else if (chunk.kind === 'tool' && chunk.toolId) {
                                if (toolParentById.has(chunk.toolId)) continue;
                                const toolNode = renderToolTree(chunk.toolId, 0);
                                if (toolNode !== null) {
                                    flushContent();
                                    const tool = toolById.get(chunk.toolId);
                                    const toolName = tool?.toolName ?? '';
                                    if ((toolName === 'powershell' || toolName === 'shell') && tool?.result) {
                                        const commits = detectCommitsInToolGroup([{
                                            id: chunk.toolId,
                                            toolName,
                                            args: tool.args,
                                            result: tool.result,
                                            status: tool.status,
                                        }]);
                                        if (commits.length > 0) {
                                            nodes.push(
                                                <React.Fragment key={chunk.key + '-with-commit'}>
                                                    {toolNode}
                                                    <CommitStrip commits={commits} workspaceId={workspaceId} />
                                                </React.Fragment>
                                            );
                                            continue;
                                        }
                                    }
                                    nodes.push(toolNode);
                                }
                            } else if (chunk.kind === 'tool-group' && (chunk as any).toolIds) {
                                flushContent();
                                const toolIds = (chunk as any).toolIds as string[];
                                const toolCalls = toolIds
                                    .map(id => toolById.get(id))
                                    .filter((tc): tc is NonNullable<typeof tc> => tc != null) as unknown as RenderToolCall[];
                                const commits = (chunk as any).category === 'shell'
                                    ? detectCommitsInToolGroup(toolCalls as any)
                                    : undefined;
                                nodes.push(
                                    <ToolCallGroupView
                                        key={chunk.key}
                                        category={(chunk as any).category}
                                        toolCalls={toolCalls}
                                        contentItems={(chunk as any).contentItems}
                                        orderedItems={(chunk as any).orderedItems}
                                        isStreaming={!!isStreaming}
                                        compactness={1}
                                        agentId={(chunk as any).agentId}
                                        renderToolTree={renderToolTree}
                                        commits={commits}
                                        workspaceId={workspaceId}
                                    />
                                );
                            }
                        }
                        flushContent();
                        return nodes;
                    })()}
                </div>
            )}
        </div>
    );
}
