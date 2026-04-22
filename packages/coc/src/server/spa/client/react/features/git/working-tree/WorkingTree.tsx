/**
 * WorkingTree — displays staged, unstaged, and untracked changes
 * with per-file stage/unstage/discard/delete actions.
 *
 * Follows the same visual style as BranchChanges.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import { Spinner } from '../../../shared';
import { copyToClipboard } from '../../../utils/format';
import type { DiffComment } from '../../../../diff-comment-types';
import { FlatFileList, FileTreeView, buildFileTree, compactFolders, STATUS_COLORS, STATUS_LABELS, normalizeStatus } from '../diff/FileTree';
import type { FileChange, FileNode } from '../diff/FileTree';
import { useFilesViewMode } from '../hooks/useFilesViewMode';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkingTreeChange {
    filePath: string;
    originalPath?: string;
    /** Single-char status from API (M/A/D/R/C/U/?) */
    status: string;
    /** Also exposed as oldPath by the normalized API */
    oldPath?: string;
    stage: 'staged' | 'unstaged' | 'untracked';
    repositoryRoot: string;
    repositoryName: string;
}

interface WorkingTreeProps {
    workspaceId: string;
    /** Callback to trigger a full git data refresh in the parent. */
    onRefresh?: () => void;
    /** Callback when a file row is clicked — opens it in the right panel. */
    onFileSelect?: (filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => void;
    /** Currently selected file path for highlighting. */
    selectedFilePath?: string | null;
    /** Increment this counter to trigger a working-changes re-fetch from the parent. */
    refreshKey?: number;
    /** Callback when the "all comments" button is clicked in the header. */
    onAllCommentsClick?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function basename(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? filePath;
}

/** Convert WorkingTreeChange[] to FileChange[] for shared components. */
function toFileChanges(changes: WorkingTreeChange[]): FileChange[] {
    return changes.map(c => ({
        path: c.filePath,
        status: c.status,
        oldPath: c.oldPath ?? c.originalPath,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: action buttons for file rows
// ─────────────────────────────────────────────────────────────────────────────

interface ActionButtonProps {
    label: string;
    title: string;
    onClick: () => void;
    disabled: boolean;
    colorClass: string;
    testId: string;
}

function ActionButton({ label, title, onClick, disabled, colorClass, testId }: ActionButtonProps) {
    return (
        <button
            className={`w-5 h-5 flex items-center justify-center rounded font-bold text-xs ${colorClass} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
            title={title}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            disabled={disabled}
            data-testid={testId}
        >
            {label}
        </button>
    );
}

/** Renders the action buttons (stage/unstage/discard/delete/copy) for a file row. */
function FileActions({
    change,
    onAction,
    busy,
}: {
    change: WorkingTreeChange;
    onAction: (action: 'stage' | 'unstage' | 'discard' | 'delete') => void;
    busy: boolean;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopyPath = (e: React.MouseEvent) => {
        e.stopPropagation();
        copyToClipboard(change.filePath).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
                className="w-5 h-5 flex items-center justify-center rounded text-[10px] text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#3c3c3c] transition-colors"
                title={copied ? 'Copied!' : 'Copy path'}
                onClick={handleCopyPath}
                data-testid={`copy-path-btn-${change.filePath}`}
            >
                {copied ? '✓' : '⧉'}
            </button>

            {change.stage === 'unstaged' && (
                <>
                    <ActionButton
                        label="+"
                        title="Stage"
                        onClick={() => onAction('stage')}
                        disabled={busy}
                        colorClass="text-[#16825d] hover:bg-[#d4edda] dark:hover:bg-[#1a3a22]"
                        testId={`stage-btn-${change.filePath}`}
                    />
                    <ActionButton
                        label="↩"
                        title="Discard changes"
                        onClick={() => onAction('discard')}
                        disabled={busy}
                        colorClass="text-[#d32f2f] hover:bg-[#fdecea] dark:hover:bg-[#3c2020]"
                        testId={`discard-btn-${change.filePath}`}
                    />
                </>
            )}
            {change.stage === 'staged' && (
                <ActionButton
                    label="−"
                    title="Unstage"
                    onClick={() => onAction('unstage')}
                    disabled={busy}
                    colorClass="text-[#f57c00] hover:bg-[#fff3e0] dark:hover:bg-[#3a2800]"
                    testId={`unstage-btn-${change.filePath}`}
                />
            )}
            {change.stage === 'untracked' && (
                <>
                    <ActionButton
                        label="+"
                        title="Stage (add)"
                        onClick={() => onAction('stage')}
                        disabled={busy}
                        colorClass="text-[#16825d] hover:bg-[#d4edda] dark:hover:bg-[#1a3a22]"
                        testId={`stage-btn-${change.filePath}`}
                    />
                    <ActionButton
                        label="✕"
                        title="Delete file"
                        onClick={() => onAction('delete')}
                        disabled={busy}
                        colorClass="text-[#d32f2f] hover:bg-[#fdecea] dark:hover:bg-[#3c2020]"
                        testId={`delete-btn-${change.filePath}`}
                    />
                </>
            )}
            {busy && <Spinner size="sm" />}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: section
// ─────────────────────────────────────────────────────────────────────────────

interface SectionProps {
    title: string;
    count: number;
    children: React.ReactNode;
    defaultExpanded?: boolean;
    onStageAll?: () => void;
    onUnstageAll?: () => void;
    stagingAll?: boolean;
    testId?: string;
}

function Section({ title, count, children, defaultExpanded = true, onStageAll, onUnstageAll, stagingAll, testId }: SectionProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    useEffect(() => {
        if (count > 0 && !expanded) setExpanded(true);
    // Only auto-expand when count goes from 0 to >0
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count > 0]);

    return (
        <div data-testid={testId}>
            <div
                role="button"
                tabIndex={0}
                className="w-full flex items-center gap-1.5 pl-7 pr-4 py-1.5 bg-transparent border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-left cursor-pointer hover:bg-[#ececec] dark:hover:bg-[#2a2d2e] transition-colors"
                onClick={() => setExpanded(prev => !prev)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(prev => !prev); } }}
                data-testid={`${testId}-header`}
            >
                <span className="text-[10px] text-[#848484] flex-shrink-0">{expanded ? '▼' : '▶'}</span>
                <span className="text-xs font-medium tracking-wide text-[#616161] dark:text-[#999] flex-1">
                    {title}
                </span>
                <span className="text-xs text-[#848484] flex-shrink-0 mr-1">{count}</span>
                {onStageAll && count > 0 && (
                    <button
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4] hover:text-white dark:border-[#3794ff] dark:text-[#3794ff] dark:hover:bg-[#3794ff] dark:hover:text-white transition-colors disabled:opacity-40 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); onStageAll(); }}
                        disabled={stagingAll}
                        title="Stage all"
                        data-testid={`${testId}-stage-all`}
                    >
                        + All
                    </button>
                )}
                {onUnstageAll && count > 0 && (
                    <button
                        className="text-[10px] px-1.5 py-0.5 rounded border border-[#f57c00] text-[#f57c00] hover:bg-[#f57c00] hover:text-white dark:border-[#ffb74d] dark:text-[#ffb74d] dark:hover:bg-[#ffb74d] dark:hover:text-[#1e1e1e] transition-colors disabled:opacity-40 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); onUnstageAll(); }}
                        disabled={stagingAll}
                        title="Unstage all"
                        data-testid={`${testId}-unstage-all`}
                    >
                        − All
                    </button>
                )}
            </div>
            {expanded && count === 0 && (
                <div className="pl-10 pr-4 py-1.5 text-xs text-[#848484] italic border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    No changes
                </div>
            )}
            {expanded && count > 0 && (
                <div className="pl-5 pr-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {children}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function WorkingTree({ workspaceId, onRefresh, onFileSelect, selectedFilePath, refreshKey, onAllCommentsClick }: WorkingTreeProps) {
    const [changes, setChanges] = useState<WorkingTreeChange[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    /** Set of filePaths currently being acted on */
    const [busyFiles, setBusyFiles] = useState<Set<string>>(new Set());
    const [stagingAll, setStagingAll] = useState(false);
    const [workingChangesExpanded, setWorkingChangesExpanded] = useState(false);
    const [allWorkingComments, setAllWorkingComments] = useState<DiffComment[]>([]);

    const fetchChanges = useCallback(() => {
        return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/changes`)
            .then(data => setChanges(data.changes ?? []))
            .catch(err => setError(err.message || 'Failed to load changes'));
    }, [workspaceId]);

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchChanges().finally(() => setLoading(false));
    }, [workspaceId, fetchChanges]);

    // Fetch working-tree comment count for the badge in the header.
    useEffect(() => {
        fetchApi(`/diff-comments/${encodeURIComponent(workspaceId)}?newRef=working-tree`)
            .then((data: { comments?: DiffComment[] }) => setAllWorkingComments(data.comments ?? []))
            .catch(() => setAllWorkingComments([]));
    }, [workspaceId]);

    // Re-fetch when parent increments refreshKey (e.g. Refresh button click)
    const refreshKeyMountedRef = useRef(false);
    useEffect(() => {
        if (!refreshKeyMountedRef.current) {
            refreshKeyMountedRef.current = true;
            return;
        }
        if (refreshKey !== undefined) {
            fetchChanges();
        }
    }, [refreshKey, fetchChanges]);

    useEffect(() => {
        if (changes.length > 0 && !workingChangesExpanded) setWorkingChangesExpanded(true);
        // Only auto-expand when count goes from 0 to >0
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [changes.length > 0]);

    const setBusy = (filePath: string, busy: boolean) => {
        setBusyFiles(prev => {
            const next = new Set(prev);
            if (busy) next.add(filePath); else next.delete(filePath);
            return next;
        });
    };

    const handleAction = useCallback(async (
        action: 'stage' | 'unstage' | 'discard' | 'delete',
        filePath: string
    ) => {
        setBusy(filePath, true);
        setActionError(null);
        try {
            let result: { success: boolean; error?: string };
            const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
            if (action === 'stage') {
                result = await fetchApi(`${base}/stage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath }),
                });
            } else if (action === 'unstage') {
                result = await fetchApi(`${base}/unstage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath }),
                });
            } else if (action === 'discard') {
                result = await fetchApi(`${base}/discard`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath }),
                });
            } else {
                result = await fetchApi(`${base}/untracked`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath }),
                });
            }
            if (result.success === false) throw new Error(result.error || `${action} failed`);
            await fetchChanges();
            onRefresh?.();
        } catch (err: any) {
            setActionError(err.message || `${action} failed`);
        } finally {
            setBusy(filePath, false);
        }
    }, [workspaceId, fetchChanges, onRefresh]);

    const handleStageAll = useCallback(async (files: WorkingTreeChange[]) => {
        setStagingAll(true);
        setActionError(null);
        try {
            const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
            const result = await fetchApi(`${base}/stage-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePaths: files.map(f => f.filePath) }),
            });
            if (result.success === false) {
                throw new Error(result.errors?.join(', ') || 'Stage failed');
            }
            await fetchChanges();
            onRefresh?.();
        } catch (err: any) {
            setActionError(err.message || 'Stage all failed');
        } finally {
            setStagingAll(false);
        }
    }, [workspaceId, fetchChanges, onRefresh]);

    const handleUnstageAll = useCallback(async (files: WorkingTreeChange[]) => {
        setStagingAll(true);
        setActionError(null);
        try {
            const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/changes`;
            const result = await fetchApi(`${base}/unstage-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePaths: files.map(f => f.filePath) }),
            });
            if (result.success === false) {
                throw new Error(result.errors?.join(', ') || 'Unstage failed');
            }
            await fetchChanges();
            onRefresh?.();
        } catch (err: any) {
            setActionError(err.message || 'Unstage all failed');
        } finally {
            setStagingAll(false);
        }
    }, [workspaceId, fetchChanges, onRefresh]);

    const staged    = changes.filter(c => c.stage === 'staged');
    const unstaged  = changes.filter(c => c.stage === 'unstaged');
    const untracked = changes.filter(c => c.stage === 'untracked');
    const totalCount = staged.length + unstaged.length + untracked.length;

    // Flat/tree toggle for working-tree file lists (shared repo preference)
    const { mode: wtViewMode, setMode: setWtViewMode } = useFilesViewMode(workspaceId);

    /** Build a changeLookup map for quick filePath → WorkingTreeChange access */
    const changeLookup = new Map(changes.map(c => [c.filePath, c]));

    /** Render file actions for a file identified by path */
    const renderFileActionsForPath = useCallback((filePath: string) => {
        const change = changeLookup.get(filePath);
        if (!change) return null;
        return (
            <FileActions
                change={change}
                onAction={action => handleAction(action, change.filePath)}
                busy={busyFiles.has(change.filePath)}
            />
        );
    }, [changeLookup, handleAction, busyFiles]);

    /** Render a section's file list using shared components */
    const renderSectionFiles = (sectionChanges: WorkingTreeChange[]) => {
        const fileChanges = toFileChanges(sectionChanges);
        const handleSelect = (filePath: string) => {
            const change = changeLookup.get(filePath);
            if (change && onFileSelect) onFileSelect(change.filePath, change.stage);
        };

        if (wtViewMode === 'tree') {
            return (
                <FileTreeView
                    nodes={compactFolders(buildFileTree(fileChanges))}
                    onFileSelectSimple={onFileSelect ? handleSelect : undefined}
                    selectedFilePath={selectedFilePath}
                    fileCommentMap={new Map()}
                    fileTestIdPrefix="working-tree-file-row"
                    renderActions={(node) => renderFileActionsForPath(node.path)}
                />
            );
        }

        return (
            <FlatFileList
                files={fileChanges}
                onFileSelect={onFileSelect ? handleSelect : () => {}}
                selectedFilePath={selectedFilePath}
                fileTestIdPrefix="working-tree-file-row"
                renderActions={(file) => renderFileActionsForPath(file.path)}
            />
        );
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-[#848484]" data-testid="working-tree-loading">
                <Spinner size="sm" /> Loading changes...
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-4 py-2 text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="working-tree-error">
                {error}
            </div>
        );
    }

    return (
        <div className="working-tree" data-testid="working-tree">
            {actionError && (
                <div className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="working-tree-action-error">
                    {actionError}
                </div>
            )}

            <div data-testid="working-changes-group">
                <div
                    role="button"
                    tabIndex={0}
                    className="w-full flex items-center gap-1.5 px-4 py-1.5 bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-left cursor-pointer hover:bg-[#ececec] dark:hover:bg-[#2a2d2e] transition-colors"
                    onClick={() => setWorkingChangesExpanded(prev => !prev)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWorkingChangesExpanded(prev => !prev); } }}
                    data-testid="working-changes-header"
                >
                    <span className="text-[10px] text-[#848484] flex-shrink-0">{workingChangesExpanded ? '▼' : '▶'}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-[#616161] dark:text-[#999] flex-1">
                        Working Changes
                    </span>
                    <span className="text-xs text-[#848484] flex-shrink-0 mr-1">{totalCount}</span>
                    {onAllCommentsClick && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onAllCommentsClick(); }}
                            title="Show all working-tree comments"
                            className="text-xs px-1.5 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] flex-shrink-0"
                            data-testid="working-tree-all-comments-btn"
                        >
                            💬 {allWorkingComments.length > 0 ? allWorkingComments.length : ''}
                        </button>
                    )}
                </div>
                {workingChangesExpanded && (
                    <div data-testid="working-changes-content">
                        <Section
                            title="Staged"
                            count={staged.length}
                            onUnstageAll={() => handleUnstageAll(staged)}
                            stagingAll={stagingAll}
                            testId="working-tree-staged"
                        >
                            {renderSectionFiles(staged)}
                        </Section>

                        <Section
                            title="Changes"
                            count={unstaged.length}
                            onStageAll={() => handleStageAll(unstaged)}
                            stagingAll={stagingAll}
                            testId="working-tree-unstaged"
                        >
                            {renderSectionFiles(unstaged)}
                        </Section>

                        <Section
                            title="Untracked"
                            count={untracked.length}
                            onStageAll={() => handleStageAll(untracked)}
                            stagingAll={stagingAll}
                            defaultExpanded={false}
                            testId="working-tree-untracked"
                        >
                            {renderSectionFiles(untracked)}
                        </Section>
                    </div>
                )}
            </div>
        </div>
    );
}
