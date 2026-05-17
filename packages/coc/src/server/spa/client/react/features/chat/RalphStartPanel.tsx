/**
 * RalphStartPanel — shown below a completed grilling-phase process,
 * or when a goal.md / *.goal.md file was created during the conversation.
 *
 * Two flows:
 * - **Turn-based (existing):** extracts the goal spec from the last assistant turn.
 * - **File-based (new):** reads goal spec from a goal.md file via /api/fs/blob.
 */
import { useState, useEffect } from 'react';
import { getApiBase } from '../../utils/config';
import { cn } from '../../ui/cn';
import type { ClientConversationTurn } from '../../types/dashboard';

export interface RalphStartPanelProps {
    processId: string;
    workspaceId?: string;
    turns: ClientConversationTurn[];
    onStarted: (newProcessId: string) => void;
    /** When set, reads goal from this file instead of extracting from turns */
    goalFilePath?: string;
}

/** Extract goal spec from last assistant turn: find block starting with ## Goal, or use full content. */
function extractGoalSpec(turns: ClientConversationTurn[]): string {
    const lastAssistant = [...turns].reverse().find(t => t.role === 'assistant');
    if (!lastAssistant) return '';
    const content = typeof lastAssistant.content === 'string' ? lastAssistant.content : '';
    const goalIdx = content.indexOf('## Goal');
    if (goalIdx >= 0) return content.slice(goalIdx).trim();
    return content.trim();
}

export function RalphStartPanel({ processId, workspaceId, turns, onStarted, goalFilePath }: RalphStartPanelProps) {
    const [open, setOpen] = useState(false);
    const [goalSpec, setGoalSpec] = useState('');
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingFile, setLoadingFile] = useState(false);

    async function handleOpen() {
        setError(null);
        setOpen(true);
        if (goalFilePath) {
            // File-based flow: fetch goal content from disk
            setLoadingFile(true);
            try {
                const resp = await fetch(
                    `${getApiBase()}/fs/blob?path=${encodeURIComponent(goalFilePath)}`,
                );
                if (!resp.ok) throw new Error(`Failed to read goal file (HTTP ${resp.status})`);
                const data = await resp.json();
                setGoalSpec(typeof data.content === 'string' ? data.content : '');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to read goal file');
                setGoalSpec('');
            } finally {
                setLoadingFile(false);
            }
        } else {
            // Turn-based flow: extract from last assistant turn
            setGoalSpec(extractGoalSpec(turns));
        }
    }

    async function handleConfirm() {
        const trimmed = goalSpec.trim();
        if (!trimmed) { setError('Goal spec cannot be empty.'); return; }
        setStarting(true);
        setError(null);
        try {
            // Choose endpoint: file-based uses ralph-launch, turn-based uses ralph-start
            const url = goalFilePath
                ? `${getApiBase()}/ralph-launch`
                : `${getApiBase()}/processes/${encodeURIComponent(processId)}/ralph-start`;
            const body = goalFilePath
                ? { goalSpec: trimmed, workspaceId }
                : { goalSpec: trimmed, workspaceId };
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const text = await resp.text();
                let msg = text;
                try {
                    const parsed = JSON.parse(text);
                    if (parsed?.error) msg = parsed.error;
                } catch { /* use raw text */ }
                throw new Error(msg || `HTTP ${resp.status}`);
            }
            const result = await resp.json();
            onStarted(result.processId);
            setOpen(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start Ralph');
        } finally {
            setStarting(false);
        }
    }

    const goalFileName = goalFilePath
        ? goalFilePath.replace(/^.*[/\\]/, '')
        : undefined;

    if (!open) {
        return (
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3">
                <button
                    type="button"
                    data-testid="ralph-start-btn"
                    onClick={handleOpen}
                    className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                >
                    🔄 Start Ralph
                </button>
                <p className="mt-1 text-xs text-[#848484]">
                    {goalFileName
                        ? `Launch the Ralph execution loop using the goal spec from ${goalFileName}.`
                        : 'Review and confirm the goal spec, then start the automated coding loop.'}
                </p>
            </div>
        );
    }

    return (
        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3 space-y-2" data-testid="ralph-start-panel">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    🔄 Review Goal Spec
                </h3>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                    aria-label="Cancel"
                >
                    ✕
                </button>
            </div>
            <p className="text-xs text-[#848484]">
                Edit the goal spec below, then click <strong>Confirm &amp; Start</strong> to begin the Ralph execution loop.
            </p>
            <textarea
                data-testid="ralph-goal-spec-input"
                value={goalSpec}
                onChange={e => setGoalSpec(e.target.value)}
                disabled={starting || loadingFile}
                rows={10}
                className="w-full rounded-md border border-[#d0d0d0] dark:border-[#4a4a4a] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                placeholder={loadingFile ? 'Loading goal file…' : '## Goal\n...'}
            />
            {error && <p className="text-xs text-[#f14c4c]" data-testid="ralph-start-error">{error}</p>}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-testid="ralph-confirm-start-btn"
                    onClick={handleConfirm}
                    disabled={starting}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors',
                        starting
                            ? 'bg-purple-400 cursor-not-allowed'
                            : 'bg-purple-600 hover:bg-purple-700',
                    )}
                >
                    {starting ? '⏳ Starting…' : '✓ Confirm & Start'}
                </button>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={starting}
                    className="text-sm text-[#5a5a5a] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc]"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
