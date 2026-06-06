/**
 * ToolCallView — renders a single tool call with collapsible args/result.
 * Replaces renderToolCall / normalizeToolCall from tool-renderer.ts.
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { cn, FilePathLink } from '../../../../ui';
import { shortenFilePath } from '../../../../shared';
import { isImageFile, getImageMimeType } from '../../../../shared/file-path-utils';
import { computeLineDiff, type DiffLine } from '../../../../../diff/diff-utils';
import { ToolResultPopover } from './ToolResultPopover';
import { useBreakpoint } from '../../../../hooks/ui/useBreakpoint';
import { renderMarkdownToHtml } from '../../../../../diff/markdown-renderer';
import { copyToClipboard } from '../../../../utils/format';
import { getApplyPatchText, parseApplyPatchFileChanges } from '../../../../utils/applyPatchParser';
import { useToolCallVariant } from './ToolCallVariant';
import { getToolKindInfo, KIND_PILL_CLASSES, getToolMetric } from './toolKindUtils';
import { getCodexFileChanges, normalizeToolForDisplay, summarizeCodexFileChanges } from './toolNormalization';

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
    if (typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0) return '';
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

function truncateSummary(value: string, maxLength = 80): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function getAskUserQuestionSummary(args: Record<string, any>): string {
    if (typeof args.question === 'string' && args.question.trim()) {
        return truncateSummary(args.question.trim());
    }
    if (Array.isArray(args.questions)) {
        const questions = args.questions
            .filter((question: unknown): question is Record<string, any> => !!question && typeof question === 'object' && !Array.isArray(question))
            .map(question => typeof question.question === 'string' ? question.question.trim() : '')
            .filter(Boolean);
        if (questions.length > 0) {
            const suffix = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
            return `${truncateSummary(questions[0], 80 - suffix.length)}${suffix}`;
        }
    }
    return '';
}

function shortenPath(p: string): string {
    return shortenFilePath(p);
}

function isImageDataUrl(s: string): boolean {
    return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(s.trim());
}

/** Small inline copy button for the Command section header. */
function CopyCommandBtn({ command }: { command: string }) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = React.useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await copyToClipboard(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Command copy failed:', err);
        }
    }, [command]);

    return (
        <button
            className="ml-1.5 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover/cmd:opacity-100 transition-opacity text-[10px]"
            title="Copy command"
            onClick={handleCopy}
            data-testid="command-copy-btn"
            style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0 2px',
                lineHeight: 1,
            }}
        >
            {copied ? '✓' : '📋'}
        </button>
    );
}

function getToolSummary(toolName: string, args: any, rawArgs?: any): string {
    if (toolName === 'apply_patch') {
        const codexSummary = summarizeCodexFileChanges(rawArgs ?? args);
        if (codexSummary) return shortenPath(codexSummary);
        const changes = parseApplyPatchFileChanges(getApplyPatchText(rawArgs ?? args));
        if (changes.length === 1) {
            return shortenPath(changes[0].path);
        }
        return changes.length > 1 ? `${changes.length} files` : '';
    }
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
        case 'bash':
        case 'shell':
        case 'powershell': {
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
        case 'sql': {
            if (typeof args.description === 'string' && args.description.trim()) {
                return args.description.trim();
            }
            if (typeof args.query === 'string' && args.query.trim()) {
                const q = args.query.trim();
                return q.length > 80 ? `${q.slice(0, 77)}...` : q;
            }
            return '';
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
        case 'read_agent': {
            const agentId = args.agent_id ? String(args.agent_id) : '';
            const wait = args.wait ? ' (wait)' : '';
            return agentId ? `Agent ${agentId}${wait}` : '';
        }
        case 'task_complete': {
            if (typeof args.summary === 'string' && args.summary.trim()) {
                const s = args.summary.trim();
                return s.length > 80 ? `${s.slice(0, 77)}...` : s;
            }
            return 'Task completed';
        }
        case 'suggest_follow_ups': {
            if (Array.isArray(args.suggestions)) {
                return args.suggestions.slice(0, 3).join(' · ');
            }
            return '';
        }
        case 'ask_user': {
            return getAskUserQuestionSummary(args) || 'Ask user';
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

function formatStartTime(startTime?: string): string {
    if (!startTime) return '';
    const d = new Date(startTime);
    if (isNaN(d.getTime())) return '';
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let hh = d.getHours();
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm} ${ampm}`;
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
                    📁 <FilePathLink path={filePath} noTruncate />
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
    const mime = filePath ? getImageMimeType(filePath) : null;
    const isImage = filePath ? isImageFile(filePath) : false;

    return (
        <div className="space-y-1.5">
            {filePath && (
                <div className="text-[10px] uppercase text-[#848484] mb-0.5">
                    📁 <FilePathLink path={filePath} noTruncate />
                </div>
            )}
            {fileText && isImage && mime ? (
                <div className="file-preview-image-container rounded border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <img
                        className="file-preview-image"
                        src={`data:${mime};base64,${btoa(unescape(encodeURIComponent(fileText)))}`}
                        alt={shortenPath(filePath)}
                    />
                </div>
            ) : fileText ? (
                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 font-mono text-[#1e1e1e] dark:text-[#cccccc]">
                    <code>{fileText}</code>
                </pre>
            ) : null}
        </div>
    );
}

function ApplyPatchToolView({ patchText }: { patchText: string }) {
    const changes = useMemo(() => parseApplyPatchFileChanges(patchText), [patchText]);
    const diffLines = useMemo<DiffLine[]>(() => patchText.split(/\r?\n/).map((line) => {
        if (line.startsWith('+') && !/^(\+\+\+)\s/.test(line)) {
            return { type: 'added', content: line.slice(1) };
        }
        if (line.startsWith('-') && !/^(---)\s/.test(line)) {
            return { type: 'removed', content: line.slice(1) };
        }
        return {
            type: 'context',
            content: line.startsWith(' ') ? line.slice(1) : line,
        };
    }), [patchText]);

    return (
        <div className="space-y-1.5">
            {changes.length > 0 && (
                <div className="space-y-0.5">
                    <div className="text-[10px] uppercase text-[#848484] mb-0.5">Files</div>
                    {changes.map(change => (
                        <div key={change.path} className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc]">
                            <FilePathLink path={change.path} noTruncate />
                        </div>
                    ))}
                </div>
            )}
            <DiffView diffLines={diffLines} />
        </div>
    );
}

function CodexFileChangeView({ args }: { args: Record<string, any> }) {
    const changes = useMemo(() => getCodexFileChanges(args), [args]);
    if (changes.length === 0) return null;
    return (
        <div className="space-y-0.5">
            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Files</div>
            {changes.map(change => (
                <div key={`${change.kind}:${change.path}`} className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc]">
                    <span className="mr-1 text-[#848484]">{change.kind}</span>
                    <FilePathLink path={change.path} noTruncate />
                </div>
            ))}
        </div>
    );
}

function ViewToolView({ args, result }: { args: Record<string, any>; result: string }) {
    const filePath = args.path || args.filePath || '';
    const viewRange = Array.isArray(args.view_range) ? args.view_range : null;

    const lines = useMemo(() => {
        if (!result) return [];
        return result.split('\n').map((raw) => {
            const m = raw.match(/^(\d+)\.\s(.*)$/);
            return m
                ? { num: parseInt(m[1], 10), content: m[2] }
                : { num: null as number | null, content: raw };
        });
    }, [result]);

    const hasLineNumbers = lines.length > 0 && lines[0].num !== null;

    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    if (isImageDataUrl(result)) {
        return (
            <div className="space-y-1.5">
                {filePath && (
                    <div className="text-[10px] uppercase text-[#848484] mb-0.5">
                        📁 <FilePathLink path={filePath} noTruncate />
                    </div>
                )}
                <img
                    src={result}
                    alt={shortenPath(filePath)}
                    className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="tool-result-image"
                />
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {/* File path + optional range badge + language tag */}
            <div className="flex items-center gap-2 text-[10px] text-[#848484]">
                {filePath && <span className="uppercase">📁 <FilePathLink path={filePath} noTruncate /></span>}
                {viewRange && (
                    <span className="bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] px-1 rounded text-[9px]">
                        L{viewRange[0]}–{viewRange[1] === -1 ? 'EOF' : `L${viewRange[1]}`}
                    </span>
                )}
                {ext && (
                    <span className="ml-auto opacity-60 text-[9px] uppercase">{ext}</span>
                )}
            </div>

            {/* Code block with gutter */}
            <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
                {hasLineNumbers ? (
                    lines.map((line, i) => (
                        <div key={i} className="flex hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                            <span className="select-none text-right pr-2 pl-1 text-[#848484] bg-[#f0f0f0] dark:bg-[#252526] min-w-[3ch] shrink-0">
                                {line.num ?? ''}
                            </span>
                            <span className="px-2 whitespace-pre-wrap break-words overflow-x-auto">{line.content}</span>
                        </div>
                    ))
                ) : (
                    <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words p-2 text-[#1e1e1e] dark:text-[#cccccc]">
                        <code>{result}</code>
                    </pre>
                )}
            </div>
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
    const normalizedToolCall = useMemo(() => normalizeToolForDisplay(toolCall), [toolCall]);
    const toolName = normalizedToolCall.toolName || 'unknown';
    const isTaskComplete = toolName === 'task_complete';
    const [expanded, setExpanded] = useState(isTaskComplete);
    const [hoverVisible, setHoverVisible] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { isMobile } = useBreakpoint();

    if (depth > 20) return null;

    const depthLevel = Math.max(0, Math.min(depth, 8));
    const name = toolName;
    const argsObj = parseArgsObject(normalizedToolCall.args);
    const args = formatArgs(normalizedToolCall.args);
    const applyPatchText = name === 'apply_patch' ? getApplyPatchText(normalizedToolCall.args) : '';
    const codexFileChanges = name === 'apply_patch' ? getCodexFileChanges(normalizedToolCall.args) : [];
    const hasDetails = args || normalizedToolCall.result || normalizedToolCall.error;
    const summary = getToolSummary(name, argsObj, normalizedToolCall.args);
    const summaryIsPath = !!summary && ['view', 'edit', 'create', 'glob', 'grep'].includes(name)
        && argsObj && (argsObj.path || argsObj.filePath);
    const duration = formatDuration(normalizedToolCall.startTime, normalizedToolCall.endTime);
    const startTimeLabel = formatStartTime(normalizedToolCall.startTime);
    const resultText = typeof normalizedToolCall.result === 'string' ? normalizedToolCall.result : '';
    const isResultTruncated = resultText.length > MAX_RESULT_LENGTH;
    const visibleResult = isResultTruncated ? `${resultText.slice(0, TRUNCATED_RESULT_LENGTH)}\n... (output truncated)` : resultText;
    const popoverResultText = name === 'apply_patch' && applyPatchText ? applyPatchText : resultText;

    const isShellLike = name === 'bash' || name === 'shell' || name === 'powershell';
    const isSql = name === 'sql';

    const variant = useToolCallVariant();
    const isWhisperRow = variant === 'whisper-row';
    const kindInfo = useMemo(() => getToolKindInfo(name), [name]);
    const kindPillClass = KIND_PILL_CLASSES[kindInfo.cls];
    const metric = useMemo(
        () => (isWhisperRow ? getToolMetric(name, argsObj, resultText, normalizedToolCall.error) : null),
        [isWhisperRow, name, argsObj, resultText, normalizedToolCall.error],
    );
    const rowSummary = summary || (normalizedToolCall.error ? 'error' : '');
    const isRunning = normalizedToolCall.status === 'running';

    const bashDescription = isShellLike && argsObj && typeof argsObj === 'object' && argsObj.description
        ? String(argsObj.description)
        : '';
    const bashCommand = isShellLike && argsObj && typeof argsObj === 'object' && argsObj.command
        ? String(argsObj.command)
        : '';
    const bashOptions = isShellLike && argsObj && typeof argsObj === 'object'
        ? Object.fromEntries(
            Object.entries(argsObj).filter(([key]) => key !== 'description' && key !== 'command')
        )
        : null;
    const bashOptionsText = bashOptions && Object.keys(bashOptions).length > 0 ? JSON.stringify(bashOptions, null, 2) : '';

    const sqlDescription = isSql && argsObj && typeof argsObj === 'object' && argsObj.description
        ? String(argsObj.description)
        : '';
    const sqlQuery = isSql && argsObj && typeof argsObj === 'object' && argsObj.query
        ? String(argsObj.query)
        : '';
    const sqlOptions = isSql && argsObj && typeof argsObj === 'object'
        ? Object.fromEntries(
            Object.entries(argsObj).filter(([key]) => key !== 'description' && key !== 'query')
        )
        : null;
    const sqlOptionsText = sqlOptions && Object.keys(sqlOptions).length > 0 ? JSON.stringify(sqlOptions, null, 2) : '';

    const taskCompleteSummary = isTaskComplete
        ? (resultText || (argsObj && typeof argsObj.summary === 'string' ? argsObj.summary : ''))
        : '';
    const taskCompleteHtml = useMemo(() => {
        if (!isTaskComplete || !taskCompleteSummary) return '';
        return renderMarkdownToHtml(taskCompleteSummary);
    }, [isTaskComplete, taskCompleteSummary]);

    const hasHoverResult = (name === 'task' || name === 'read_agent' || name === 'view' || isShellLike || isSql || name === 'glob' || name === 'grep' || name === 'create' || name === 'edit' || name === 'apply_patch') && !!popoverResultText;

    const clearTimers = useCallback(() => {
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    }, []);

    const handleHeaderMouseEnter = useCallback(() => {
        if (!hasHoverResult) return;
        clearTimers();
        hoverTimerRef.current = setTimeout(() => {
            if (headerRef.current) {
                setAnchorRect(headerRef.current.getBoundingClientRect());
                setHoverVisible(true);
            }
        }, 300);
    }, [hasHoverResult, clearTimers]);

    const handleHeaderMouseLeave = useCallback(() => {
        if (!hasHoverResult) return;
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        graceTimerRef.current = setTimeout(() => setHoverVisible(false), 100);
    }, [hasHoverResult]);

    const handlePopoverMouseEnter = useCallback(() => {
        if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    }, []);

    const handlePopoverMouseLeave = useCallback(() => {
        setHoverVisible(false);
    }, []);

    const handleMobilePreviewTap = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!hasHoverResult) return;
        if (headerRef.current) {
            setAnchorRect(headerRef.current.getBoundingClientRect());
            setHoverVisible(true);
        }
    }, [hasHoverResult]);

    if (isWhisperRow) {
        return (
            <div
                className={cn(
                    'tool-call-row tool-call-row--whisper group/row',
                    'border-b border-[#ececec] dark:border-[#3c3c3c] last:border-b-0',
                    'bg-white dark:bg-[#252525]',
                    'hover:bg-[#fafafa] dark:hover:bg-[#2a2a2a]',
                    'select-text',
                )}
                data-tool-id={normalizedToolCall.id || normalizedToolCall.toolName || 'unknown'}
                data-tool-variant="whisper-row"
                data-tool-kind={kindInfo.cls}
                style={depthLevel > 0 ? { marginLeft: `${depthLevel * (isMobile ? 8 : 12)}px` } : undefined}
            >
                <div
                    ref={headerRef}
                    className={cn(
                        'tool-call-row-header flex items-center gap-2.5 px-3 py-1 font-mono text-[12px]',
                        'text-[#2c2f33] dark:text-[#cccccc]',
                        hasDetails && 'cursor-pointer',
                        isRunning && 'tool-call-row--running',
                    )}
                    onClick={(e) => {
                        if ((e.target as HTMLElement).closest?.('.file-path-link')) return;
                        if (hasDetails) setExpanded(!expanded);
                    }}
                    onMouseEnter={!isMobile ? handleHeaderMouseEnter : undefined}
                    onMouseLeave={!isMobile ? handleHeaderMouseLeave : undefined}
                    role={hasDetails ? 'button' : undefined}
                    aria-expanded={hasDetails ? expanded : undefined}
                >
                    <span
                        className={cn(
                            'tool-call-kind shrink-0 inline-block min-w-[42px] text-center px-2 py-px rounded-sm font-mono text-[11px] font-medium',
                            isRunning
                                ? 'bg-[#f5f5f4] text-[#6b7280] dark:bg-[#3c3c3c] dark:text-[#9aa0a6]'
                                : kindPillClass,
                        )}
                        data-testid="tool-call-kind"
                    >
                        {kindInfo.label}
                    </span>
                    {hasSubtools && (
                        <button
                            type="button"
                            className="text-[#9aa0a6] hover:text-[#1f2328] dark:hover:text-[#cccccc] shrink-0 text-[10px]"
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
                    <span
                        className={cn(
                            'tool-call-row-path flex-1 min-w-0 truncate text-[#2c2f33] dark:text-[#cccccc]',
                            summaryIsPath && 'file-path-link',
                        )}
                        title={rowSummary}
                        {...(summaryIsPath ? { 'data-full-path': argsObj?.path || argsObj?.filePath, 'data-no-preview-hover': '' } : {})}
                    >
                        {rowSummary || <span className="text-[#9aa0a6] italic">{name}</span>}
                    </span>
                    {metric && (
                        <span
                            className="tool-call-row-metric shrink-0 font-mono text-[11.5px] text-[#6b7280] dark:text-[#9aa0a6]"
                            data-testid="tool-call-metric"
                        >
                            {metric.kind === 'diff' ? (
                                <>
                                    {(metric.insertions ?? 0) > 0 && (
                                        <span className="text-[#1a7f37] dark:text-[#85e89d] font-medium">+{metric.insertions}</span>
                                    )}
                                    {(metric.insertions ?? 0) > 0 && (metric.deletions ?? 0) > 0 && ' '}
                                    {(metric.deletions ?? 0) > 0 && (
                                        <span className="text-[#cf222e] dark:text-[#f97583] font-medium">−{metric.deletions}</span>
                                    )}
                                </>
                            ) : (
                                metric.text
                            )}
                        </span>
                    )}
                    {duration && (
                        <span className="tool-call-row-duration shrink-0 font-mono text-[11px] text-[#9aa0a6] dark:text-[#6b7280]">
                            {duration}
                        </span>
                    )}
                    {isMobile && hasHoverResult && (
                        <button
                            type="button"
                            className="text-[#9aa0a6] hover:text-[#0969da] dark:hover:text-[#79c0ff] shrink-0 text-[11px]"
                            aria-label="Preview result"
                            title="Preview result"
                            data-testid="mobile-preview-btn"
                            onClick={handleMobilePreviewTap}
                        >
                            👁
                        </button>
                    )}
                    {hasDetails && (
                        <span className="text-[#9aa0a6] shrink-0 text-[10px]">{expanded ? '▼' : '▶'}</span>
                    )}
                </div>
                {hasDetails && expanded && (
                    <div className="tool-call-row-body border-t border-[#ececec] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1e1e1e] px-3 py-1.5 space-y-1.5 text-xs select-text">
                        {isShellLike && bashDescription && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Description</div>
                                <div className="text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    {bashDescription}
                                </div>
                            </div>
                        )}
                        {isShellLike && bashCommand && (
                            <div>
                                <div className="relative group/cmd flex items-center">
                                    <div className="text-[10px] uppercase text-[#848484] mb-0.5">Command</div>
                                    <CopyCommandBtn command={bashCommand} />
                                </div>
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <code>{`$ ${bashCommand}`}</code>
                                </pre>
                            </div>
                        )}
                        {isShellLike && bashOptionsText && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Options</div>
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <code>{bashOptionsText}</code>
                                </pre>
                            </div>
                        )}
                        {isSql && sqlDescription && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Description</div>
                                <div className="text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    {sqlDescription}
                                </div>
                            </div>
                        )}
                        {isSql && sqlQuery && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Query</div>
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <code>{sqlQuery}</code>
                                </pre>
                            </div>
                        )}
                        {isSql && sqlOptionsText && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Options</div>
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <code>{sqlOptionsText}</code>
                                </pre>
                            </div>
                        )}
                        {name === 'edit' && argsObj && <EditToolView args={argsObj} />}
                        {name === 'create' && argsObj && <CreateToolView args={argsObj} />}
                        {name === 'view' && argsObj && <ViewToolView args={argsObj} result={visibleResult} />}
                        {name === 'apply_patch' && applyPatchText && <ApplyPatchToolView patchText={applyPatchText} />}
                        {name === 'apply_patch' && !applyPatchText && codexFileChanges.length > 0 && argsObj && <CodexFileChangeView args={argsObj} />}
                        {!isShellLike && !isSql && name !== 'edit' && name !== 'create' && name !== 'view' && !(name === 'apply_patch' && (applyPatchText || codexFileChanges.length > 0)) && !isTaskComplete && args && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Arguments</div>
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <code>{args}</code>
                                </pre>
                            </div>
                        )}
                        {isTaskComplete && taskCompleteHtml && (
                            <div
                                className="markdown-body text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                                data-testid="task-complete-markdown"
                                dangerouslySetInnerHTML={{ __html: taskCompleteHtml }}
                            />
                        )}
                        {name !== 'view' && !isTaskComplete && resultText && (
                            <div>
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Result</div>
                                {isImageDataUrl(resultText) ? (
                                    <img
                                        src={resultText}
                                        alt="Tool result image"
                                        className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] cursor-pointer"
                                        data-testid="tool-result-image"
                                    />
                                ) : (
                                    <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                        <code>{visibleResult}</code>
                                    </pre>
                                )}
                            </div>
                        )}
                        {normalizedToolCall.error && (
                            <div>
                                <div className="text-[10px] uppercase text-[#cf222e] mb-0.5">Error</div>
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#cf222e]">
                                    <code>{normalizedToolCall.error}</code>
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
                {hoverVisible && anchorRect && hasHoverResult && (
                    <ToolResultPopover
                        result={popoverResultText}
                        toolName={name}
                        args={argsObj ?? undefined}
                        anchorRect={anchorRect}
                        onMouseEnter={handlePopoverMouseEnter}
                        onMouseLeave={handlePopoverMouseLeave}
                    />
                )}
            </div>
        );
    }

    return (
        <div
            className={cn(
                'tool-call-card my-0.5 md:my-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs',
                depthLevel > 0 && 'border-l-2'
            )}
            data-tool-id={normalizedToolCall.id || normalizedToolCall.toolName || 'unknown'}
            style={depthLevel > 0 ? { marginLeft: `${depthLevel * (isMobile ? 8 : 12)}px` } : undefined}
        >
            <div
                ref={headerRef}
                className={cn(
                    'tool-call-header flex items-center gap-1.5 px-2 py-1 md:gap-2 md:px-2.5 md:py-1.5 cursor-pointer select-none',
                    hasDetails && 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                )}
                onClick={(e) => {
                    if ((e.target as HTMLElement).closest?.('.file-path-link')) return;
                    hasDetails && setExpanded(!expanded);
                }}
                onMouseEnter={!isMobile ? handleHeaderMouseEnter : undefined}
                onMouseLeave={!isMobile ? handleHeaderMouseLeave : undefined}
            >
                <span>{statusIndicator(normalizedToolCall.status)}</span>
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
                    <span
                        className={cn('text-[#848484] min-w-0', isMobile ? 'truncate max-w-[40vw]' : 'break-all', summaryIsPath && 'file-path-link')}
                        title={summary}
                        {...(summaryIsPath ? { 'data-full-path': argsObj.path || argsObj.filePath, 'data-no-preview-hover': '' } : {})}
                    >
                        {summary}
                    </span>
                )}
                {!isMobile && startTimeLabel && (
                    <span className="text-[#848484] ml-auto shrink-0">{startTimeLabel}</span>
                )}
                {duration && (
                    <span className={cn('text-[#848484] shrink-0', (!startTimeLabel || isMobile) && 'ml-auto')}>{duration}</span>
                )}
                {isMobile && hasHoverResult && (
                    <button
                        type="button"
                        className={cn('text-[#848484] hover:text-[#0078d4] dark:hover:text-[#3794ff] shrink-0',
                            !duration && 'ml-auto')}
                        aria-label="Preview result"
                        title="Preview result"
                        data-testid="mobile-preview-btn"
                        onClick={handleMobilePreviewTap}
                    >
                        👁
                    </button>
                )}
                {hasDetails && (
                    <span className={cn('text-[#848484]', !duration && !startTimeLabel && !isMobile && 'ml-auto')}>{expanded ? '▼' : '▶'}</span>
                )}
            </div>
            {hasDetails && (
                <div className={cn(
                    'tool-call-body border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-2 py-1.5 space-y-1.5 md:px-2.5 md:py-2 md:space-y-2 select-text',
                    !expanded && 'collapsed',
                    !expanded && 'hidden'
                )}>
                    {isShellLike && bashDescription && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Description</div>
                            <div className="text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                {bashDescription}
                            </div>
                        </div>
                    )}
                    {isShellLike && bashCommand && (
                        <div>
                            <div className="relative group/cmd flex items-center">
                                <div className="text-[10px] uppercase text-[#848484] mb-0.5">Command</div>
                                <CopyCommandBtn command={bashCommand} />
                            </div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{`$ ${bashCommand}`}</code>
                            </pre>
                        </div>
                    )}
                    {isShellLike && bashOptionsText && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Options</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{bashOptionsText}</code>
                            </pre>
                        </div>
                    )}
                    {isSql && sqlDescription && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Description</div>
                            <div className="text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                {sqlDescription}
                            </div>
                        </div>
                    )}
                    {isSql && sqlQuery && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Query</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{sqlQuery}</code>
                            </pre>
                        </div>
                    )}
                    {isSql && sqlOptionsText && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Options</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{sqlOptionsText}</code>
                            </pre>
                        </div>
                    )}
                    {name === 'edit' && argsObj && (
                        <EditToolView args={argsObj} />
                    )}
                    {name === 'create' && argsObj && (
                        <CreateToolView args={argsObj} />
                    )}
                    {name === 'view' && argsObj && (
                        <ViewToolView args={argsObj} result={visibleResult} />
                    )}
                    {name === 'apply_patch' && applyPatchText && (
                        <ApplyPatchToolView patchText={applyPatchText} />
                    )}
                    {name === 'apply_patch' && !applyPatchText && codexFileChanges.length > 0 && argsObj && (
                        <CodexFileChangeView args={argsObj} />
                    )}
                    {!isShellLike && !isSql && name !== 'edit' && name !== 'create' && name !== 'view' && !(name === 'apply_patch' && (applyPatchText || codexFileChanges.length > 0)) && !isTaskComplete && args && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Arguments</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{args}</code>
                            </pre>
                        </div>
                    )}
                    {isTaskComplete && taskCompleteHtml && (
                        <div
                            className="markdown-body text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid="task-complete-markdown"
                            dangerouslySetInnerHTML={{ __html: taskCompleteHtml }}
                        />
                    )}
                    {name !== 'view' && !isTaskComplete && resultText && (
                        <div>
                            <div className="text-[10px] uppercase text-[#848484] mb-0.5">Result</div>
                            {isImageDataUrl(resultText) ? (
                                <img
                                    src={resultText}
                                    alt="Tool result image"
                                    className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] cursor-pointer"
                                    data-testid="tool-result-image"
                                />
                            ) : (
                                <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                    <code>{visibleResult}</code>
                                </pre>
                            )}
                        </div>
                    )}
                    {normalizedToolCall.error && (
                        <div>
                            <div className="text-[10px] uppercase text-[#f14c4c] mb-0.5">Error</div>
                            <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#f14c4c]">
                                <code>{normalizedToolCall.error}</code>
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
            {hoverVisible && anchorRect && hasHoverResult && (
                <ToolResultPopover
                    result={popoverResultText}
                    toolName={name}
                    args={argsObj ?? undefined}
                    anchorRect={anchorRect}
                    onMouseEnter={handlePopoverMouseEnter}
                    onMouseLeave={handlePopoverMouseLeave}
                />
            )}
        </div>
    );
}
