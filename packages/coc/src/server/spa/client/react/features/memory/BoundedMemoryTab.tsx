/**
 * BoundedMemoryTab — repo-scoped MEMORY.md viewer/editor.
 *
 * Shows MEMORY.md content for the current repo's workspace with
 * capacity bar, pipeline status strip, and inline editor.
 * Includes an "Aggregate Now" toolbar button that opens the AggregatePanel dialog.
 */

import { useState, useEffect, useCallback, useContext } from 'react';
import { memoryApi } from './memoryApi';
import type { MemoryStats } from './memoryApi';
import { CapacityBar } from '../../ui/CapacityBar';
import { ToastContext } from '../../contexts/ToastContext';
import { getWorkspacePreferences, patchWorkspacePreferences, type PerRepoPrefsClient } from '../../hooks/preferences/preferencesApi';
import { PipelineStatusStrip } from './PipelineStatusStrip';
import { AggregatePanel } from './AggregatePanel';

interface BoundedMemoryTabProps {
    repoId: string;
}

export function BoundedMemoryTab({ repoId }: BoundedMemoryTabProps) {
    const toastCtx = useContext(ToastContext);
    const [content, setContent] = useState<string>('');
    const [charCount, setCharCount] = useState(0);
    const [charLimit, setCharLimit] = useState(0);
    const [lastModified, setLastModified] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [prefCharLimit, setPrefCharLimit] = useState<number | undefined>(undefined);
    const [writeFrequency, setWriteFrequency] = useState<'low' | 'medium' | 'high'>('medium');
    const [toggleSaving, setToggleSaving] = useState(false);
    const [toggleError, setToggleError] = useState<string | null>(null);

    // Edit state
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Pipeline overview state
    const [overviewStats, setOverviewStats] = useState<MemoryStats | null>(null);
    const [aggregatePanelOpen, setAggregatePanelOpen] = useState(false);

    const fetchOverview = useCallback(async () => {
        try {
            const stats = await memoryApi.getOverview(repoId);
            setOverviewStats(stats);
        } catch {
            // Non-critical — strip just stays hidden
        }
    }, [repoId]);

    const fetchContent = useCallback(async () => {
        setLoading(true);
        setError(null);
        setToggleError(null);
        try {
            const [data, prefs] = await Promise.all([
                memoryApi.getBounded(repoId),
                getWorkspacePreferences(repoId).catch((): PerRepoPrefsClient => ({})),
            ]);
            setContent(data.content);
            setCharCount(data.charCount);
            setCharLimit(data.charLimit);
            setLastModified(data.lastModified);
            setEnabled(prefs.boundedMemory?.enabled === true);
            setPrefCharLimit(
                typeof prefs.boundedMemory?.charLimit === 'number' && prefs.boundedMemory.charLimit > 0
                    ? prefs.boundedMemory.charLimit
                    : undefined
            );
            setWriteFrequency(prefs.boundedMemory?.writeFrequency ?? 'medium');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load memory');
        } finally {
            setLoading(false);
        }
    }, [repoId]);

    useEffect(() => { fetchContent(); }, [fetchContent]);
    useEffect(() => { if (enabled) fetchOverview(); }, [enabled, fetchOverview]);

    const handleAggregateClose = () => setAggregatePanelOpen(false);
    const handleAggregateDone = () => {
        fetchContent();
        fetchOverview();
    };

    const handleToggleEnabled = async () => {
        const nextEnabled = !enabled;
        const prevEnabled = enabled;

        setEnabled(nextEnabled);
        setToggleSaving(true);
        setToggleError(null);

        if (!nextEnabled) {
            setEditing(false);
            setSaveError(null);
        }

        try {
            await patchWorkspacePreferences(repoId, {
                boundedMemory: {
                    enabled: nextEnabled,
                    ...(typeof prefCharLimit === 'number' ? { charLimit: prefCharLimit } : {}),
                    writeFrequency,
                },
            });
            toastCtx?.addToast(
                nextEnabled ? 'Memory enabled for this repo' : 'Memory disabled for this repo',
                'success'
            );
        } catch (e: any) {
            const message = e?.message ?? 'Failed to save memory setting';
            setEnabled(prevEnabled);
            setToggleError(message);
            toastCtx?.addToast(message, 'error');
        } finally {
            setToggleSaving(false);
        }
    };

    const handleWriteFrequencyChange = async (level: 'low' | 'medium' | 'high') => {
        const prev = writeFrequency;
        setWriteFrequency(level);
        try {
            await patchWorkspacePreferences(repoId, {
                boundedMemory: {
                    enabled,
                    ...(typeof prefCharLimit === 'number' ? { charLimit: prefCharLimit } : {}),
                    writeFrequency: level,
                },
            });
            toastCtx?.addToast(`Memory write frequency set to ${level}`, 'success');
        } catch (e: any) {
            setWriteFrequency(prev);
            toastCtx?.addToast(e?.message ?? 'Failed to save frequency setting', 'error');
        }
    };

    const handleStartEdit = () => {
        if (!enabled) return;
        setEditing(true);
        setEditContent(content);
        setSaveError(null);
    };

    const handleCancelEdit = () => {
        setEditing(false);
        setSaveError(null);
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);
        try {
            const data = await memoryApi.saveBounded(repoId, editContent);
            setContent(editContent);
            setCharCount(data.charCount);
            setCharLimit(data.charLimit);
            setLastModified(data.lastModified);
            setEditing(false);
        } catch (e: any) {
            setSaveError(e?.message ?? 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = async () => {
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback: ignored
        }
    };

    const editCharCount = editContent.length;

    return (
        <div data-testid="bounded-memory-tab" className="pt-3">
            <div
                className="mb-3 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] p-3"
                data-testid="bounded-memory-toggle-card"
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            Enable Memory for this Repo
                        </h4>
                        <p className="mt-1 text-xs text-[#616161] dark:text-[#999]">
                            Let CoC store and reuse important repo facts in future chats.
                        </p>
                    </div>

                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        onClick={handleToggleEnabled}
                        disabled={toggleSaving}
                        className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                            enabled
                                ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4]'
                                : 'border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#616161] dark:text-[#999]'
                        }`}
                        data-testid="memory-enabled-toggle"
                    >
                        <span>{enabled ? 'On' : 'Off'}</span>
                        <span
                            className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-[#0078d4]' : 'bg-[#999]'}`}
                            aria-hidden="true"
                        />
                    </button>
                </div>

                {!enabled && (
                    <p
                        className="mt-2 text-xs text-[#616161] dark:text-[#b3b3b3]"
                        data-testid="memory-disabled-message"
                    >
                        Memory is off for this repo. Stored content stays here, but it will not be injected into
                        future chats until you turn it back on.
                    </p>
                )}

                {toggleError && (
                    <p className="mt-2 text-xs text-red-500" data-testid="memory-toggle-error">
                        {toggleError}
                    </p>
                )}

                {/* Write frequency selector */}
                <div className={`mt-3 ${!enabled ? 'opacity-50 pointer-events-none' : ''}`} data-testid="write-frequency-section">
                    <label className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1.5">
                        Write Frequency
                    </label>
                    <p className="text-xs text-[#616161] dark:text-[#999] mb-2">
                        How aggressively the AI saves facts to memory during conversations.
                    </p>
                    <div className="inline-flex rounded border border-[#c8c8c8] dark:border-[#555] overflow-hidden" data-testid="write-frequency-selector">
                        {(['low', 'medium', 'high'] as const).map((level) => (
                            <button
                                key={level}
                                type="button"
                                onClick={() => handleWriteFrequencyChange(level)}
                                disabled={!enabled}
                                className={`px-3 py-1 text-xs font-medium capitalize transition-colors ${
                                    writeFrequency === level
                                        ? 'bg-[#0078d4] text-white'
                                        : 'bg-white dark:bg-[#1e1e1e] text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                                } ${level !== 'low' ? 'border-l border-[#c8c8c8] dark:border-[#555]' : ''}`}
                                data-testid={`write-frequency-${level}`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Pipeline status strip */}
            {enabled && <PipelineStatusStrip stats={overviewStats} />}

            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap mt-3" data-testid="bounded-toolbar">
                <span className="text-xs text-[#848484] flex-1">
                    MEMORY.md {lastModified ? `· Updated ${new Date(lastModified).toLocaleDateString()}` : ''}
                </span>
                {content && !editing && (
                    <button
                        onClick={handleCopy}
                        className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                        data-testid="bounded-copy-btn"
                    >
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                )}
                <button
                    onClick={fetchContent}
                    className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                    data-testid="bounded-refresh-btn"
                >
                    Refresh
                </button>
                {enabled && !editing && (
                    <button
                        onClick={() => setAggregatePanelOpen(true)}
                        className="text-xs px-2.5 py-1 rounded border border-[#0078d4]/60 text-[#0078d4] hover:bg-[#0078d4]/10 transition-colors"
                        data-testid="bounded-aggregate-btn"
                    >
                        Aggregate Now ▶
                    </button>
                )}
                {!editing ? (
                    <button
                        onClick={handleStartEdit}
                        disabled={!enabled}
                        className="text-xs px-2.5 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4]/10 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                        data-testid="bounded-edit-btn"
                    >
                        Edit
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handleCancelEdit}
                            className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#0078d4]/90 transition-colors disabled:opacity-50"
                            data-testid="bounded-save-btn"
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </>
                )}
            </div>

            {/* Capacity bar */}
            {charLimit > 0 && (
                <CapacityBar
                    charCount={editing ? editCharCount : charCount}
                    charLimit={charLimit}
                    className="mb-3"
                />
            )}

            {/* Content */}
            <div className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-y-auto max-h-[60vh]">
                {loading ? (
                    <div className="text-xs text-[#848484] py-4 text-center" data-testid="bounded-loading">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="text-xs text-red-500 py-4 px-3" data-testid="bounded-error">
                        {error}
                    </div>
                ) : editing ? (
                    <div className="p-3 space-y-2">
                        <textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full h-48 px-3 py-2 text-xs font-mono border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-y"
                            data-testid="bounded-editor"
                        />
                        {editCharCount > charLimit && (
                            <p className="text-xs text-red-500">
                                Content exceeds limit ({editCharCount.toLocaleString()}/{charLimit.toLocaleString()} chars)
                            </p>
                        )}
                        {saveError && <p className="text-xs text-red-500" data-testid="bounded-save-error">{saveError}</p>}
                    </div>
                ) : !content ? (
                    <div className="text-xs text-[#848484] py-8 text-center" data-testid="bounded-empty">
                        {enabled
                            ? 'No memory entries yet. The AI will populate this during conversations.'
                            : 'Memory is off for this repo. Turn it on to let CoC capture and reuse repo facts.'}
                    </div>
                ) : (
                    <pre
                        className="text-xs text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap break-words m-0 p-3 font-mono leading-relaxed"
                        data-testid="bounded-content"
                    >
                        {content}
                    </pre>
                )}
            </div>

            {/* Aggregate panel dialog */}
            {aggregatePanelOpen && (
                <AggregatePanel
                    repoId={repoId}
                    pendingRawCount={overviewStats?.pendingRawCount}
                    consolidationStatus={overviewStats?.consolidationStatus}
                    consolidationProcessId={overviewStats?.consolidationProcessId}
                    consolidationTaskId={overviewStats?.consolidationTaskId}
                    onClose={handleAggregateClose}
                    onDone={handleAggregateDone}
                />
            )}
        </div>
    );
}
