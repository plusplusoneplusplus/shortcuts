/**
 * UnifiedPanelToolbar — the breadcrumb row under the tab strip (AC-02).
 *
 * Rendered only while a file tab is active; every other kind brings its own
 * toolbar inside its own view, and the panel does not stack two of them. It
 * reuses the Explorer's own `Breadcrumbs` so the two surfaces read identically
 * and hosts the shared navigator toggle at its right edge.
 *
 * A segment click opens a directory picker listing that folder's files and
 * subfolders. The picker uses the active file tab's owner, so it remains correct
 * when the Explorer column points at another repo. Trusted absolute paths cannot
 * be listed through the repo API and degrade to a plain path label.
 *
 * Long paths truncate from the *left*: the row scrolls itself to the end when
 * the path changes, so the file name — the part you are looking at — stays
 * visible while the leading directories run off, with the whole path in the
 * row's tooltip.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../ui/cn';
import { Spinner } from '../../../ui';
import { Breadcrumbs } from '../explorer/Breadcrumbs';
import { explorerApi } from '../explorer/explorerApi';
import { FileTypeIcon } from '../explorer/FileTypeIcon';
import type { TreeEntry } from '../explorer/types';
import { breadcrumbFolderPath } from './unifiedPanelBreadcrumbs';
import type { UnifiedToolbarBreadcrumbs } from './unifiedPanelBreadcrumbs';

export interface UnifiedPanelToolbarProps {
    /** What to show, from `unifiedToolbarBreadcrumbs`. */
    breadcrumbs: UnifiedToolbarBreadcrumbs;
    /** Workspace that owns the active file tab. */
    workspaceId: string;
    /** Concrete local/remote route that owns the active file tab. */
    routingRef?: string | null;
    /** Open a file chosen from the directory picker. */
    onOpenFile: (entry: TreeEntry) => void;
    /** Panel-level navigator control rendered at the row's right edge. */
    trailing?: ReactNode;
}

export function UnifiedPanelToolbar({
    breadcrumbs,
    workspaceId,
    routingRef,
    onOpenFile,
    trailing,
}: UnifiedPanelToolbarProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const [directoryPath, setDirectoryPath] = useState<string | null>(null);
    const [entries, setEntries] = useState<TreeEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keep the tail of the path in view as the active file changes.
    useEffect(() => {
        const nav = scrollRef.current?.querySelector<HTMLElement>('[data-testid="explorer-breadcrumbs"]')
            ?? scrollRef.current;
        if (nav) {
            nav.scrollLeft = nav.scrollWidth;
        }
    }, [breadcrumbs.path]);

    // A tab switch invalidates any picker opened for the previous file.
    useEffect(() => {
        setDirectoryPath(null);
    }, [breadcrumbs.path, workspaceId, routingRef]);

    useEffect(() => {
        if (directoryPath === null) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setEntries([]);
        explorerApi.tree(workspaceId, { path: directoryPath || '.', depth: 1 }, routingRef)
            .then(result => {
                if (!cancelled) {
                    setEntries(result.entries);
                }
            })
            .catch((reason: unknown) => {
                if (!cancelled) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [directoryPath, workspaceId, routingRef]);

    useEffect(() => {
        if (directoryPath === null) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            if (!toolbarRef.current?.contains(event.target as Node)) {
                setDirectoryPath(null);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setDirectoryPath(null);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [directoryPath]);

    const browseSegment = useCallback((segmentIndex: number) => {
        setDirectoryPath(breadcrumbFolderPath(breadcrumbs.segments, segmentIndex) ?? '');
    }, [breadcrumbs.segments]);

    const browseParent = useCallback(() => {
        if (!directoryPath) {
            return;
        }
        const slash = directoryPath.lastIndexOf('/');
        setDirectoryPath(slash < 0 ? '' : directoryPath.slice(0, slash));
    }, [directoryPath]);

    return (
        <div
            ref={toolbarRef}
            className="relative flex min-w-0 flex-shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-1 py-0.5 dark:border-[#333]"
            data-testid="unified-panel-toolbar"
        >
            {breadcrumbs.repoLabel && (
                <span
                    className="max-w-[96px] flex-shrink-0 truncate rounded bg-[#f0f0f0] px-1 text-[10px] text-[#616161] dark:bg-[#2d2d2d] dark:text-[#9d9d9d]"
                    data-testid="unified-panel-toolbar-repo"
                >
                    {breadcrumbs.repoLabel}
                </span>
            )}
            <div
                ref={scrollRef}
                className={cn('min-w-0 flex-1 overflow-hidden', !breadcrumbs.interactive && 'overflow-x-auto')}
                title={breadcrumbs.path}
            >
                {breadcrumbs.interactive ? (
                    <Breadcrumbs segments={[...breadcrumbs.segments]} onNavigate={browseSegment} />
                ) : (
                    // Not repo-relative: orientation only.
                    <span
                        className="block truncate px-2 py-1 text-[10px] text-[#848484]"
                        data-testid="unified-panel-toolbar-path"
                    >
                        {breadcrumbs.path}
                    </span>
                )}
            </div>
            {trailing}
            {directoryPath !== null && (
                <div
                    className="absolute left-1 top-full z-30 mt-1 flex max-h-72 w-[min(360px,calc(100%-8px))] flex-col overflow-hidden rounded border border-[#c8c8c8] bg-white shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]"
                    role="dialog"
                    aria-label={`Files in ${directoryPath || 'root'}`}
                    data-testid="breadcrumb-directory-picker"
                >
                    <div className="flex items-center gap-1 border-b border-[#e5e5e5] px-2 py-1 text-[10px] text-[#848484] dark:border-[#3c3c3c]">
                        {directoryPath && (
                            <button
                                type="button"
                                className="rounded px-1 hover:bg-[#f0f0f0] dark:hover:bg-[#37373d]"
                                onClick={browseParent}
                                aria-label="Parent folder"
                                data-testid="breadcrumb-directory-parent"
                            >
                                ‹
                            </button>
                        )}
                        <span className="truncate" title={directoryPath || 'root'}>{directoryPath || 'root'}</span>
                    </div>
                    <div className="min-h-0 overflow-y-auto py-1" data-testid="breadcrumb-directory-entries">
                        {loading && (
                            <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[#848484]">
                                <Spinner size="sm" /> Loading…
                            </div>
                        )}
                        {error && (
                            <div className="px-2.5 py-2 text-xs text-[#a1260d] dark:text-[#f48771]" role="alert">
                                {error}
                            </div>
                        )}
                        {!loading && !error && entries.map(entry => (
                            <button
                                key={entry.path}
                                type="button"
                                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[#1f1f1f] hover:bg-[#f0f0f0] dark:text-[#cccccc] dark:hover:bg-[#37373d]"
                                title={entry.path}
                                onClick={() => {
                                    if (entry.type === 'dir') {
                                        setDirectoryPath(entry.path);
                                    } else {
                                        setDirectoryPath(null);
                                        onOpenFile(entry);
                                    }
                                }}
                                data-testid={`breadcrumb-directory-entry-${entry.path}`}
                            >
                                <span className="flex-shrink-0"><FileTypeIcon entry={entry} /></span>
                                <span className="truncate">{entry.name}</span>
                                {entry.type === 'dir' && <span className="ml-auto text-[#848484]">›</span>}
                            </button>
                        ))}
                        {!loading && !error && entries.length === 0 && (
                            <div className="px-2.5 py-2 text-xs text-[#848484]">This folder is empty.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
