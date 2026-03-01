/**
 * ToolResultPopover — hover popover that shows a preview of a tool call's result.
 * Rendered via React Portal to avoid clipping by parent overflow.
 *
 * For `view` tool calls:
 *   - Markdown files (.md/.markdown/.mdx) render formatted markdown via renderMarkdownToHtml
 *   - Other files render a code preview with line-number gutter
 * For all other tools: raw pre/code text (existing behavior).
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { renderMarkdownToHtml } from '../../markdown-renderer';
import { computeLineDiff, type DiffLine } from '../../diff-utils';

const MAX_PREVIEW_LENGTH = 2000;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(s: string): string {
    return s.replace(ANSI_REGEX, '');
}

function isImageDataUrl(s: string): boolean {
    return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(s.trim());
}

function shortenPath(p: string): string {
    if (!p) return '';
    return p
        .replace(/^\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^\/Users\/[^/]+\//, '~/')
        .replace(/^\/home\/[^/]+\//, '~/');
}

function isMarkdownPath(filePath: string | undefined): boolean {
    if (!filePath) return false;
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

function parseViewLines(result: string): { num: number | null; content: string }[] {
    return result.split('\n').map((raw) => {
        const m = raw.match(/^(\d+)\.\s(.*)$/);
        return m
            ? { num: parseInt(m[1], 10), content: m[2] }
            : { num: null, content: raw };
    });
}

const MAX_PREVIEW_ROWS = 100;

function parseGlobLines(result: string, basePath?: string): string[] {
    const lines = result.split('\n').filter(l => l.trim());
    return lines.slice(0, MAX_PREVIEW_ROWS).map(line => {
        if (basePath) {
            const normalized = line.replace(/\\/g, '/');
            const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/$/, '') + '/';
            if (normalized.startsWith(normalizedBase)) {
                return normalized.slice(normalizedBase.length);
            }
        }
        return line;
    });
}

interface GrepMatch { file: string; line: string; content: string }

function parseGrepLines(result: string): Map<string, Array<{ line: string; content: string }>> {
    const lines = result.split('\n').filter(l => l.trim());
    const grouped = new Map<string, Array<{ line: string; content: string }>>();
    let count = 0;
    for (const raw of lines) {
        if (count >= MAX_PREVIEW_ROWS) break;
        // Handle Windows paths (C:\foo\bar.ts:12:content) — find first :digit sequence after path
        const m = raw.match(/^(.+?):(\d+):(.*)$/);
        if (m) {
            const [, file, line, content] = m;
            if (!grouped.has(file)) grouped.set(file, []);
            grouped.get(file)!.push({ line, content });
            count++;
        } else {
            // files_with_matches mode: just a file path per line
            if (!grouped.has(raw)) grouped.set(raw, []);
        }
    }
    return grouped;
}

function highlightPattern(text: string, pattern?: string): React.ReactNode {
    if (!pattern) return text;
    try {
        const regex = new RegExp(`(${pattern})`, 'gi');
        const parts = text.split(regex);
        if (parts.length <= 1) return text;
        return parts.map((part, i) =>
            regex.test(part)
                ? <span key={i} className="bg-[#fff3cd] dark:bg-[#6b5900] rounded-sm px-0.5">{part}</span>
                : part
        );
    } catch {
        return text;
    }
}

function stripLineNumbers(result: string): string {
    return result.split('\n').map((raw) => {
        const m = raw.match(/^(\d+)\.\s(.*)$/);
        return m ? m[2] : raw;
    }).join('\n');
}

interface ToolResultPopoverProps {
    result: string;
    toolName?: string;
    args?: Record<string, any>;
    anchorRect: DOMRect;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

export function ToolResultPopover({ result, toolName, args, anchorRect, onMouseEnter, onMouseLeave }: ToolResultPopoverProps) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    const truncated = result.length > MAX_PREVIEW_LENGTH;
    const visibleText = truncated ? result.slice(0, MAX_PREVIEW_LENGTH) + '\n… (truncated — click to see full)' : result;

    const isView = toolName === 'view';
    const isBash = toolName === 'bash' || toolName === 'shell' || toolName === 'powershell';
    const isGlob = toolName === 'glob';
    const isGrep = toolName === 'grep';
    const isCreate = toolName === 'create';
    const isEdit = toolName === 'edit';
    const filePath = isView ? (args?.path || args?.filePath || '') : '';
    const editFilePath = isEdit ? (args?.path || args?.filePath || '') : '';
    const editOldStr = isEdit && typeof args?.old_str === 'string' ? args.old_str : (isEdit && typeof args?.old_string === 'string' ? args.old_string : '');
    const editNewStr = isEdit && typeof args?.new_str === 'string' ? args.new_str : (isEdit && typeof args?.new_string === 'string' ? args.new_string : '');
    const createFilePath = isCreate ? (args?.path || args?.filePath || '') : '';
    const createFileText = isCreate && typeof args?.file_text === 'string' ? args.file_text : '';
    const isMd = isView && isMarkdownPath(filePath);
    const bashCommand = isBash && args?.command ? String(args.command) : '';

    const markdownHtml = useMemo(() => {
        if (!isMd) return '';
        const raw = stripLineNumbers(visibleText);
        return renderMarkdownToHtml(raw, { stripFrontmatter: true });
    }, [isMd, visibleText]);

    const codeLines = useMemo(() => {
        if (!isView || isMd) return [];
        return parseViewLines(visibleText);
    }, [isView, isMd, visibleText]);

    const hasLineNumbers = codeLines.length > 0 && codeLines[0].num !== null;

    const globPaths = useMemo(() => {
        if (!isGlob) return [];
        return parseGlobLines(result, args?.path);
    }, [isGlob, result, args?.path]);

    const grepGroups = useMemo(() => {
        if (!isGrep) return new Map<string, Array<{ line: string; content: string }>>();
        return parseGrepLines(result);
    }, [isGrep, result]);

    const grepTotalMatches = useMemo(() => {
        let count = 0;
        grepGroups.forEach(matches => { count += Math.max(matches.length, 1); });
        return count;
    }, [grepGroups]);

    const editDiffLines = useMemo(() => {
        if (!isEdit) return null;
        return computeLineDiff(editOldStr, editNewStr);
    }, [isEdit, editOldStr, editNewStr]);

    // hljs highlighting for markdown code blocks
    useEffect(() => {
        if (!isMd || !contentRef.current) return;
        const hljs = (window as any).hljs;
        if (hljs) {
            contentRef.current.querySelectorAll('pre code').forEach((block: Element) => {
                hljs.highlightElement(block);
            });
        }
    }, [isMd, markdownHtml]);

    useEffect(() => {
        if (!popoverRef.current) return;
        const popRect = popoverRef.current.getBoundingClientRect();
        const gap = 4;

        let top = anchorRect.bottom + gap;
        let left = anchorRect.left;

        // Flip above if it would overflow the bottom
        if (top + popRect.height > window.innerHeight - 8) {
            top = anchorRect.top - popRect.height - gap;
        }
        if (top < 8) top = 8;

        // Clamp horizontal
        if (left + popRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popRect.width - 8;
        }
        if (left < 8) left = 8;

        setPos({ top, left });
    }, [anchorRect]);

    const isImage = isImageDataUrl(result);

    const renderBody = () => {
        if (isImage) {
            return (
                <img
                    src={result}
                    alt={filePath ? shortenPath(filePath) : 'Image preview'}
                    className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="popover-image"
                />
            );
        }

        if (isMd) {
            return (
                <div
                    ref={contentRef}
                    data-testid="popover-markdown"
                    className="markdown-body text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                    dangerouslySetInnerHTML={{ __html: markdownHtml }}
                />
            );
        }

        if (isView && hasLineNumbers) {
            return (
                <div data-testid="popover-code" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
                    {codeLines.map((line, i) => (
                        <div key={i} className="flex hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                            <span className="select-none text-right pr-2 pl-1 text-[#848484] bg-[#f0f0f0] dark:bg-[#252526] min-w-[3ch] shrink-0">
                                {line.num ?? ''}
                            </span>
                            <span className="px-2 whitespace-pre-wrap break-words overflow-x-auto">{line.content}</span>
                        </div>
                    ))}
                    {truncated && (
                        <div className="text-[10px] text-[#848484] px-2 py-1">… (truncated — click to see full)</div>
                    )}
                </div>
            );
        }

        if (isBash) {
            const cleaned = stripAnsi(visibleText);
            return (
                <div data-testid="popover-terminal" className="rounded border border-[#2d2d2d] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55] bg-[#1e1e1e] text-[#cccccc] p-2">
                    {bashCommand && (
                        <div className="text-[#4ec9b0] mb-1 select-none">$ {bashCommand}</div>
                    )}
                    <pre className="whitespace-pre-wrap break-words m-0">
                        <code>{cleaned}</code>
                    </pre>
                    {truncated && (
                        <div className="text-[10px] text-[#848484] mt-1">… (truncated — click to see full)</div>
                    )}
                </div>
            );
        }

        if (isGlob) {
            if (globPaths.length === 0) {
                return (
                    <div data-testid="popover-glob" className="text-[11px] text-[#848484] italic">No matches found</div>
                );
            }
            return (
                <div data-testid="popover-glob" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
                    {globPaths.map((p, i) => (
                        <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                            <span className="shrink-0">📄</span>
                            <span className="whitespace-pre-wrap break-words overflow-x-auto">{p}</span>
                        </div>
                    ))}
                </div>
            );
        }

        if (isGrep) {
            if (grepGroups.size === 0) {
                return (
                    <div data-testid="popover-grep" className="text-[11px] text-[#848484] italic">No matches found</div>
                );
            }
            const grepPattern = args?.pattern;
            return (
                <div data-testid="popover-grep" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
                    {Array.from(grepGroups.entries()).map(([file, matches], gi) => (
                        <div key={gi}>
                            <div className="bg-[#f0f0f0] dark:bg-[#252526] px-2 py-0.5 font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex items-center gap-1.5">
                                <span className="shrink-0">📄</span>
                                {file}
                            </div>
                            {matches.map((m, mi) => (
                                <div key={mi} className="flex hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                                    <span className="select-none text-right pr-2 pl-1 text-[#848484] bg-[#f0f0f0] dark:bg-[#252526] min-w-[3ch] shrink-0">
                                        {m.line}
                                    </span>
                                    <span className="px-2 whitespace-pre-wrap break-words overflow-x-auto">
                                        {highlightPattern(m.content, grepPattern)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            );
        }

        if (isEdit) {
            if (!editOldStr && !editNewStr) {
                return (
                    <div data-testid="popover-edit" className="text-[11px] text-[#848484] italic">No preview available</div>
                );
            }
            return (
                <div data-testid="popover-edit" className="space-y-1.5">
                    {editFilePath && (
                        <div className="flex items-center gap-1.5 text-[10px] text-[#848484]">
                            <span className="shrink-0">📄</span>
                            <span className="uppercase">{shortenPath(editFilePath)}</span>
                        </div>
                    )}
                    {editDiffLines ? (
                        <div className="diff-container rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
                            {editDiffLines.map((line, i) => (
                                <div
                                    key={i}
                                    className={
                                        'diff-line px-2 whitespace-pre-wrap break-words' +
                                        (line.type === 'added' ? ' diff-line-added' : '') +
                                        (line.type === 'removed' ? ' diff-line-removed' : '') +
                                        (line.type === 'context' ? ' diff-line-context' : '')
                                    }
                                >
                                    <span className="diff-line-prefix inline-block w-3 select-none text-right mr-1 opacity-70">
                                        {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                                    </span>
                                    {line.content}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55] p-2">
                            {editOldStr && (
                                <div>
                                    <div className="text-[10px] uppercase text-[#848484] mb-0.5">Old</div>
                                    <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc] m-0"><code>{editOldStr}</code></pre>
                                </div>
                            )}
                            {editNewStr && (
                                <div>
                                    <div className="text-[10px] uppercase text-[#848484] mb-0.5">New</div>
                                    <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc] m-0"><code>{editNewStr}</code></pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        if (isCreate) {
            if (!createFileText) {
                return (
                    <div data-testid="popover-create" className="text-[11px] text-[#848484] italic">No preview available</div>
                );
            }
            return (
                <div data-testid="popover-create" className="space-y-1.5">
                    {createFilePath && (
                        <div className="flex items-center gap-1.5 text-[10px] text-[#848484]">
                            <span className="shrink-0">📄</span>
                            <span className="uppercase">{shortenPath(createFilePath)}</span>
                        </div>
                    )}
                    <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55] max-h-[400px] overflow-y-auto">
                        <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words p-2 m-0 text-[#1e1e1e] dark:text-[#cccccc]">
                            <code>{createFileText.length > MAX_PREVIEW_LENGTH ? createFileText.slice(0, MAX_PREVIEW_LENGTH) + '\n… (truncated — click to see full)' : createFileText}</code>
                        </pre>
                    </div>
                </div>
            );
        }

        // Default: raw text (task tool and fallback)
        return (
            <pre className="text-[11px] whitespace-pre-wrap break-words font-mono text-[#1e1e1e] dark:text-[#cccccc]">
                <code>{visibleText}</code>
            </pre>
        );
    };

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            data-testid="tool-result-popover"
            className="fixed z-50 w-[600px] max-w-[calc(100vw-16px)] max-h-[300px] overflow-y-auto rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-3 shadow-lg"
            style={pos ? { top: pos.top, left: pos.left } : { top: anchorRect.bottom + 4, left: anchorRect.left, visibility: 'hidden' }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="text-[10px] uppercase text-[#848484] mb-1">
                {isView ? 'File Preview' : isBash ? 'Shell Output' : isGlob ? `Glob Matches · ${globPaths.length} files` : isGrep ? `Grep Matches · ${grepTotalMatches} matches in ${grepGroups.size} files` : isCreate ? 'Created File' : isEdit ? 'Edit Preview' : 'Result Preview'}
            </div>
            {renderBody()}
        </div>,
        document.body
    );
}
