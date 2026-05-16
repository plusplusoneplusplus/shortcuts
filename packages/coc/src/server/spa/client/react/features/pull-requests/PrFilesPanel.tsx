/**
 * Files Changed tab — left rail with file list, right rail with the
 * focused file diff.
 *
 * The file list, +/- counts, line numbers and the diff body all come
 * from the real `/api/repos/:repoId/pull-requests/:prId/diff` payload
 * (parsed by `unified-diff-parser`). Only the optional inline AI
 * annotation card (purple "AI noticed…" callout) is still mocked,
 * keyed deterministically off the file path.
 */

import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../ui';
import type { AiFileAnnotation } from './pr-mock-data';
import type { ParsedDiffFile } from './unified-diff-parser';

interface PrFilesPanelProps {
    files: ParsedDiffFile[];
    /** Optional, keyed by file path. Comes from `pr-mock-data` for now. */
    annotations?: Record<string, AiFileAnnotation | undefined>;
    /** Optional, keyed by file path. Highlights an AI-flagged file. */
    focusByPath?: Record<string, string | undefined>;
}

const STATUS_LABEL: Record<ParsedDiffFile['status'], string> = {
    added:    'Added',
    modified: 'Modified',
    deleted:  'Deleted',
    renamed:  'Renamed',
};

const STATUS_CLASS: Record<ParsedDiffFile['status'], string> = {
    added:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    modified: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    deleted:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    renamed:  'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
};

export function PrFilesPanel({ files, annotations, focusByPath }: PrFilesPanelProps) {
    const [search, setSearch] = useState('');
    const [activePath, setActivePath] = useState<string>(files[0]?.path ?? '');

    // If the file list changes (e.g. PR detail reloaded), make sure the
    // active selection still exists.
    useEffect(() => {
        if (files.length === 0) {
            setActivePath('');
        } else if (!files.some(file => file.path === activePath)) {
            setActivePath(files[0].path);
        }
    }, [files, activePath]);

    const visibleFiles = useMemo(() => {
        if (!search.trim()) return files;
        const query = search.trim().toLowerCase();
        return files.filter(file => file.path.toLowerCase().includes(query));
    }, [files, search]);

    const focusedFile = useMemo(
        () => files.find(file => file.path === activePath) ?? null,
        [files, activePath],
    );

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]" data-testid="pr-files-panel">
            <aside
                className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                data-testid="pr-file-list-panel"
            >
                <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                    <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Changed files
                    </h2>
                    <span className="font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                        {files.length}
                    </span>
                </header>
                <div className="px-4 py-3">
                    <input
                        type="text"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Filter files by path"
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        data-testid="pr-file-search"
                    />
                    <div className="mt-2 grid gap-px font-mono text-xs">
                        {visibleFiles.map(file => {
                            const isActive = file.path === activePath;
                            return (
                                <button
                                    key={file.path}
                                    type="button"
                                    onClick={() => setActivePath(file.path)}
                                    className={cn(
                                        'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                                        isActive
                                            ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                                            : 'text-gray-800 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-900/30',
                                    )}
                                    data-testid="pr-file-row"
                                    data-file-path={file.path}
                                >
                                    <span className="truncate" title={file.path}>{file.path}</span>
                                    <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                                        <span className="text-green-700 dark:text-green-400">+{file.additions}</span>{' '}
                                        <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                                    </span>
                                </button>
                            );
                        })}
                        {visibleFiles.length === 0 && (
                            <p className="m-0 px-2 py-2 text-xs text-gray-500 dark:text-gray-400">
                                {files.length === 0
                                    ? 'No file changes in this pull request.'
                                    : 'No files match the filter.'}
                            </p>
                        )}
                    </div>
                </div>
            </aside>
            <div data-testid="pr-file-diff-panel">
                {focusedFile && (
                    <FileDiffCard
                        file={focusedFile}
                        annotation={annotations?.[focusedFile.path]}
                        focus={focusByPath?.[focusedFile.path]}
                    />
                )}
                {!focusedFile && (
                    <div
                        className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                        data-testid="pr-file-diff-empty"
                    >
                        Select a file from the list to see its diff.
                    </div>
                )}
            </div>
        </div>
    );
}

interface FileDiffCardProps {
    file: ParsedDiffFile;
    annotation?: AiFileAnnotation;
    focus?: string;
}

function FileDiffCard({ file, annotation, focus }: FileDiffCardProps) {
    return (
        <article
            className="mb-3.5 overflow-hidden rounded-lg border border-gray-200 bg-white last:mb-0 dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-file-diff-card"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800/60">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className={cn(
                            'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            STATUS_CLASS[file.status],
                        )}
                        data-testid="pr-file-status"
                    >
                        {STATUS_LABEL[file.status]}
                    </span>
                    <strong className="truncate text-gray-900 dark:text-gray-100" title={file.path}>
                        {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
                    </strong>
                </div>
                <div className="flex items-center gap-2 text-[11px] tabular-nums">
                    {focus && <span className="text-purple-700 dark:text-purple-200">{focus}</span>}
                    <span className="text-green-700 dark:text-green-400">+{file.additions}</span>
                    <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                </div>
            </header>
            {file.isBinary ? (
                <div className="px-3 py-4 text-xs italic text-gray-500 dark:text-gray-400">
                    Binary file — diff omitted.
                </div>
            ) : file.lines.length === 0 ? (
                <div className="px-3 py-4 text-xs italic text-gray-500 dark:text-gray-400">
                    No textual diff content.
                </div>
            ) : (
                <div className="font-mono text-xs leading-snug">
                    {file.lines.map((line, idx) => {
                        if (line.kind === 'hunk') {
                            return (
                                <div
                                    key={`hunk-${idx}`}
                                    className="border-y border-gray-200 bg-gray-50 px-3 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400"
                                    data-testid="pr-file-hunk-header"
                                >
                                    {line.text}
                                </div>
                            );
                        }
                        const lineNo = line.kind === 'del' ? line.oldLineNo : line.newLineNo;
                        return (
                            <div
                                key={idx}
                                className={cn(
                                    'grid min-h-6 items-start',
                                    line.kind === 'add' && 'bg-green-50 dark:bg-green-900/30',
                                    line.kind === 'del' && 'bg-red-50 dark:bg-red-900/30',
                                )}
                                style={{ gridTemplateColumns: '48px 1fr' }}
                                data-testid={`pr-file-diff-line-${line.kind}`}
                            >
                                <span className="border-r border-gray-200 px-2 py-0.5 text-right text-gray-400 dark:border-gray-700 dark:text-gray-500">
                                    {lineNo ?? ''}
                                </span>
                                <span className="overflow-x-auto whitespace-pre px-2.5 py-0.5 text-gray-800 dark:text-gray-200">
                                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                                    {line.text}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
            {annotation && (
                <div
                    className="mb-3 ml-12 mr-3 mt-3 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2.5 dark:border-purple-800 dark:bg-purple-900/30"
                    data-testid="pr-file-ai-annotation"
                >
                    <strong className="block text-xs font-semibold text-purple-700 dark:text-purple-200">
                        {annotation.title}
                    </strong>
                    <p className="m-0 mt-1 text-xs text-gray-700 dark:text-gray-200">
                        {annotation.body}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {annotation.actions.map(action => (
                            <button
                                key={action}
                                type="button"
                                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                                {action}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </article>
    );
}
