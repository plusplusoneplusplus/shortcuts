/**
 * BoundedMemoryTab — repo-scoped MEMORY.md viewer/editor.
 *
 * Shows MEMORY.md content for the current repo's workspace with
 * capacity bar and inline editor.
 */

import { useState, useEffect, useCallback } from 'react';
import { memoryApi } from './memoryApi';
import { CapacityBar } from '../../shared/CapacityBar';

interface BoundedMemoryTabProps {
    repoId: string;
}

export function BoundedMemoryTab({ repoId }: BoundedMemoryTabProps) {
    const [content, setContent] = useState<string>('');
    const [charCount, setCharCount] = useState(0);
    const [charLimit, setCharLimit] = useState(0);
    const [lastModified, setLastModified] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Edit state
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const fetchContent = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await memoryApi.getBounded(repoId);
            setContent(data.content);
            setCharCount(data.charCount);
            setCharLimit(data.charLimit);
            setLastModified(data.lastModified);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load memory');
        } finally {
            setLoading(false);
        }
    }, [repoId]);

    useEffect(() => { fetchContent(); }, [fetchContent]);

    const handleStartEdit = () => {
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
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap" data-testid="bounded-toolbar">
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
                {!editing ? (
                    <button
                        onClick={handleStartEdit}
                        className="text-xs px-2.5 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4]/10 transition-colors"
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
                        No memory entries yet. The AI will populate this during conversations.
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
        </div>
    );
}
