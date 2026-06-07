/**
 * RalphStartPanel — shown below a completed grilling-phase process,
 * or when a goal.md / *.goal.md file was created during the conversation.
 *
 * Source of the goal spec (independent of endpoint):
 * - **File-based:** when `goalFilePath` is set, reads the goal spec from that
 *   file via `/api/fs/blob`. This is preferred whenever a goal file exists,
 *   because the file is the authoritative spec — the last assistant turn is
 *   often a short synthesis/confirmation that drops detail.
 * - **Turn-based fallback:** when no `goalFilePath` is provided, extracts the
 *   goal spec from the last assistant turn (looking for a `## Goal` block).
 *
 * Endpoint (independent of source):
 * - When `useLaunchEndpoint` is true, posts to `/api/ralph-launch` (mints a
 *   fresh Ralph session — used when a goal file was authored outside any
 *   grilling-phase process).
 * - Otherwise, posts to `/api/processes/:id/ralph-start` (continues a
 *   completed grilling-phase process).
 */
import { useState, useEffect } from 'react';
import { getApiBase } from '../../utils/config';
import { cn } from '../../ui/cn';
import type { ClientConversationTurn } from '../../types/dashboard';
import { ModalJobAiControls, useModalJobAiSelection } from '../../shared/ModalJobAiControls';

export interface RalphStartPanelProps {
    processId: string;
    workspaceId?: string;
    turns: ClientConversationTurn[];
    onStarted: (newProcessId: string) => void;
    /**
     * Optional path to a goal spec file. When set, the panel loads the goal
     * text from this file instead of extracting it from the conversation
     * turns. Independent of which endpoint is called.
     */
    goalFilePath?: string;
    /**
     * When true, confirm posts to `/api/ralph-launch` (mints a fresh session).
     * When false/unset, confirm posts to `/api/processes/:id/ralph-start`
     * (continues the referenced grilling-phase process). Default: false.
     */
    useLaunchEndpoint?: boolean;
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

export function RalphStartPanel({ processId, workspaceId, turns, onStarted, goalFilePath, useLaunchEndpoint }: RalphStartPanelProps) {
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ralph' });
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
            // Endpoint is controlled by `useLaunchEndpoint`, independent of
            // whether the goal came from a file. Grilling-phase callers pass a
            // `goalFilePath` to load the file's content but keep the
            // ralph-start endpoint so the existing process/session is reused.
            const url = useLaunchEndpoint
                ? `${getApiBase()}/ralph-launch`
                : `${getApiBase()}/processes/${encodeURIComponent(processId)}/ralph-start`;
            const resolvedAi = aiSelection.resolved;
            const config: Record<string, unknown> = {};
            if (resolvedAi.model) config.model = resolvedAi.model;
            if (resolvedAi.reasoningEffort) config.reasoningEffort = resolvedAi.reasoningEffort;
            if (resolvedAi.effortTier) config.effortTier = resolvedAi.effortTier;
            const body: Record<string, unknown> = { goalSpec: trimmed, workspaceId };
            if (resolvedAi.provider) body.provider = resolvedAi.provider;
            if (resolvedAi.autoProviderRouting) body.autoProviderRouting = true;
            if (Object.keys(config).length > 0) body.config = config;
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
            <div>
                <div className="block text-xs text-[#848484] mb-1">
                    Agent:
                </div>
                <ModalJobAiControls
                    selection={aiSelection}
                    disabled={starting || loadingFile}
                    testIdPrefix="ralph-start"
                />
            </div>
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
