/**
 * WorkingTree — displays staged, unstaged, and untracked changes
 * with per-file stage/unstage/discard/delete actions.
 *
 * Follows the same visual style as BranchChanges.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { Spinner } from '../../../ui';
import { copyToClipboard } from '../../../utils/format';
import type { DiffComment } from '../../../../comments/diff-comment-types';
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
    /**
     * Dense split-workspace skin: flat row instead of a padded card, "Local"
     * tag, shortened summary and file-count. Full text stays in the tooltips.
     */
    compact?: boolean;
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

export function WorkingTree({ workspaceId, onRefresh, onFileSelect, selectedFilePath, refreshKey, onAllCommentsClick, compact }: WorkingTreeProps) {
    const [changes, setChanges] = useState<WorkingTreeChange[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    /** Set of filePaths currently being acted on */
    const [busyFiles, setBusyFiles] = useState<Set<string>>(new Set());
    const [stagingAll, setStagingAll] = useState(false);
    const [discardingAll, setDiscardingAll] = useState(false);
    const [workingChangesExpanded, setWorkingChangesExpanded] = useState(false);
    const [allWorkingComments, setAllWorkingComments] = useState<DiffComment[]>([]);
    /** Total untracked count and whether the server capped the untracked list. */
    const [untrackedTotal, setUntrackedTotal] = useState(0);
    const [untrackedTruncated, setUntrackedTruncated] = useState(false);

    // Route every working-tree call to the selected clone's server (AC-07): a
    // remote clone hits its own origin; a local/unknown id resolves to the default.
    const cloneClient = useCocClient(workspaceId);

    const fetchChanges = useCallback(() => {
        return cloneClient.git.getWorkingTreeChanges(workspaceId)
            .then(data => {
                setChanges(data.changes ?? []);
                setUntrackedTruncated(data.untrackedTruncated ?? false);
                setUntrackedTotal(data.untrackedTotal ?? 0);
            })
            .catch(err => setError(err.message || 'Failed to load changes'));
    }, [workspaceId, cloneClient]);

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchChanges().finally(() => setLoading(false));
    }, [workspaceId, fetchChanges]);

    // Fetch working-tree comment count for the badge in the header.
    useEffect(() => {
        cloneClient.git.listDiffComments(workspaceId, { newRef: 'working-tree' })
            .then((data: { comments?: DiffComment[] }) => setAllWorkingComments(data.comments ?? []))
            .catch(() => setAllWorkingComments([]));
    }, [workspaceId, cloneClient]);

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
            if (action === 'stage') {
                result = await cloneClient.git.stageFile(workspaceId, filePath);
            } else if (action === 'unstage') {
                result = await cloneClient.git.unstageFile(workspaceId, filePath);
            } else if (action === 'discard') {
                result = await cloneClient.git.discardFile(workspaceId, filePath);
            } else {
                result = await cloneClient.git.deleteUntrackedFile(workspaceId, filePath);
            }
            if (result.success === false) throw new Error(result.error || `${action} failed`);
            await fetchChanges();
            onRefresh?.();
        } catch (err: any) {
            setActionError(err.message || `${action} failed`);
        } finally {
            setBusy(filePath, false);
        }
    }, [workspaceId, cloneClient, fetchChanges, onRefresh]);

    const handleStageAll = useCallback(async (files: WorkingTreeChange[]) => {
        setStagingAll(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.stageFiles(workspaceId, files.map(f => f.filePath));
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
    }, [workspaceId, cloneClient, fetchChanges, onRefresh]);

    const handleUnstageAll = useCallback(async (files: WorkingTreeChange[]) => {
        setStagingAll(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.unstageFiles(workspaceId, files.map(f => f.filePath));
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
    }, [workspaceId, cloneClient, fetchChanges, onRefresh]);

    // Discard every visible change (staged, unstaged, untracked) in one server call.
    // On failure we still refresh so the tree reflects any partial completion, then
    // surface the error — partial failures must not look like success (AC-03).
    const handleDiscardAll = useCallback(async () => {
        setDiscardingAll(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.discardAllChanges(workspaceId);
            if (result.success === false) {
                setActionError(result.errors?.length ? result.errors.join('; ') : 'Discard all failed');
            }
        } catch (err: any) {
            setActionError(err.message || 'Discard all failed');
        } finally {
            // Always re-read so the tree reflects any partial completion, even on error.
            await fetchChanges();
            onRefresh?.();
            setDiscardingAll(false);
        }
    }, [workspaceId, cloneClient, fetchChanges, onRefresh]);

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
        <section
            className={compact
                ? 'working-tree border-l-[3px] border-l-[#16825d] dark:border-l-[#3fb950] bg-white dark:bg-[#1e1e1e] overflow-hidden'
                : 'working-tree rounded-md border border-[#16825d]/30 dark:border-[#3fb950]/35 border-l-[3px] border-l-[#16825d] dark:border-l-[#3fb950] bg-white dark:bg-[#1e1e1e] overflow-hidden'}
            data-testid="working-tree"
            aria-label="Working Changes"
        >
            {actionError && (
                <div className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="working-tree-action-error">
                    {actionError}
                </div>
            )}

            <div data-testid="working-changes-group">
                <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={workingChangesExpanded}
                    className={`w-full flex items-center text-left cursor-pointer transition-colors bg-[#16825d]/[0.05] dark:bg-[#3fb950]/[0.08] hover:bg-[#16825d]/[0.09] dark:hover:bg-[#3fb950]/[0.14] ${compact ? 'gap-1.5 px-1.5 py-0.5' : 'gap-2 px-2.5 py-1'}`}
                    onClick={() => setWorkingChangesExpanded(prev => !prev)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWorkingChangesExpanded(prev => !prev); } }}
                    data-testid="working-changes-header"
                >
                    <span className="text-[10px] text-[#848484] dark:text-[#9d9d9d] flex-shrink-0 w-3 text-center">{workingChangesExpanded ? '▼' : '▶'}</span>
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span
                            className="inline-flex items-center px-1.5 py-px rounded-full font-mono font-semibold uppercase tracking-[0.06em] text-[9px] leading-[1.4] text-[#16825d] dark:text-[#3fb950] bg-[#dafbe1] dark:bg-[#3fb950]/15 border border-[#16825d]/30 dark:border-[#3fb950]/35 whitespace-nowrap flex-shrink-0"
                            data-testid="working-tree-badge"
                        >
                            {compact ? 'Local' : 'Local Tree'}
                        </span>
                        <span
                            className="text-[10.5px] text-[#616161] dark:text-[#999] truncate min-w-0"
                            data-testid="working-tree-summary"
                            title={`${staged.length} staged · ${unstaged.length} modified · ${untracked.length} untracked`}
                        >
                            {compact
                                ? `${staged.length}s · ${unstaged.length}m · ${untracked.length}u`
                                : `${staged.length} staged · ${unstaged.length} modified · ${untracked.length} untracked`}
                        </span>
                    </span>
                    <span
                        className={`ml-auto inline-flex items-center justify-center rounded-full bg-white dark:bg-[#1e1e1e] border border-[#16825d]/35 dark:border-[#3fb950]/40 text-[#16825d] dark:text-[#3fb950] font-mono font-semibold text-[10px] tabular-nums whitespace-nowrap flex-shrink-0 ${compact ? 'px-1.5 py-0' : 'min-w-[44px] px-1.5 py-0.5'}`}
                        data-testid="working-tree-file-count"
                        title={`${totalCount} files`}
                    >
                        {compact ? `${totalCount}f` : `${totalCount} files`}
                    </span>
                    {onAllCommentsClick && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onAllCommentsClick(); }}
                            title="Show all working-tree comments"
                            className="ml-1 inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded border border-transparent hover:border-[#0078d4]/35 dark:hover:border-[#3794ff]/35 text-[#616161] dark:text-[#9d9d9d] hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors flex-shrink-0"
                            data-testid="working-tree-all-comments-btn"
                        >
                            💬 Comments {allWorkingComments.length > 0 ? allWorkingComments.length : ''}
                        </button>
                    )}
                </div>
                {workingChangesExpanded && (
                    <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="working-changes-content">
                        {totalCount > 0 && (
                            <div
                                className="flex items-center justify-end gap-1.5 pl-7 pr-4 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                                data-testid="working-tree-bulk-actions"
                            >
                                <button
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-[#d32f2f] text-[#d32f2f] hover:bg-[#d32f2f] hover:text-white dark:border-[#f48771] dark:text-[#f48771] dark:hover:bg-[#f48771] dark:hover:text-[#1e1e1e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 flex-shrink-0"
                                    onClick={(e) => { e.stopPropagation(); handleDiscardAll(); }}
                                    disabled={discardingAll || stagingAll}
                                    title="Discard all changes — staged, unstaged, and untracked. This is irreversible."
                                    data-testid="working-tree-discard-all"
                                >
                                    {discardingAll && <Spinner size="sm" />}
                                    {discardingAll ? 'Discarding…' : '↩ Discard All'}
                                </button>
                            </div>
                        )}
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
                            count={untrackedTruncated ? untrackedTotal : untracked.length}
                            onStageAll={() => handleStageAll(untracked)}
                            stagingAll={stagingAll}
                            defaultExpanded={false}
                            testId="working-tree-untracked"
                        >
                            {renderSectionFiles(untracked)}
                            {untrackedTruncated && (
                                <div
                                    className="pl-5 pr-2 py-1.5 text-[11px] text-[#848484] dark:text-[#9d9d9d] italic"
                                    data-testid="working-tree-untracked-truncated"
                                >
                                    +{untrackedTotal - untracked.length} more untracked files (not shown)
                                </div>
                            )}
                        </Section>
                    </div>
                )}
            </div>
        </section>
    );
}
