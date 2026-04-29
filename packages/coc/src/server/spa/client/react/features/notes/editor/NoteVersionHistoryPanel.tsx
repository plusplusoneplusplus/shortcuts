import { useState, useEffect, useCallback } from 'react';
import { notesApi } from '../notesApi';
import { wordDiff } from './noteEditDiff';
import type { DiffChunk } from './noteEditDiff';
import { Spinner } from '../../../ui/Spinner';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NoteFileVersion {
    hash: string;
    shortHash: string;
    message: string;
    date: string;
    isNamedCheckpoint: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
}

function displayName(version: NoteFileVersion): string {
    if (version.isNamedCheckpoint) return version.message.replace(/^\[v\] /, '');
    return version.message;
}

// ── Diff preview renderer ─────────────────────────────────────────────────────

function DiffPreview({ chunks }: { chunks: DiffChunk[] }) {
    const lines: Array<{ type: 'equal' | 'add' | 'remove'; text: string }> = [];

    // Group chunks into line-level presentation
    let current = '';
    let currentType: 'equal' | 'add' | 'remove' = 'equal';

    for (const chunk of chunks) {
        if (chunk.type === currentType) {
            current += chunk.text;
        } else {
            if (current) lines.push({ type: currentType, text: current });
            current = chunk.text;
            currentType = chunk.type;
        }
    }
    if (current) lines.push({ type: currentType, text: current });

    if (lines.every(l => l.type === 'equal')) {
        return (
            <p className="text-xs text-[#848484] dark:text-[#666] italic py-2">
                No differences from current version.
            </p>
        );
    }

    return (
        <div className="font-mono text-[11px] whitespace-pre-wrap break-words">
            {lines.map((l, i) => (
                <span
                    key={i}
                    className={
                        l.type === 'add'
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300'
                            : l.type === 'remove'
                                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 line-through'
                                : 'text-[#444] dark:text-[#bbb]'
                    }
                >
                    {l.text}
                </span>
            ))}
        </div>
    );
}

// ── Version row ───────────────────────────────────────────────────────────────

interface VersionRowProps {
    version: NoteFileVersion;
    onPreview: (version: NoteFileVersion) => void;
    onRestore: (version: NoteFileVersion) => void;
    restoring: boolean;
}

function VersionRow({ version, onPreview, onRestore, restoring }: VersionRowProps) {
    const [confirmRestore, setConfirmRestore] = useState(false);

    return (
        <div
            className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] group"
            data-testid={`version-row-${version.shortHash}`}
        >
            <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                    <span
                        className={`text-xs font-medium truncate block ${
                            version.isNamedCheckpoint
                                ? 'text-[#0078d4] dark:text-[#3794ff]'
                                : 'text-[#1e1e1e] dark:text-[#cccccc]'
                        }`}
                        title={displayName(version)}
                    >
                        {displayName(version)}
                    </span>
                    <span className="text-[10px] text-[#848484] dark:text-[#666]">
                        {version.shortHash} · {relativeDate(version.date)}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        className="text-[10px] px-1.5 py-0.5 rounded text-[#0078d4] dark:text-[#3794ff] hover:bg-[#e0eef9] dark:hover:bg-[#1a3a5c] opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Preview this version"
                        onClick={() => onPreview(version)}
                        data-testid={`version-preview-${version.shortHash}`}
                    >
                        Preview
                    </button>
                    {!confirmRestore ? (
                        <button
                            type="button"
                            className="text-[10px] px-1.5 py-0.5 rounded text-[#888] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Restore this version"
                            onClick={() => setConfirmRestore(true)}
                            data-testid={`version-restore-${version.shortHash}`}
                        >
                            ↩
                        </button>
                    ) : (
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-amber-600 dark:text-amber-400">Overwrite?</span>
                            <button
                                type="button"
                                className="text-[9px] px-1 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                                onClick={() => { onRestore(version); setConfirmRestore(false); }}
                                disabled={restoring}
                                data-testid={`version-restore-confirm-${version.shortHash}`}
                            >
                                Yes
                            </button>
                            <button
                                type="button"
                                className="text-[9px] px-1 py-0.5 rounded text-[#888] hover:text-[#333] dark:hover:text-white"
                                onClick={() => setConfirmRestore(false)}
                            >
                                No
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Preview dialog ────────────────────────────────────────────────────────────

interface PreviewDialogProps {
    version: NoteFileVersion;
    workspaceId: string;
    notePath: string;
    currentContent: string;
    onClose: () => void;
    onRestore: (version: NoteFileVersion) => void;
}

function PreviewDialog({ version, workspaceId, notePath, currentContent, onClose, onRestore }: PreviewDialogProps) {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showDiff, setShowDiff] = useState(false);
    const [confirmRestore, setConfirmRestore] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        notesApi.getFileContentAtRevision(workspaceId, version.hash, notePath)
            .then(({ content: c }) => {
                if (!cancelled) { setContent(c); setLoading(false); }
            })
            .catch((err) => {
                if (!cancelled) { setError(err?.message ?? 'Failed to load version'); setLoading(false); }
            });
        return () => { cancelled = true; };
    }, [workspaceId, version.hash, notePath]);

    const diffChunks = content !== null ? wordDiff(currentContent, content) : null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            data-testid="version-preview-dialog"
        >
            <div className="bg-white dark:bg-[#1e1e1e] rounded-lg shadow-xl w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col border border-[#e0e0e0] dark:border-[#3c3c3c]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div>
                        <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            {version.isNamedCheckpoint ? '📌 ' : ''}
                            {displayName(version)}
                        </span>
                        <span className="ml-2 text-xs text-[#848484] dark:text-[#666]">
                            {version.shortHash} · {relativeDate(version.date)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {diffChunks && (
                            <button
                                type="button"
                                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                    showDiff
                                        ? 'bg-[#0078d4] text-white'
                                        : 'text-[#888] hover:text-[#333] dark:hover:text-white border border-[#ccc] dark:border-[#555]'
                                }`}
                                onClick={() => setShowDiff(v => !v)}
                                data-testid="version-diff-toggle"
                            >
                                {showDiff ? 'Show raw' : 'Show diff'}
                            </button>
                        )}
                        <button
                            type="button"
                            className="text-[#888] hover:text-[#333] dark:hover:text-white text-sm"
                            onClick={onClose}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-4 py-3">
                    {loading && (
                        <div className="flex items-center gap-2 text-xs text-[#848484]">
                            <Spinner size="sm" /> Loading…
                        </div>
                    )}
                    {error && (
                        <p className="text-xs text-red-500">{error}</p>
                    )}
                    {!loading && !error && content !== null && (
                        showDiff && diffChunks ? (
                            <DiffPreview chunks={diffChunks} />
                        ) : (
                            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                {content}
                            </pre>
                        )
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {!confirmRestore ? (
                        <>
                            <button
                                type="button"
                                className="text-xs px-3 py-1 rounded text-[#888] hover:text-[#333] dark:hover:text-white border border-[#ccc] dark:border-[#555]"
                                onClick={onClose}
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                className="text-xs px-3 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
                                onClick={() => setConfirmRestore(true)}
                                disabled={loading || !!error}
                                data-testid="version-preview-restore-btn"
                            >
                                ↩ Restore this version
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="text-xs text-amber-600 dark:text-amber-400 mr-2">
                                Current content will be overwritten. Continue?
                            </span>
                            <button
                                type="button"
                                className="text-xs px-3 py-1 rounded text-[#888] hover:text-[#333] dark:hover:text-white border border-[#ccc] dark:border-[#555]"
                                onClick={() => setConfirmRestore(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="text-xs px-3 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white"
                                onClick={() => { onRestore(version); onClose(); }}
                                data-testid="version-preview-restore-confirm-btn"
                            >
                                Yes, restore
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface NoteVersionHistoryPanelProps {
    workspaceId: string;
    notePath: string;
    /** Current markdown content (used for diff preview). */
    currentContent: string;
    /** True when the notes git repo is initialized. */
    gitInitialized: boolean;
    /** Called after a successful restore so the editor can reload. */
    onReload: () => void;
    onClose: () => void;
}

export function NoteVersionHistoryPanel({
    workspaceId,
    notePath,
    currentContent,
    gitInitialized,
    onReload,
    onClose,
}: NoteVersionHistoryPanelProps) {
    const [versions, setVersions] = useState<NoteFileVersion[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [restoreSuccess, setRestoreSuccess] = useState(false);

    // Save checkpoint form
    const [checkpointName, setCheckpointName] = useState('');
    const [savingCheckpoint, setSavingCheckpoint] = useState(false);
    const [checkpointError, setCheckpointError] = useState<string | null>(null);

    // Preview dialog
    const [previewVersion, setPreviewVersion] = useState<NoteFileVersion | null>(null);

    const loadHistory = useCallback(() => {
        if (!gitInitialized) return;
        setLoading(true);
        setError(null);
        notesApi.getFileLog(workspaceId, notePath)
            .then(({ entries }) => { setVersions(entries); setLoading(false); })
            .catch((err) => { setError(err?.message ?? 'Failed to load history'); setLoading(false); });
    }, [workspaceId, notePath, gitInitialized]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const handleSaveCheckpoint = useCallback(async () => {
        const name = checkpointName.trim();
        if (!name) return;
        setSavingCheckpoint(true);
        setCheckpointError(null);
        try {
            await notesApi.saveCheckpoint(workspaceId, notePath, name);
            setCheckpointName('');
            loadHistory();
        } catch (err: any) {
            setCheckpointError(err?.message ?? 'Failed to save checkpoint');
        } finally {
            setSavingCheckpoint(false);
        }
    }, [workspaceId, notePath, checkpointName, loadHistory]);

    const handleRestore = useCallback(async (version: NoteFileVersion) => {
        setRestoring(true);
        setRestoreError(null);
        setRestoreSuccess(false);
        try {
            await notesApi.restoreVersion(workspaceId, notePath, version.hash);
            setRestoreSuccess(true);
            setTimeout(() => setRestoreSuccess(false), 3000);
            onReload();
        } catch (err: any) {
            setRestoreError(err?.message ?? 'Failed to restore version');
        } finally {
            setRestoring(false);
        }
    }, [workspaceId, notePath, onReload]);

    const checkpoints = versions.filter(v => v.isNamedCheckpoint);
    const autoCommits = versions.filter(v => !v.isNamedCheckpoint);

    return (
        <div
            className="flex flex-col h-full border-l border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
            data-testid="version-history-panel"
            style={{ width: 280 }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    🕐 Version History
                </span>
                <button
                    type="button"
                    className="text-[#888] hover:text-[#333] dark:hover:text-white text-xs"
                    onClick={onClose}
                    aria-label="Close version history"
                    data-testid="version-history-close-btn"
                >
                    ✕
                </button>
            </div>

            {!gitInitialized ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 px-4 text-center">
                    <span className="text-2xl">🔒</span>
                    <p className="text-xs text-[#848484] dark:text-[#666] italic">
                        Git tracking is not enabled for this workspace.
                    </p>
                    <p className="text-[10px] text-[#0078d4] dark:text-[#3794ff]">
                        Enable it in Repo Settings → Notes tab.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Save checkpoint form */}
                    <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <p className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-1">
                            Save named checkpoint
                        </p>
                        <div className="flex gap-1">
                            <input
                                type="text"
                                className="flex-1 text-xs px-2 py-1 rounded border border-[#ccc] dark:border-[#555] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#aaa] focus:outline-none focus:border-[#0078d4]"
                                placeholder="Checkpoint name…"
                                value={checkpointName}
                                onChange={e => setCheckpointName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveCheckpoint(); }}
                                disabled={savingCheckpoint}
                                data-testid="checkpoint-name-input"
                            />
                            <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={handleSaveCheckpoint}
                                disabled={savingCheckpoint || !checkpointName.trim()}
                                data-testid="checkpoint-save-btn"
                            >
                                {savingCheckpoint ? '…' : 'Save'}
                            </button>
                        </div>
                        {checkpointError && (
                            <p className="text-[10px] text-red-500 mt-1" data-testid="checkpoint-error">
                                {checkpointError}
                            </p>
                        )}
                    </div>

                    {/* Restore status messages */}
                    {restoreSuccess && (
                        <div className="px-3 py-1.5 text-[10px] text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="restore-success">
                            ✓ Version restored successfully.
                        </div>
                    )}
                    {restoreError && (
                        <div className="px-3 py-1.5 text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="restore-error">
                            {restoreError}
                        </div>
                    )}

                    {/* Version list */}
                    <div className="flex-1 overflow-y-auto">
                        {loading && (
                            <div className="flex items-center gap-2 justify-center py-6 text-xs text-[#848484]" data-testid="version-history-loading">
                                <Spinner size="sm" /> Loading history…
                            </div>
                        )}

                        {error && !loading && (
                            <div className="px-3 py-2" data-testid="version-history-error">
                                <span className="text-xs text-red-500">{error}</span>
                                <button className="ml-2 text-xs text-[#0078d4] underline" onClick={loadHistory}>
                                    Retry
                                </button>
                            </div>
                        )}

                        {!loading && !error && versions.length === 0 && (
                            <div
                                className="flex flex-col items-center justify-center py-8 gap-2 text-xs text-[#848484] dark:text-[#666] italic"
                                data-testid="version-history-empty"
                            >
                                <span className="text-2xl">📜</span>
                                <span>No history for this file yet.</span>
                            </div>
                        )}

                        {!loading && !error && versions.length > 0 && (
                            <>
                                {/* Named checkpoints section */}
                                {checkpoints.length > 0 && (
                                    <>
                                        <div className="px-3 py-1 bg-[#f0f6ff] dark:bg-[#1a2a3a] text-[10px] font-semibold text-[#0078d4] dark:text-[#3794ff] sticky top-0">
                                            📌 Named Checkpoints
                                        </div>
                                        {checkpoints.map(v => (
                                            <VersionRow
                                                key={v.hash}
                                                version={v}
                                                onPreview={setPreviewVersion}
                                                onRestore={handleRestore}
                                                restoring={restoring}
                                            />
                                        ))}
                                    </>
                                )}

                                {/* Auto-commits section */}
                                {autoCommits.length > 0 && (
                                    <>
                                        <div className="px-3 py-1 bg-[#f5f5f5] dark:bg-[#252525] text-[10px] font-semibold text-[#616161] dark:text-[#999] sticky top-0">
                                            🔄 Auto-commits
                                        </div>
                                        {autoCommits.map(v => (
                                            <VersionRow
                                                key={v.hash}
                                                version={v}
                                                onPreview={setPreviewVersion}
                                                onRestore={handleRestore}
                                                restoring={restoring}
                                            />
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Preview dialog */}
            {previewVersion && (
                <PreviewDialog
                    version={previewVersion}
                    workspaceId={workspaceId}
                    notePath={notePath}
                    currentContent={currentContent}
                    onClose={() => setPreviewVersion(null)}
                    onRestore={(v) => { handleRestore(v); setPreviewVersion(null); }}
                />
            )}
        </div>
    );
}
