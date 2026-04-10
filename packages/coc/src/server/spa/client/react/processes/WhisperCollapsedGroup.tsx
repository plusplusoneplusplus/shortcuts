/**
 * WhisperCollapsedGroup — a single collapsed summary for all preceding chunks
 * in Whisper verbosity mode (level 3). Shows an aggregate header with tool call
 * and message counts. Expands to reveal Compact-level (level 1) rendering.
 */
import React, { useState, useMemo, useRef, useCallback } from 'react';
import { cn } from '../shared';
import type { WhisperSummary, FileEdit } from './toolGroupUtils';
import { groupConsecutiveToolChunks } from './toolGroupUtils';
import { ToolCallGroupView } from './ToolCallGroupView';
import type { RenderToolCall } from './ToolCallGroupView';
import { MarkdownView } from './MarkdownView';
import { detectCommitsInToolGroup } from './commitDetection';
import type { DetectedCommit } from './commitDetection';
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

// ---------------------------------------------------------------------------
// SkillHoverPopover — shown when hovering over "N skills"
// ---------------------------------------------------------------------------

interface SkillHoverPopoverProps {
    skillNames: string[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
}

function SkillHoverPopover({ skillNames, anchorRef }: SkillHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();

    return (
        <div
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[200px] max-w-[400px]"
            style={{ top: rect.bottom + 4, left: rect.left }}
            data-testid="skill-hover-popover"
        >
            {skillNames.map(name => (
                <div
                    key={name}
                    className="flex items-center gap-2 px-2.5 py-1 text-xs"
                    data-testid="skill-popover-row"
                >
                    <span className="shrink-0">🛠</span>
                    <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                        {name}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// SkillHoverSpan — a span that shows a skill popover on hover
// ---------------------------------------------------------------------------

interface SkillHoverSpanProps {
    text: string;
    skillNames: string[];
    testId?: string;
}

function SkillHoverSpan({ text, skillNames, testId }: SkillHoverSpanProps) {
    const [hovered, setHovered] = useState(false);
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showPopover = useCallback(() => {
        if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
        setHovered(true);
    }, []);

    const hidePopover = useCallback(() => {
        graceTimer.current = setTimeout(() => setHovered(false), 150);
    }, []);

    return (
        <span
            ref={anchorRef}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
            className="underline decoration-dotted cursor-default"
            data-testid={testId}
        >
            {text}
            {hovered && skillNames.length > 0 && (
                <span onMouseEnter={showPopover} onMouseLeave={hidePopover}>
                    <SkillHoverPopover skillNames={skillNames} anchorRef={anchorRef} />
                </span>
            )}
        </span>
    );
}

// ---------------------------------------------------------------------------
// CommitHoverPopover — shown when hovering over "N commits" / "N fixups"
// ---------------------------------------------------------------------------

interface CommitHoverPopoverProps {
    commits: DetectedCommit[];
    workspaceId?: string;
    anchorRef: React.RefObject<HTMLSpanElement | null>;
}

function CommitHoverPopover({ commits, workspaceId, anchorRef }: CommitHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();

    return (
        <div
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[200px] max-w-[400px]"
            style={{ top: rect.bottom + 4, left: rect.left }}
            data-testid="commit-hover-popover"
        >
            {commits.map(commit => (
                <div
                    key={commit.shortHash}
                    className={
                        'flex items-center gap-2 px-2.5 py-1 text-xs ' +
                        (commit.isFixup ? 'opacity-70 ' : '') +
                        (workspaceId
                            ? 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]'
                            : '')
                    }
                    data-testid={`commit-popover-row-${commit.shortHash}`}
                    onClick={workspaceId ? (e) => {
                        e.stopPropagation();
                        const hash = commit.fullHash || commit.shortHash;
                        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash;
                    } : undefined}
                    role={workspaceId ? 'link' : undefined}
                >
                    <span className="shrink-0">{commit.isFixup ? '🔧' : '🔀'}</span>
                    <span className="font-mono shrink-0 text-[#f57c00] dark:text-[#ffb74d]">
                        {commit.shortHash}
                    </span>
                    <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                        {commit.subject}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// FileHoverPopover — shown when hovering over "N files"
// ---------------------------------------------------------------------------

interface FileHoverPopoverProps {
    files: FileEdit[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
}

function FileHoverPopover({ files, anchorRef }: FileHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();

    return (
        <div
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[200px] max-w-[400px]"
            style={{ top: rect.bottom + 4, left: rect.left }}
            data-testid="file-hover-popover"
        >
            {files.map(file => {
                const basename = file.path.split(/[/\\]/).pop() || file.path;
                return (
                    <div
                        key={file.path}
                        className="flex items-center gap-2 px-2.5 py-1 text-xs"
                        data-testid={`file-popover-row`}
                        title={file.path}
                    >
                        <span className="shrink-0">{file.isCreate ? '📄' : '✏️'}</span>
                        <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                            {basename}
                        </span>
                        {file.insertions > 0 && (
                            <span className="shrink-0 text-[#22863a] dark:text-[#85e89d]">+{file.insertions}</span>
                        )}
                        {file.deletions > 0 && (
                            <span className="shrink-0 text-[#cb2431] dark:text-[#f97583]">−{file.deletions}</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// FileHoverSpan — a span that shows a file popover on hover
// ---------------------------------------------------------------------------

interface FileHoverSpanProps {
    text: string;
    files: FileEdit[];
    testId?: string;
}

function FileHoverSpan({ text, files, testId }: FileHoverSpanProps) {
    const [hovered, setHovered] = useState(false);
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showPopover = useCallback(() => {
        if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
        setHovered(true);
    }, []);

    const hidePopover = useCallback(() => {
        graceTimer.current = setTimeout(() => setHovered(false), 150);
    }, []);

    return (
        <span
            ref={anchorRef}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
            className="underline decoration-dotted cursor-default"
            data-testid={testId}
        >
            {text}
            {hovered && files.length > 0 && (
                <span onMouseEnter={showPopover} onMouseLeave={hidePopover}>
                    <FileHoverPopover files={files} anchorRef={anchorRef} />
                </span>
            )}
        </span>
    );
}

// ---------------------------------------------------------------------------
// CommitHoverSpan — a span that shows a popover on hover
// ---------------------------------------------------------------------------

interface CommitHoverSpanProps {
    text: string;
    commits: DetectedCommit[];
    workspaceId?: string;
    testId?: string;
}

function CommitHoverSpan({ text, commits, workspaceId, testId }: CommitHoverSpanProps) {
    const [hovered, setHovered] = useState(false);
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showPopover = useCallback(() => {
        if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
        setHovered(true);
    }, []);

    const hidePopover = useCallback(() => {
        graceTimer.current = setTimeout(() => setHovered(false), 150);
    }, []);

    return (
        <span
            ref={anchorRef}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
            className="underline decoration-dotted cursor-default"
            data-testid={testId}
        >
            {text}
            {hovered && commits.length > 0 && (
                <span onMouseEnter={showPopover} onMouseLeave={hidePopover}>
                    <CommitHoverPopover commits={commits} workspaceId={workspaceId} anchorRef={anchorRef} />
                </span>
            )}
        </span>
    );
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

    const headerParts: Array<{ text: string; title?: string; kind?: 'commit' | 'fixup' | 'file' | 'skill' }> = [];
    if (summary.toolCallCount > 0) {
        headerParts.push({ text: `${summary.toolCallCount} tool call${summary.toolCallCount !== 1 ? 's' : ''}` });
    }
    if (summary.messageCount > 0) {
        headerParts.push({ text: `${summary.messageCount} message${summary.messageCount !== 1 ? 's' : ''}` });
    }
    if (summary.fileEditCount && summary.fileEditCount > 0) {
        headerParts.push({ text: `${summary.fileEditCount} file${summary.fileEditCount !== 1 ? 's' : ''}`, kind: 'file' });
    }
    if (summary.commitCount && summary.commitCount > 0) {
        headerParts.push({ text: `${summary.commitCount} commit${summary.commitCount !== 1 ? 's' : ''}`, kind: 'commit' });
    }
    if (summary.fixupCommitCount && summary.fixupCommitCount > 0) {
        headerParts.push({ text: `${summary.fixupCommitCount} fixup${summary.fixupCommitCount !== 1 ? 's' : ''}`, kind: 'fixup' });
    }
    if (summary.skillCount && summary.skillCount > 0) {
        headerParts.push({
            text: `${summary.skillCount} skill${summary.skillCount !== 1 ? 's' : ''}`,
            kind: 'skill',
        });
    }
    const duration = formatDuration(summary.startTime, summary.endTime);
    const headerTextPlain = headerParts.map(p => p.text).join(' · ') + (duration ? ` (${duration})` : '');

    const headerElements: React.ReactNode[] = [];
    headerParts.forEach((part, idx) => {
        if (idx > 0) headerElements.push(<span key={`sep-${idx}`}> · </span>);
        if (part.kind === 'commit' && summary.commits && summary.commits.length > 0) {
            headerElements.push(
                <CommitHoverSpan key={`part-${idx}`} text={part.text} commits={summary.commits} workspaceId={workspaceId} testId="whisper-commit-hover" />,
            );
        } else if (part.kind === 'fixup' && summary.fixupCommits && summary.fixupCommits.length > 0) {
            headerElements.push(
                <CommitHoverSpan key={`part-${idx}`} text={part.text} commits={summary.fixupCommits} workspaceId={workspaceId} testId="whisper-fixup-hover" />,
            );
        } else if (part.kind === 'file' && summary.fileEdits && summary.fileEdits.length > 0) {
            headerElements.push(
                <FileHoverSpan key={`part-${idx}`} text={part.text} files={summary.fileEdits} testId="whisper-file-hover" />,
            );
        } else if (part.kind === 'skill' && summary.skillNames && summary.skillNames.length > 0) {
            headerElements.push(
                <SkillHoverSpan key={`part-${idx}`} text={part.text} skillNames={summary.skillNames} testId="whisper-skill-hover" />,
            );
        } else {
            headerElements.push(<span key={`part-${idx}`}>{part.text}</span>);
        }
    });
    if (duration) {
        headerElements.push(<span key="duration"> ({duration})</span>);
    }

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
                    'w-full flex items-center gap-2 px-2 py-1 md:px-3 md:py-1.5 text-xs text-left transition-colors',
                    'bg-[#f5f5f5] dark:bg-[#2a2a2a] text-[#848484] hover:bg-[#ebebeb] dark:hover:bg-[#333]',
                    'opacity-70 hover:opacity-100',
                )}
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                data-testid="whisper-toggle"
            >
                <span>🔇</span>
                <span className="flex-1 truncate" data-testid="whisper-header-text" title={headerTextPlain}>{headerElements}</span>
                <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
            </button>
            {expanded && (
                <div className="px-2 py-1.5 space-y-1.5 md:px-3 md:py-2 md:space-y-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] opacity-80" data-testid="whisper-expanded-content">
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
