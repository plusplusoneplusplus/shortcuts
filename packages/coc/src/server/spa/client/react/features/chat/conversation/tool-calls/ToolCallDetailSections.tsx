/**
 * ToolCallDetailSections — the expandable detail body shared by both the
 * whisper-row and default-card ToolCallView variants. Given a computed
 * ToolCallRenderModel it renders shell/sql sections, edit/create/view/patch
 * previews, generic args, task_complete markdown, result, and error — the same
 * facts in the same order for every variant. Only the error color differs, so
 * variants pass an `errorClassName`.
 */

import React, { useMemo } from 'react';
import { cn, FilePathLink } from '../../../../ui';
import { isImageFile, getImageMimeType } from '../../../../shared/file-path-utils';
import { computeLineDiff, type DiffLine } from '../../../../../diff/diff-utils';
import { renderMarkdownToHtml } from '../../../../../diff/markdown-renderer';
import { copyToClipboard } from '../../../../utils/format';
import { parseApplyPatchFileChanges } from '../../../../utils/applyPatchParser';
import { getCodexFileChanges } from './toolNormalization';
import { shortenPath, isImageDataUrl, type ToolCallRenderModel } from './toolCallRenderModel';

/** Small inline copy button for the Command section header. */
export function CopyCommandBtn({ command }: { command: string }) {
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

export interface ToolCallDetailSectionsProps {
    model: ToolCallRenderModel;
    /** Tailwind color class for the Error label + body (variant-specific). */
    errorClassName: string;
}

/**
 * Renders the shared, variant-independent detail body for a tool call. Order
 * and gating exactly mirror the historical inline JSX so both variants show the
 * same facts.
 */
export function ToolCallDetailSections({ model, errorClassName }: ToolCallDetailSectionsProps) {
    const {
        name,
        argsObj,
        argsText,
        isShellLike,
        isSql,
        isTaskComplete,
        bashDescription,
        bashCommand,
        bashOptionsText,
        sqlDescription,
        sqlQuery,
        sqlOptionsText,
        applyPatchText,
        codexFileChanges,
        visibleResult,
        resultText,
        taskCompleteSummary,
        error,
    } = model;

    const taskCompleteHtml = useMemo(() => {
        if (!isTaskComplete || !taskCompleteSummary) return '';
        return renderMarkdownToHtml(taskCompleteSummary);
    }, [isTaskComplete, taskCompleteSummary]);

    const showGenericArgs = !isShellLike && !isSql
        && name !== 'edit' && name !== 'create' && name !== 'view'
        && !(name === 'apply_patch' && (applyPatchText || codexFileChanges.length > 0))
        && !isTaskComplete && !!argsText;

    return (
        <>
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
            {showGenericArgs && (
                <div>
                    <div className="text-[10px] uppercase text-[#848484] mb-0.5">Arguments</div>
                    <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                        <code>{argsText}</code>
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
            {error && (
                <div>
                    <div className={cn('text-[10px] uppercase mb-0.5', errorClassName)}>Error</div>
                    <pre className={cn('overflow-x-auto text-[11px] whitespace-pre-wrap break-words', errorClassName)}>
                        <code>{error}</code>
                    </pre>
                </div>
            )}
        </>
    );
}
