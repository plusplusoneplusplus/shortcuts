/**
 * BranchAllFilesDiff — aggregated diff of all files in the branch range.
 *
 * Shown in the lower panel of BranchRangeOverview. Each file row is collapsible;
 * expanding it lazy-fetches the file diff. All files start collapsed.
 * Clicking a file row's "Open →" link navigates to the full FileDiffPanel view.
 * Diff is truncated at 200 lines with a "Show full diff →" link.
 */

import { useState, useEffect, useRef } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import { Spinner, TruncatedPath } from '../../../ui';
import { UnifiedDiffViewer } from '../diff/UnifiedDiffViewer';
import { STATUS_COLORS, STATUS_LABELS, normalizeStatus } from '../diff/FileTree';

export interface BranchRangeFile {
    path: string;
    status: string;
    additions: number;
    deletions: number;
    oldPath?: string;
}

interface BranchAllFilesDiffProps {
    workspaceId: string;
    files: BranchRangeFile[];
    onFileSelect: (filePath: string) => void;
    /** When set, scrolls the given file row into view. */
    scrollToFilePath?: string | null;
}

type FileState = {
    expanded: boolean;
    diff: string | null;
    loading: boolean;
    error: string | null;
};

const DIFF_LINE_LIMIT = 200;

export function BranchAllFilesDiff({ workspaceId, files, onFileSelect, scrollToFilePath }: BranchAllFilesDiffProps) {
    const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
    const containerRef = useRef<HTMLDivElement>(null);

    // Scroll to file when requested
    useEffect(() => {
        if (!scrollToFilePath || !containerRef.current) return;
        const timer = setTimeout(() => {
            const els = containerRef.current?.querySelectorAll<HTMLElement>('[data-file-path]') ?? [];
            for (const el of Array.from(els)) {
                if (el.getAttribute('data-file-path') === scrollToFilePath) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    break;
                }
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [scrollToFilePath]);

    const toggleFile = (filePath: string) => {
        const current = fileStates[filePath] ?? { expanded: false, diff: null, loading: false, error: null };

        if (current.expanded) {
            setFileStates(prev => ({ ...prev, [filePath]: { ...current, expanded: false } }));
            return;
        }

        // Expand; fetch diff if not yet loaded
        if (current.diff !== null || current.loading) {
            setFileStates(prev => ({ ...prev, [filePath]: { ...current, expanded: true } }));
            return;
        }

        setFileStates(prev => ({
            ...prev,
            [filePath]: { expanded: true, diff: null, loading: true, error: null },
        }));

        fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/files/${encodeURIComponent(filePath)}/diff`
        )
            .then(data => {
                setFileStates(prev => ({
                    ...prev,
                    [filePath]: { expanded: true, diff: data.diff ?? '', loading: false, error: null },
                }));
            })
            .catch(err => {
                setFileStates(prev => ({
                    ...prev,
                    [filePath]: { expanded: true, diff: null, loading: false, error: err.message || 'Failed to load diff' },
                }));
            });
    };

    const showFullDiff = (filePath: string) => {
        onFileSelect(filePath);
    };

    if (files.length === 0) {
        return (
            <div
                className="px-4 py-6 text-xs text-[#848484] italic text-center"
                data-testid="branch-all-files-empty"
            >
                No file changes in range
            </div>
        );
    }

    return (
        <div ref={containerRef} className="flex flex-col" data-testid="branch-all-files-diff">
            {files.map((file) => {
                const state = fileStates[file.path] ?? { expanded: false, diff: null, loading: false, error: null };
                const lines = state.diff ? state.diff.split('\n') : [];
                const isTruncated = lines.length > DIFF_LINE_LIMIT;
                const displayLines = isTruncated ? lines.slice(0, DIFF_LINE_LIMIT) : lines;

                return (
                    <div key={file.path} className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] last:border-b-0" data-file-path={file.path}>
                        {/* File header row */}
                        <div
                            className="flex items-center gap-2 px-4 py-1.5 hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e] transition-colors"
                            data-testid={`branch-all-file-row-${file.path}`}
                        >
                            <button
                                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                                onClick={() => toggleFile(file.path)}
                                data-testid={`branch-all-file-toggle-${file.path}`}
                            >
                                <span className="text-[10px] text-[#848484] flex-shrink-0">
                                    {state.expanded ? '▼' : '▶'}
                                </span>
                                <span
                                    className={`font-mono font-bold text-xs w-4 text-center flex-shrink-0 ${STATUS_COLORS[normalizeStatus(file.status)] || 'text-[#848484]'}`}
                                    title={STATUS_LABELS[normalizeStatus(file.status)] || file.status}
                                >
                                    {normalizeStatus(file.status)}
                                </span>
                                {file.oldPath ? (
                                    <span className="font-mono text-xs text-[#1e1e1e] dark:text-[#ccc] flex-1 min-w-0 flex items-center gap-0" title={`${file.oldPath} → ${file.path}`}>
                                        <TruncatedPath path={file.oldPath} className="text-xs text-[#1e1e1e] dark:text-[#ccc]" />
                                        <span className="flex-shrink-0 mx-0.5"> → </span>
                                        <TruncatedPath path={file.path} className="text-xs text-[#1e1e1e] dark:text-[#ccc]" />
                                    </span>
                                ) : (
                                    <TruncatedPath path={file.path} className="text-xs text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                                )}
                                <span className="text-[#16825d] text-xs flex-shrink-0">+{file.additions}</span>
                                <span className="text-[#d32f2f] text-xs flex-shrink-0">−{file.deletions}</span>
                            </button>
                            <button
                                className="text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:underline flex-shrink-0 ml-1"
                                onClick={() => onFileSelect(file.path)}
                                title="Open full diff"
                                data-testid={`branch-all-file-open-${file.path}`}
                            >
                                Open →
                            </button>
                        </div>

                        {/* Inline diff content */}
                        {state.expanded && (
                            <div className="pl-8 pr-4 pb-2" data-testid={`branch-all-file-diff-${file.path}`}>
                                {state.loading ? (
                                    <div className="flex items-center gap-2 text-xs text-[#848484] py-1">
                                        <Spinner size="sm" /> Loading diff...
                                    </div>
                                ) : state.error ? (
                                    <div className="text-xs text-[#d32f2f] dark:text-[#f48771] py-1">
                                        {state.error}
                                    </div>
                                ) : state.diff === '' ? (
                                    <div className="text-xs text-[#848484] italic py-1">(empty diff)</div>
                                ) : (
                                    <>
                                        <div
                                            className="max-h-[400px] overflow-y-auto rounded"
                                            data-testid={`branch-all-file-diff-content-${file.path}`}
                                        >
                                            <UnifiedDiffViewer
                                                diff={displayLines.join('\n')}
                                                fileName={file.path}
                                                enableComments={false}
                                                showLineNumbers={false}
                                            />
                                        </div>
                                        {isTruncated && (
                                            <button
                                                className="mt-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                                                onClick={() => showFullDiff(file.path)}
                                                data-testid={`branch-all-file-show-full-${file.path}`}
                                            >
                                                Showing first {DIFF_LINE_LIMIT} lines — Show full diff →
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
