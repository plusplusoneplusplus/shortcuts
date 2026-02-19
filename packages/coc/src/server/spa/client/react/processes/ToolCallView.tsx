/**
 * ToolCallView — renders a single tool call with collapsible args/result.
 * Replaces renderToolCall / normalizeToolCall from tool-renderer.ts.
 */

import { useState } from 'react';
import { cn } from '../shared';

interface ToolCallProps {
    toolCall: {
        id?: string;
        toolName?: string;
        name?: string;
        args?: any;
        result?: string;
        error?: string;
        status?: string;
        startTime?: string;
        endTime?: string;
    };
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

export function ToolCallView({ toolCall }: ToolCallProps) {
    const [expanded, setExpanded] = useState(false);
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
        <div className="my-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs">
            <div
                className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none',
                    hasDetails && 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                )}
                onClick={() => hasDetails && setExpanded(!expanded)}
            >
                <span>{statusIndicator(toolCall.status)}</span>
                <span className="font-medium text-[#0078d4] dark:text-[#3794ff]">{name}</span>
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
            {expanded && hasDetails && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-2.5 py-2 space-y-2">
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
                    {name !== 'bash' && args && (
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
        </div>
    );
}
