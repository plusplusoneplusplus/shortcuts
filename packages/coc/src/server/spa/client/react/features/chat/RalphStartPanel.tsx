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
import { cloneApiBase } from '../../repos/cloneRegistry';
import { cn } from '../../ui/cn';
import type { ClientConversationTurn } from '../../types/dashboard';
import { ModalJobAiControls, useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import {
    getRalphExecutionRepoApiBase,
    isSameRalphExecutionTarget,
    RalphExecutionRepoSelector,
    useRalphExecutionRepoTargets,
} from '../../shared/RalphExecutionRepoSelector';

export interface RalphStartPanelProps {
    processId: string;
    workspaceId?: string;
    turns: ClientConversationTurn[];
    onStarted: (newProcessId: string, workspaceId?: string) => void;
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

function renderRalphGlyph() {
    return (
        <span
            className="shrink-0 inline-flex h-[18px] w-[18px] items-center justify-center rounded-md bg-purple-600 text-white dark:bg-purple-500"
            aria-hidden="true"
        >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.4 8a5.4 5.4 0 1 1-1.58-3.82" />
                <path d="M13.4 2.8v3.5H9.9" />
                <path d="M2.6 8a5.4 5.4 0 0 1 9.22-3.82" />
                <path d="M2.6 13.2V9.7h3.5" />
            </svg>
        </span>
    );
}

export function RalphStartPanel({ processId, workspaceId, turns, onStarted, goalFilePath, useLaunchEndpoint }: RalphStartPanelProps) {
    const [open, setOpen] = useState(false);
    const repoSelection = useRalphExecutionRepoTargets({ open, sourceWorkspaceId: workspaceId });
    const selectedWorkspaceId = repoSelection.selectedTarget?.workspaceId ?? workspaceId;
    const aiSelection = useModalJobAiSelection({ workspaceId: selectedWorkspaceId, mode: 'ralph' });
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
                    `${cloneApiBase(workspaceId)}/fs/blob?path=${encodeURIComponent(goalFilePath)}`,
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
        const selectedTarget = repoSelection.selectedTarget;
        if (!selectedTarget) { setError('Choose a repository before starting Ralph.'); return; }
        setStarting(true);
        setError(null);
        try {
            // Endpoint is controlled by `useLaunchEndpoint`, independent of
            // whether the goal came from a file. Grilling-phase callers pass a
            // `goalFilePath` to load the file's content but keep the
            // ralph-start endpoint so the existing process/session is reused.
            const sameSourceTarget = isSameRalphExecutionTarget(workspaceId, selectedTarget);
            const targetApiBase = getRalphExecutionRepoApiBase(selectedTarget);
            const url = useLaunchEndpoint || !sameSourceTarget
                ? `${targetApiBase}/ralph-launch`
                : `${targetApiBase}/processes/${encodeURIComponent(processId)}/ralph-start`;
            const resolvedAi = aiSelection.resolved;
            const config: Record<string, unknown> = {};
            if (resolvedAi.model) config.model = resolvedAi.model;
            if (resolvedAi.reasoningEffort) config.reasoningEffort = resolvedAi.reasoningEffort;
            if (resolvedAi.effortTier) config.effortTier = resolvedAi.effortTier;
            const body: Record<string, unknown> = { goalSpec: trimmed, workspaceId: selectedTarget.workspaceId };
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
            onStarted(result.processId, selectedTarget.workspaceId);
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
        const bannerText = goalFileName
            ? `Goal spec: ${goalFileName}`
            : 'Goal spec ready for execution';

        return (
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-2" data-testid="ralph-start-banner">
                <button
                    type="button"
                    data-testid="ralph-start-btn"
                    onClick={handleOpen}
                    className={cn(
                        'group flex w-full items-center gap-2 rounded-lg border border-[#d0d7de] bg-[#f6f8fa] px-3 py-1.5 text-left text-xs',
                        'text-[#1f2328] transition-colors hover:border-purple-300 hover:bg-purple-50/60',
                        'dark:border-[#3c3c3c] dark:bg-[#161b22] dark:text-[#c9d1d9] dark:hover:border-purple-500/60 dark:hover:bg-purple-500/10',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40',
                    )}
                >
                    {renderRalphGlyph()}
                    <span className="shrink-0 font-semibold">Ralph ready</span>
                    <span
                        className="min-w-0 flex-1 truncate text-[#57606a] dark:text-[#8b949e]"
                        data-testid="ralph-start-description"
                        title={bannerText}
                    >
                        {bannerText}
                    </span>
                    <span className="shrink-0 inline-flex h-[22px] items-center rounded-md bg-purple-600 px-2 text-[11px] font-medium text-white group-hover:bg-purple-700 dark:bg-purple-500 dark:group-hover:bg-purple-400">
                        Start Ralph
                    </span>
                </button>
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex-1 min-w-0">
                    <RalphExecutionRepoSelector
                        groups={repoSelection.groups}
                        loading={repoSelection.loading}
                        loadError={repoSelection.loadError}
                        warnings={repoSelection.warnings}
                        selectedKey={repoSelection.selectedKey}
                        onSelectedKeyChange={repoSelection.setSelectedKey}
                        disabled={starting || loadingFile}
                        testIdPrefix="ralph-start"
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="block text-xs text-[#848484] mb-1">
                        Agent:
                    </div>
                    <ModalJobAiControls
                        selection={aiSelection}
                        disabled={starting || loadingFile}
                        testIdPrefix="ralph-start"
                    />
                </div>
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
                    disabled={starting || loadingFile || repoSelection.loading || !repoSelection.selectedTarget}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors',
                        starting || loadingFile || repoSelection.loading || !repoSelection.selectedTarget
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
