/**
 * ToolCallView — renders a single tool call with collapsible args/result.
 * Replaces renderToolCall / normalizeToolCall from tool-renderer.ts.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '../shared';
import { computeLineDiff, type DiffLine } from '../../diff-utils';

interface ToolCallData {
    id?: string;
    toolName?: string;
    name?: string;
    args?: any;
    result?: string;
    error?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
    children?: ToolCallData[];
}

interface ToolCallProps {
    toolCall: ToolCallData;
    depth?: number;
    hasSubtools?: boolean;
    subtoolsCollapsed?: boolean;
    onToggleSubtools?: () => void;
    children?: React.ReactNode;
}

const MAX_RESULT_LENGTH = 5000;
const TRUNCATED_RESULT_LENGTH = 4900;

function formatArgs(args: any): string {
    if (!args) return '';
    if (typeof args === 'string') {
        try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; }
    }
    return JSON.stringify(args, null, 2);
}

function parseArgsObject(args: any): Record<string, any> | null {
    if (!args) return null;
    if (typeof args === 'object' && !Array.isArray(args)) {
        return args as Record<string, any>;
    }
    if (typeof args === 'string') {
        try {
            const parsed = JSON.parse(args);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, any>;
            }
        } catch {
            return null;
        }
    }
    return null;
}

function shortenPath(p: string): string {
    if (!p) return '';
    return p
        .replace(/^\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^\/Users\/[^/]+\//, '~/')
        .replace(/^\/home\/[^/]+\//, '~/');
}

function getToolSummary(toolName: string, args: any): string {
    if (!args || typeof args !== 'object') return '';

    switch (toolName) {
        case 'grep': {
            const parts: string[] = [];
            if (args.pattern) parts.push(`/${args.pattern}/`);
            if (args.path) parts.push(shortenPath(args.path));
            else if (args.glob) parts.push(args.glob);
            return parts.join(' in ');
        }
        case 'view': {
            let p = '';
            if (args.path) p = shortenPath(args.path);
            else if (args.filePath) p = shortenPath(args.filePath);
            if (p && args.view_range && Array.isArray(args.view_range) && args.view_range.length >= 2) {
                p += ` L${args.view_range[0]}-L${args.view_range[1]}`;
            }
            return p;
        }
        case 'edit':
        case 'create': {
            if (args.path) return shortenPath(args.path);
            if (args.filePath) return shortenPath(args.filePath);
            return '';
        }
        case 'bash': {
            if (typeof args.command === 'string' && args.command.trim()) {
                const cmd = args.command.trim();
                return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
            }
            return '';
        }
        case 'glob': {
            const parts: string[] = [];
            if (args.pattern) parts.push(args.pattern);
            else if (args.glob_pattern) parts.push(args.glob_pattern);
            if (args.path) parts.push(`in ${shortenPath(args.path)}`);
            return parts.join(' ');
        }
        case 'skill': {
            if (args.name) return args.name;
            if (args.skill_name) return args.skill_name;
            if (args.skill) return args.skill;
            return '';
        }
        case 'task': {
            const parts: string[] = [];
            if (args.agent_type) parts.push(`[${args.agent_type}]`);
            if (args.description) parts.push(args.description);
            else if (typeof args.prompt === 'string' && args.prompt.trim()) {
                const prompt = args.prompt.trim();
                parts.push(prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt);
            }
            return parts.join(' ');
        }
        default: {
            for (const key of ['path', 'filePath', 'file', 'pattern', 'query', 'command', 'url']) {
                if (typeof args[key] === 'string' && args[key]) {
                    const val = args[key];
                    if (val.startsWith('/')) return shortenPath(val);
                    return val.length > 60 ? `${val.slice(0, 57)}...` : val;
                }
            }
            return '';
        }
    }
}

function formatDuration(startTime?: string, endTime?: string): string {
    if (!startTime) return '';
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const ms = end - start;
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function statusIndicator(status?: string) {
    switch (status) {
        case 'running': return '🔄';
        case 'completed': return '✅';
        case 'failed': return '❌';
        default: return '⏳';
    }
}

function DiffView({ diffLines }: { diffLines: DiffLine[] }) {
    return (
        <div className="diff-container rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
            {diffLines.map((line, i) => (
                <div
                    key={i}
                    className={cn(
                        'diff-line px-2 whitespace-pre-wrap break-words',
                        line.type === 'added' && 'diff-line-added',
                        line.type === 'removed' && 'diff-line-removed',
                        line.type === 'context' && 'diff-line-context'
                    )}
                >
                    <span className="diff-line-prefix inline-block w-3 select-none text-right mr-1 opacity-70">
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                    </span>
                    {line.content}
                </div>
            ))}
        </div>
    );
}

function EditToolView({ args }: { args: Record<string, any> }) {
    const filePath = args.path || args.filePath || '';
    const oldStr = typeof args.old_str === 'string' ? args.old_str : (typeof args.old_string === 'string' ? args.old_string : '');
    const newStr = typeof args.new_str === 'string' ? args.new_str : (typeof args.new_string === 'string' ? args.new_string : '');

    const diffLines = useMemo(() => computeLineDiff(oldStr, newStr), [oldStr, newStr]);

    return (
        <div className="space-y-1.5">
            {filePath && (
                <div className="text-[10px] uppercase text-[#848484] mb-0.5">
                    📁 {shortenPath(filePath)}
                </div>
            )}
            {diffLines ? (
                <DiffView diffLines={diffLines} />
            ) : (
                <>
                    {oldStr && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Old</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{oldStr}</code>
                            </pre>
                        </div>
                    )}
                    {newStr && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">New</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{newStr}</code>
                            </pre>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function CreateToolView({ args }: { args: Record<string, any> }) {
    const filePath = args.path || args.filePath || '';
    const fileText = typeof args.file_text === 'string' ? args.file_text : '';

    return (
        <div className="space-y-1.5">
            {filePath && (
                <div className="text-[10px] uppercase text-[#848484] mb-0.5">
                    📁 {shortenPath(filePath)}
                </div>
            )}
            {fileText && (
                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 font-mono text-[#1e1e1e] dark:text-[#cccccc]">
                    <code>{fileText}</code>
                </pre>
            )}
        </div>
    );
}

export function ToolCallView({
    toolCall,
    depth = 0,
    hasSubtools = false,
    subtoolsCollapsed = false,
    onToggleSubtools,
    children,
}: ToolCallProps) {
    const [expanded, setExpanded] = useState(false);
    if (depth > 20) return null;

    const depthLevel = Math.max(0, Math.min(depth, 8));
    const name = toolCall.toolName || toolCall.name || 'unknown';
    const argsObj = parseArgsObject(toolCall.args);
    const args = formatArgs(toolCall.args);
    const hasDetails = args || toolCall.result || toolCall.error;
    const summary = getToolSummary(name, argsObj);
    const duration = formatDuration(toolCall.startTime, toolCall.endTime);
    const resultText = typeof toolCall.result === 'string' ? toolCall.result : '';
    const isResultTruncated = resultText.length > MAX_RESULT_LENGTH;
    const visibleResult = isResultTruncated ? `${resultText.slice(0, TRUNCATED_RESULT_LENGTH)}\n... (output truncated)` : resultText;

    const bashDescription = name === 'bash' && argsObj && typeof argsObj === 'object' && argsObj.description
        ? String(argsObj.description)
        : '';
    const bashCommand = name === 'bash' && argsObj && typeof argsObj === 'object' && argsObj.command
        ? String(argsObj.command)
        : '';
    const bashOptions = name === 'bash' && argsObj && typeof argsObj === 'object'
        ? Object.fromEntries(
            Object.entries(argsObj).filter(([key]) => key !== 'description' && key !== 'command')
        )
        : null;
    const bashOptionsText = bashOptions && Object.keys(bashOptions).length > 0 ? JSON.stringify(bashOptions, null, 2) : '';

    return (
        <div
            className={cn(
                'tool-call-card my-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs',
                depthLevel > 0 && 'border-l-2'
            )}
            data-tool-id={toolCall.id || toolCall.toolName || 'unknown'}
            style={depthLevel > 0 ? { marginLeft: `${depthLevel * 12}px` } : undefined}
        >
            <div
                className={cn(
                    'tool-call-header flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none',
                    hasDetails && 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                )}
                onClick={() => hasDetails && setExpanded(!expanded)}
            >
                <span>{statusIndicator(toolCall.status)}</span>
                {hasSubtools && (
                    <button
                        type="button"
                        className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        aria-label={subtoolsCollapsed ? 'Expand subtools' : 'Collapse subtools'}
                        title={subtoolsCollapsed ? 'Expand subtools' : 'Collapse subtools'}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleSubtools?.();
                        }}
                    >
                        {subtoolsCollapsed ? '▶' : '▼'}
                    </button>
                )}
                <span className="tool-call-name font-medium text-[#0078d4] dark:text-[#3794ff]">{name}</span>
                {summary && (
                    <span className="text-[#848484] truncate min-w-0" title={summary}>
                        {summary}
                    </span>
                )}
                {duration && (
                    <span className="text-[#848484] ml-auto">{duration}</span>
                )}
                {hasDetails && (
                    <span className={cn('text-[#848484]', !duration && 'ml-auto')}>{expanded ? '▼' : '▶'}</span>
                )}
            </div>
            {hasDetails && (
                <div className={cn(
                    'tool-call-body border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-2.5 py-2 space-y-2',
                    !expanded && 'collapsed',
                    !expanded && 'hidden'
                )}>
                    {name === 'bash' && bashDescription && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Description</div>
                            <div className="text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                {bashDescription}
                            </div>
                        </div>
                    )}
                    {name === 'bash' && bashCommand && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Command</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{`$ ${bashCommand}`}</code>
                            </pre>
                        </div>
                    )}
                    {name === 'bash' && bashOptionsText && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Options</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{bashOptionsText}</code>
                            </pre>
                        </div>
                    )}
                    {name === 'edit' && argsObj && (
                        <EditToolView args={argsObj} />
                    )}
                    {name === 'create' && argsObj && (
                        <CreateToolView args={argsObj} />
                    )}
                    {name !== 'bash' && name !== 'edit' && name !== 'create' && args && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Arguments</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{args}</code>
                            </pre>
                        </div>
                    )}
                    {resultText && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Result</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{visibleResult}</code>
                            </pre>
                        </div>
                    )}
                    {toolCall.error && (
                        <div>
                            <div className="text-[10px] uppercase text-[#f14c4c] mb-0.5">Error</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#f14c4c]">
                                <code>{toolCall.error}</code>
                            </pre>
                        </div>
                    )}
                </div>
            )}
            {children && (
                <div className={cn('tool-call-children', subtoolsCollapsed && 'subtree-collapsed')}>
                    {children}
                </div>
            )}
        </div>
    );
}
