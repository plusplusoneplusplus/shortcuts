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

const MAX_PREVIEW_LENGTH = 2000;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

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
    const filePath = isView ? (args?.path || args?.filePath || '') : '';
    const isMd = isView && isMarkdownPath(filePath);

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
                {isView ? 'File Preview' : 'Result Preview'}
            </div>
            {renderBody()}
        </div>,
        document.body
    );
}
