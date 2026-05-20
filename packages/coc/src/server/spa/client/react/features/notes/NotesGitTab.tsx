/**
 * NotesGitTab — Notes-git tab with left/right split layout.
 *
 * Used by My Work / My Life virtual workspaces to show notes version history.
 *
 * Left panel: status summary + scrollable commit history.
 * Right panel: commit detail with metadata and unified diff viewer.
 * Falls back to stacked vertical layout on narrow viewports (<1024px).
 *
 * When notes git is not initialized, shows an init prompt instead.
 */

import { useState, useCallback } from 'react';
import { useNotesGit } from './hooks/useNotesGit';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { Button, Spinner, SectionHeader } from '../../ui';
import { UnifiedDiffViewer } from '../git/diff/UnifiedDiffViewer';
import type { NotesGitLogEntry, NotesGitDiff } from '../../../../../notes/git/notes-git-types';

interface NotesGitTabProps {
    workspaceId: string;
    /** Whether the current root is the default managed root. Defaults to true. */
    isDefaultRoot?: boolean;
}

// ── Sub-component: Init prompt ─────────────────────────────────────

function NotesGitInitPrompt({ onInit }: { onInit: () => void }) {
    const [initing, setIniting] = useState(false);

    const handleInit = async () => {
        setIniting(true);
        try { await onInit(); }
        finally { setIniting(false); }
    };

    return (
        <div className="flex items-center justify-center h-full" data-testid="notes-git-init-prompt">
            <div className="max-w-md w-full mx-4 p-8 rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-center">
                <div className="text-3xl mb-4">📝</div>
                <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">
                    Enable version tracking for your notes
                </h2>
                <p className="text-sm text-[#848484] mb-6">
                    Track changes to your notes with git. You'll be able to see history, diffs,
                    and restore previous versions.
                </p>
                <Button
                    variant="primary"
                    onClick={handleInit}
                    loading={initing}
                    data-testid="notes-git-init-btn"
                >
                    Initialize Git Tracking
                </Button>
            </div>
        </div>
    );
}

// ── Sub-component: Status section ──────────────────────────────────

function NotesGitStatusSection({ status }: { status: { clean: boolean; staged: string[]; unstaged: string[]; untracked: string[] } }) {
    const modifiedCount = status.unstaged.length;
    const addedCount = status.untracked.length;
    const deletedCount = status.staged.filter(p => !status.unstaged.includes(p)).length;

    if (status.clean && modifiedCount === 0 && addedCount === 0) {
        return (
            <div className="px-4 py-2 text-xs text-[#22863a] dark:text-[#85e89d]" data-testid="notes-git-status">
                ● Clean ✔
            </div>
        );
    }

    return (
        <div className="px-4 py-2 text-xs space-y-0.5" data-testid="notes-git-status">
            {modifiedCount > 0 && (
                <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#e5a100]" />
                    <span className="text-[#1e1e1e] dark:text-[#cccccc]">{modifiedCount} modified</span>
                </div>
            )}
            {addedCount > 0 && (
                <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#22863a]" />
                    <span className="text-[#1e1e1e] dark:text-[#cccccc]">{addedCount} new</span>
                </div>
            )}
            {deletedCount > 0 && (
                <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#d32f2f]" />
                    <span className="text-[#1e1e1e] dark:text-[#cccccc]">{deletedCount} deleted</span>
                </div>
            )}
        </div>
    );
}

// ── Sub-component: History list ────────────────────────────────────

function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

function NotesGitHistoryList({
    log,
    selectedHash,
    onSelect,
}: {
    log: NotesGitLogEntry[];
    selectedHash: string | null;
    onSelect: (entry: NotesGitLogEntry) => void;
}) {
    if (log.length === 0) {
        return (
            <div className="px-4 py-6 text-xs text-[#848484] text-center" data-testid="notes-git-history">
                No commits yet
            </div>
        );
    }

    return (
        <div className="overflow-y-auto flex-1" data-testid="notes-git-history">
            {log.map(entry => (
                <button
                    key={entry.hash}
                    onClick={() => onSelect(entry)}
                    className={`w-full text-left px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors ${
                        selectedHash === entry.hash
                            ? 'bg-[#e8f0fe] dark:bg-[#264f78]'
                            : ''
                    }`}
                    data-testid={`notes-git-history-entry-${entry.shortHash}`}
                >
                    <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-[#0078d4] dark:text-[#3794ff] flex-shrink-0">
                            {entry.shortHash}
                        </span>
                        <span className="text-[#1e1e1e] dark:text-[#cccccc] truncate flex-1">
                            {entry.message}
                        </span>
                        <span className="text-[#848484] flex-shrink-0 ml-auto">
                            {formatRelativeTime(entry.date)}
                        </span>
                    </div>
                </button>
            ))}
        </div>
    );
}

// ── Sub-component: Detail pane ─────────────────────────────────────

function NotesGitDetailPane({
    diffData,
    diffLoading,
    selectedHash,
    log,
    onBack,
}: {
    diffData: NotesGitDiff | null;
    diffLoading: boolean;
    selectedHash: string;
    log: NotesGitLogEntry[];
    onBack: () => void;
}) {
    const entry = log.find(e => e.hash === selectedHash);

    if (diffLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner size="lg" />
            </div>
        );
    }

    const combinedPatch = diffData?.files.map(f => f.diff).filter(Boolean).join('\n') ?? '';

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Mobile back */}
            <div className="lg:hidden shrink-0 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]">
                <button
                    onClick={onBack}
                    className="text-xs text-[#0078d4] dark:text-[#3794ff] flex items-center gap-1 hover:underline"
                    data-testid="notes-git-mobile-back-btn"
                >
                    ← Back to list
                </button>
            </div>
            {/* Commit metadata */}
            {entry && (
                <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="notes-git-commit-meta">
                    <div className="flex items-center gap-2 mb-1">
                        <span
                            className="font-mono text-xs text-[#0078d4] dark:text-[#3794ff] cursor-pointer hover:underline"
                            onClick={() => navigator.clipboard.writeText(entry.hash)}
                            title="Click to copy full hash"
                        >
                            {entry.hash}
                        </span>
                    </div>
                    <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                        {entry.message}
                    </div>
                    <div className="text-xs text-[#848484]">
                        {new Date(entry.date).toLocaleString()}
                    </div>
                </div>
            )}
            {/* Files changed badges */}
            {diffData && diffData.files.length > 0 && (
                <div className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-wrap gap-1.5" data-testid="notes-git-changed-files">
                    {diffData.files.map(f => {
                        const statusColor = f.status === 'A'
                            ? 'text-[#22863a] dark:text-[#85e89d]'
                            : f.status === 'D'
                                ? 'text-[#d32f2f] dark:text-[#f48771]'
                                : 'text-[#e5a100] dark:text-[#e5c07b]';
                        return (
                            <span
                                key={f.path}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#f0f0f0] dark:bg-[#2d2d2d] ${statusColor}`}
                            >
                                <span className="font-semibold">{f.status}</span>
                                <span className="text-[#1e1e1e] dark:text-[#cccccc]">{f.path}</span>
                            </span>
                        );
                    })}
                </div>
            )}
            {/* Diff viewer */}
            <div className="flex-1 min-h-0 overflow-auto">
                {combinedPatch ? (
                    <UnifiedDiffViewer
                        diff={combinedPatch}
                        enableComments={false}
                        data-testid="notes-git-diff-viewer"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                        No changes in this commit.
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────

export function NotesGitTab({ workspaceId, isDefaultRoot = true }: NotesGitTabProps) {
    const {
        status, log, loading, error, initialized,
        initialize, commit, getDiff, refresh,
    } = useNotesGit(workspaceId, isDefaultRoot);

    const [selectedHash, setSelectedHash] = useState<string | null>(null);
    const [diffData, setDiffData] = useState<NotesGitDiff | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const [commitMsg, setCommitMsg] = useState('');
    const [committing, setCommitting] = useState(false);
    const [showMsgInput, setShowMsgInput] = useState(false);

    const { width: sidebarWidth, isDragging, handleMouseDown, handleTouchStart } =
        useResizablePanel({ initialWidth: 320, minWidth: 160, maxWidth: 600, storageKey: 'notes-git-sidebar-width' });

    const handleSelectCommit = useCallback(async (entry: NotesGitLogEntry) => {
        setSelectedHash(entry.hash);
        setDiffLoading(true);
        try {
            const d = await getDiff(entry.hash);
            setDiffData(d);
        } catch {
            setDiffData(null);
        } finally {
            setDiffLoading(false);
        }
    }, [getDiff]);

    const handleCommitNow = useCallback(async () => {
        setCommitting(true);
        try {
            await commit(commitMsg || undefined);
            setCommitMsg('');
            setShowMsgInput(false);
        } finally {
            setCommitting(false);
        }
    }, [commit, commitMsg]);

    const handleMobileBack = useCallback(() => {
        setSelectedHash(null);
        setDiffData(null);
    }, []);

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center py-8" data-testid="notes-git-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    // Non-default root: git features are not available
    if (!isDefaultRoot) {
        return (
            <div className="flex items-center justify-center h-full" data-testid="notes-git-non-default-root">
                <div className="max-w-md w-full mx-4 p-8 rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-center">
                    <div className="text-3xl mb-4">📂</div>
                    <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">
                        Git tracking not available
                    </h2>
                    <p className="text-sm text-[#848484] mb-2">
                        Version tracking is only available for the default managed notes root.
                    </p>
                    <p className="text-xs text-[#848484]">
                        This folder is part of your workspace repository and is already tracked by its own git history.
                    </p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="p-4 text-sm text-[#d32f2f] dark:text-[#f48771]" data-testid="notes-git-error">
                <p>{error}</p>
                <button
                    className="mt-2 px-3 py-1 text-xs rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:opacity-80"
                    onClick={refresh}
                    data-testid="notes-git-retry-btn"
                >
                    Retry
                </button>
            </div>
        );
    }

    // Not initialized
    if (!initialized) {
        return <NotesGitInitPrompt onInit={initialize} />;
    }

    // Commit button + optional message input
    const commitActions = (
        <div className="flex items-center gap-2">
            {showMsgInput && (
                <input
                    type="text"
                    value={commitMsg}
                    onChange={e => setCommitMsg(e.target.value)}
                    placeholder="Commit message…"
                    className="px-2 py-1 text-xs rounded border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] w-40"
                    data-testid="notes-git-commit-msg-input"
                    onKeyDown={e => { if (e.key === 'Enter') handleCommitNow(); }}
                />
            )}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMsgInput(v => !v)}
                title="Custom commit message"
                data-testid="notes-git-toggle-msg-btn"
            >
                ✏️
            </Button>
            <Button
                variant="primary"
                size="sm"
                onClick={handleCommitNow}
                loading={committing}
                disabled={status?.clean}
                data-testid="notes-git-commit-btn"
            >
                Commit Now
            </Button>
        </div>
    );

    return (
        <div className={`repo-git-tab flex flex-col lg:flex-row h-full overflow-hidden${isDragging ? ' select-none' : ''}`} data-testid="notes-git-tab">
            {/* Left panel — sidebar */}
            <aside
                className={`w-full lg:shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] flex flex-col${selectedHash ? ' hidden lg:flex' : ''}`}
                data-testid="notes-git-sidebar"
            >
                <style>{`@media (min-width: 1024px) { [data-testid="notes-git-sidebar"] { width: ${sidebarWidth}px !important; } }`}</style>
                <SectionHeader
                    title="Notes Git"
                    onRefresh={refresh}
                    actions={commitActions}
                    className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                />
                {status && <NotesGitStatusSection status={status} />}
                <NotesGitHistoryList log={log} selectedHash={selectedHash} onSelect={handleSelectCommit} />
            </aside>
            {/* Resize handle — desktop only */}
            <div
                className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="notes-git-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                tabIndex={0}
            />
            {/* Right panel — detail */}
            <main className={`flex-1 min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e] flex flex-col${!selectedHash ? ' hidden lg:flex' : ''}`} data-testid="notes-git-detail-panel">
                {selectedHash ? (
                    <NotesGitDetailPane
                        diffData={diffData}
                        diffLoading={diffLoading}
                        selectedHash={selectedHash}
                        log={log}
                        onBack={handleMobileBack}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="notes-git-detail-empty">
                        Select a commit to view details
                    </div>
                )}
            </main>
        </div>
    );
}
