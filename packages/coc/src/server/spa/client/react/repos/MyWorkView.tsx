/**
 * MyWorkView — landing page for the "My Work" virtual workspace.
 *
 * Renders the notes system for the `my_work` workspace with an extra
 * toolbar for syncing from Work IQ and generating weekly summaries.
 */

import { useState, useCallback } from 'react';
import { NotesView } from './NotesView';
import { fetchApi } from '../hooks/useApi';
import { useApp } from '../context/AppContext';

export const MY_WORK_WORKSPACE_ID = 'my_work';

export function MyWorkView() {
    const { state } = useApp();
    const [syncing, setSyncing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    const handleSync = useCallback(async () => {
        setSyncing(true);
        setStatusMsg(null);
        try {
            const result = await fetchApi('/my-work/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const count = (result.actionItemCount ?? 0) + (result.followUpCount ?? 0);
            setStatusMsg(count > 0 ? `Synced ${count} items` : 'No new items');
            setTimeout(() => setStatusMsg(null), 4000);
        } catch (err: any) {
            setStatusMsg(`Sync failed: ${err.message}`);
        } finally {
            setSyncing(false);
        }
    }, []);

    const handleGenerateSummary = useCallback(async () => {
        setGenerating(true);
        setStatusMsg(null);
        try {
            const result = await fetchApi('/my-work/generate-summary', {
                method: 'POST',
            });
            if (result.path) {
                setStatusMsg(`Summary saved to ${result.path}`);
                // Navigate to the generated summary note
                location.hash = `#repos/${MY_WORK_WORKSPACE_ID}/notes/${encodeURIComponent(result.path)}`;
            }
            setTimeout(() => setStatusMsg(null), 4000);
        } catch (err: any) {
            setStatusMsg(`Generation failed: ${err.message}`);
        } finally {
            setGenerating(false);
        }
    }, []);

    return (
        <div className="flex flex-col h-full" data-testid="my-work-view">
            {/* Toolbar */}
            <div
                className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#2d2d2d] flex-shrink-0"
                data-testid="my-work-toolbar"
            >
                <span className="text-sm font-semibold text-[#333] dark:text-[#ccc] mr-2">
                    📋 My Work
                </span>
                <button
                    className="text-xs px-2.5 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#4a4a4a] text-[#333] dark:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={handleSync}
                    disabled={syncing}
                    data-testid="my-work-sync-btn"
                    title="Sync action items and follow-ups from Work IQ"
                >
                    {syncing ? '⏳ Syncing…' : '🔄 Sync Work IQ'}
                </button>
                <button
                    className="text-xs px-2.5 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#4a4a4a] text-[#333] dark:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={handleGenerateSummary}
                    disabled={generating}
                    data-testid="my-work-generate-btn"
                    title="Generate a weekly summary from your notes and cross-repo activity"
                >
                    {generating ? '⏳ Generating…' : '📝 Generate Summary'}
                </button>
                {statusMsg && (
                    <span className="text-xs text-[#666] dark:text-[#999] ml-2" data-testid="my-work-status">
                        {statusMsg}
                    </span>
                )}
                <div className="flex-1" />
            </div>

            {/* Notes view (reused as-is) */}
            <div className="flex-1 min-h-0">
                <NotesView
                    workspaceId={MY_WORK_WORKSPACE_ID}
                    initialNotePath={state.selectedNotePath}
                />
            </div>
        </div>
    );
}
