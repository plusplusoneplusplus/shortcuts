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

function formatArgs(args: any): string {
    if (!args) return '';
    if (typeof args === 'string') {
        try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; }
    }
    return JSON.stringify(args, null, 2);
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
    const args = formatArgs(toolCall.args);
    const hasDetails = args || toolCall.result || toolCall.error;

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
                {hasDetails && (
                    <span className="ml-auto text-[#848484]">{expanded ? '▼' : '▶'}</span>
                )}
            </div>
            {expanded && hasDetails && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-2.5 py-2 space-y-2">
                    {args && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Args</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{args}</code>
                            </pre>
                        </div>
                    )}
                    {toolCall.result && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Result</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{toolCall.result}</code>
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
