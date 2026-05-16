/**
 * Files Changed tab — left rail with file list, right rail with the
 * focused file diff(s) plus AI annotations. Driven entirely by mocked
 * AI fixtures.
 */

import { useMemo, useState } from 'react';
import { cn } from '../../ui';
import type { AiFileEntry } from './pr-mock-data';

interface PrFilesPanelProps {
    files: AiFileEntry[];
}

export function PrFilesPanel({ files }: PrFilesPanelProps) {
    const [search, setSearch] = useState('');
    const [activePath, setActivePath] = useState<string>(files[0]?.path ?? '');

    const visibleFiles = useMemo(() => {
        if (!search.trim()) return files;
        const query = search.trim().toLowerCase();
        return files.filter(file => file.path.toLowerCase().includes(query));
    }, [files, search]);

    const detailFiles = useMemo(() => {
        const annotated = files.filter(file => file.diff && file.diff.length > 0);
        if (annotated.length === 0) return files.slice(0, 1);
        return annotated;
    }, [files]);

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
                                >
                                    <span className="truncate">{file.path}</span>
                                    <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                                        <span className="text-green-700 dark:text-green-400">+{file.additions}</span>{' '}
                                        <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                                    </span>
                                </button>
                            );
                        })}
                        {visibleFiles.length === 0 && (
                            <p className="m-0 px-2 py-2 text-xs text-gray-500 dark:text-gray-400">
                                No files match the filter.
                            </p>
                        )}
                    </div>
                </div>
            </aside>
            <div data-testid="pr-file-diff-panel">
                {detailFiles.map(file => (
                    <article
                        key={file.path}
                        className="mb-3.5 overflow-hidden rounded-lg border border-gray-200 bg-white last:mb-0 dark:border-gray-700 dark:bg-gray-900"
                        data-testid="pr-file-diff-card"
                    >
                        <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800/60">
                            <strong className="text-gray-900 dark:text-gray-100">{file.path}</strong>
                            {file.focus && (
                                <span className="text-purple-700 dark:text-purple-200">{file.focus}</span>
                            )}
                        </header>
                        {file.diff && file.diff.length > 0 && (
                            <div className="font-mono text-xs leading-snug">
                                {file.diff.map(line => (
                                    <div
                                        key={`${file.path}:${line.line}`}
                                        className={cn(
                                            'grid min-h-6 items-start',
                                            line.kind === 'add' && 'bg-green-50 dark:bg-green-900/30',
                                            line.kind === 'del' && 'bg-red-50 dark:bg-red-900/30',
                                        )}
                                        style={{ gridTemplateColumns: '48px 1fr' }}
                                    >
                                        <span className="border-r border-gray-200 px-2 py-0.5 text-right text-gray-400 dark:border-gray-700 dark:text-gray-500">
                                            {line.line}
                                        </span>
                                        <span className="overflow-x-auto whitespace-pre px-2.5 py-0.5 text-gray-800 dark:text-gray-200">
                                            {line.text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {file.annotation && (
                            <div className="mb-3 ml-12 mr-3 mt-3 rounded-lg border border-purple-300 bg-purple-50 px-3 py-2.5 dark:border-purple-800 dark:bg-purple-900/30">
                                <strong className="block text-xs font-semibold text-purple-700 dark:text-purple-200">
                                    {file.annotation.title}
                                </strong>
                                <p className="m-0 mt-1 text-xs text-gray-700 dark:text-gray-200">
                                    {file.annotation.body}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {file.annotation.actions.map(action => (
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
                ))}
            </div>
        </div>
    );
}
