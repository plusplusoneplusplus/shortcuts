/**
 * RalphLaunchDialog — lightweight dialog for launching Ralph directly from
 * reviewed goal text. Used by goal-file launch and New Chat direct-goal launch.
 */
import { useEffect, useState } from 'react';
import { ModalJobAiControls, useModalJobAiSelection } from './ModalJobAiControls';
import type { ResolvedModalJobAiSelection } from './ModalJobAiControls';
import {
    getRalphExecutionRepoApiBase,
    isSameRalphExecutionTarget,
    RalphExecutionRepoSelector,
    useRalphExecutionRepoTargets,
} from './RalphExecutionRepoSelector';

export interface RalphLaunchDialogProps {
    open: boolean;
    workspaceId: string;
    /** Display name of the source file (e.g., "auth-refactor.goal.md") */
    sourceLabel: string;
    /** The goal spec content (markdown from the editor) */
    goalSpec: string;
    /** Working directory / folder path for the Ralph session */
    folderPath?: string;
    /** Explicit working directory for the Ralph session when it differs from folderPath */
    workingDirectory?: string;
    /** Allow the user to edit the reviewed goal text before launching */
    editable?: boolean;
    /** Use a caller-owned New Chat AI selection instead of rendering modal controls */
    resolvedAiSelection?: ResolvedModalJobAiSelection;
    /** Attachments are out of scope for direct-goal launch and block confirmation */
    attachmentCount?: number;
    title?: string;
    confirmLabel?: string;
    onClose: () => void;
    /** Called with the new processId after successful launch */
    onLaunched: (processId: string, workspaceId?: string) => void | Promise<void>;
}

export function RalphLaunchDialog({
    open,
    workspaceId,
    sourceLabel,
    goalSpec,
    folderPath,
    workingDirectory,
    editable = false,
    resolvedAiSelection,
    attachmentCount = 0,
    title = '🔄 Launch Ralph Loop',
    confirmLabel = '🔄 Launch Ralph',
    onClose,
    onLaunched,
}: RalphLaunchDialogProps) {
    const repoSelection = useRalphExecutionRepoTargets({ open, sourceWorkspaceId: workspaceId });
    const selectedWorkspaceId = repoSelection.selectedTarget?.workspaceId ?? workspaceId;
    const aiSelection = useModalJobAiSelection({ workspaceId: selectedWorkspaceId, mode: 'ralph' });
    const resolvedAi = resolvedAiSelection ?? aiSelection.resolved;
    const usesExternalAiSelection = !!resolvedAiSelection;
    const [launching, setLaunching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draftGoalSpec, setDraftGoalSpec] = useState(goalSpec);

    useEffect(() => {
        if (!open) return;
        setDraftGoalSpec(goalSpec);
        setError(null);
    }, [goalSpec, open]);

    if (!open) return null;

    const activeGoalSpec = editable ? draftGoalSpec : goalSpec;
    const trimmedGoalSpec = activeGoalSpec.trim();
    const missingGoalHeading = editable && !!trimmedGoalSpec && !/^##\s+Goal\b/im.test(trimmedGoalSpec);
    const attachmentsBlocked = attachmentCount > 0;

    async function handleLaunch() {
        const trimmed = activeGoalSpec.trim();
        if (!trimmed) {
            setError(editable ? 'Goal spec is empty. Enter a goal before launching.' : 'Goal spec is empty. Edit the file in the editor first.');
            return;
        }
        if (attachmentsBlocked) {
            setError(`Remove ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} before starting from a goal. Direct-goal launch sends goal text only.`);
            return;
        }
        const selectedTarget = repoSelection.selectedTarget;
        if (!selectedTarget) {
            setError('Choose a repository before launching Ralph.');
            return;
        }
        setLaunching(true);
        setError(null);
        try {
            const config: Record<string, unknown> = {};
            if (resolvedAi.model) config.model = resolvedAi.model;
            if (resolvedAi.reasoningEffort) config.reasoningEffort = resolvedAi.reasoningEffort;
            if (resolvedAi.effortTier) config.effortTier = resolvedAi.effortTier;
            const sameTarget = isSameRalphExecutionTarget(workspaceId, selectedTarget);
            const body: Record<string, unknown> = { goalSpec: trimmed, workspaceId: selectedTarget.workspaceId };
            if (resolvedAi.provider) body.provider = resolvedAi.provider;
            if (resolvedAi.autoProviderRouting) body.autoProviderRouting = true;
            if (sameTarget && folderPath) body.folderPath = folderPath;
            if (sameTarget && workingDirectory) body.workingDirectory = workingDirectory;
            if (Object.keys(config).length > 0) body.config = config;
            const resp = await fetch(`${getRalphExecutionRepoApiBase(selectedTarget)}/ralph-launch`, {
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
            const processId = typeof result?.processId === 'string' ? result.processId : '';
            if (!processId) {
                throw new Error('Ralph launch did not return a process id');
            }
            await onLaunched(processId, selectedTarget.workspaceId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to launch Ralph');
        } finally {
            setLaunching(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="ralph-launch-dialog"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-[#252526] rounded-lg shadow-xl w-full max-w-lg mx-4 border border-[#e0e0e0] dark:border-[#3c3c3c]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="px-4 py-3 space-y-3">
                    {/* Source label */}
                    <div className="text-xs text-[#848484]">
                        Goal source: <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{sourceLabel}</span>
                    </div>

                    <RalphExecutionRepoSelector
                        groups={repoSelection.groups}
                        loading={repoSelection.loading}
                        loadError={repoSelection.loadError}
                        warnings={repoSelection.warnings}
                        selectedKey={repoSelection.selectedKey}
                        onSelectedKeyChange={repoSelection.setSelectedKey}
                        disabled={launching}
                        testIdPrefix="ralph-launch"
                    />

                    {/* Provider/model/effort selector */}
                    <div>
                        <div className="block text-xs text-[#848484] mb-1">
                            Agent:
                        </div>
                        {usesExternalAiSelection ? (
                            <div
                                className="text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1f1f1f] px-2 py-1 text-[#5a5a5a] dark:text-[#cccccc]"
                                data-testid="ralph-launch-ai-summary"
                            >
                                <span className="font-medium">{resolvedAi.provider ?? 'Auto'}</span>
                                <span className="text-[#848484]">
                                    {resolvedAi.effortTier
                                        ? <> {' '}· effort tier: {resolvedAi.effortTier}</>
                                        : <>
                                            {' '}· model: {resolvedAi.model ?? 'workspace default'}
                                            {' '}· effort: {resolvedAi.reasoningEffort ?? 'auto'}
                                        </>}
                                </span>
                            </div>
                        ) : (
                            <ModalJobAiControls
                                selection={aiSelection}
                                disabled={launching}
                                testIdPrefix="ralph-launch"
                            />
                        )}
                    </div>

                    {/* Goal preview */}
                    <div>
                        <div className="text-xs text-[#848484] mb-1">{editable ? 'Review goal:' : 'Goal preview:'}</div>
                        <textarea
                            readOnly={!editable}
                            data-testid="ralph-goal-preview"
                            value={activeGoalSpec}
                            onChange={(e) => {
                                setDraftGoalSpec(e.target.value);
                                if (error) setError(null);
                            }}
                            rows={8}
                            className={
                                'w-full rounded border border-[#d0d0d0] dark:border-[#4a4a4a] text-xs text-[#1e1e1e] dark:text-[#cccccc] p-2 font-mono resize-y ' +
                                (editable
                                    ? 'bg-white dark:bg-[#1a1a1a]'
                                    : 'bg-[#f5f5f5] dark:bg-[#1a1a1a]')
                            }
                        />
                        <div className="text-[10px] text-[#848484] mt-0.5">
                            {editable ? 'Edits here are used only for this launch and do not change the composer draft.' : 'Read-only preview — edit in the editor above'}
                        </div>
                    </div>

                    {missingGoalHeading && (
                        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="ralph-goal-heading-warning">
                            Warning: this text does not contain a ## Goal heading. You can still launch if this is intentional.
                        </p>
                    )}

                    {attachmentsBlocked && (
                        <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="ralph-launch-attachment-warning">
                            Direct-goal launch sends goal text only. Remove {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'} before confirming.
                        </p>
                    )}

                    {/* Error */}
                    {error && (
                        <p className="text-xs text-[#f14c4c]" data-testid="ralph-launch-error">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={launching}
                        className="text-sm px-3 py-1.5 text-[#5a5a5a] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        data-testid="ralph-launch-confirm-btn"
                        onClick={handleLaunch}
                        disabled={launching || repoSelection.loading || !repoSelection.selectedTarget || (editable && !trimmedGoalSpec) || attachmentsBlocked}
                        className={
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors ' +
                            (launching || repoSelection.loading || !repoSelection.selectedTarget || (editable && !trimmedGoalSpec) || attachmentsBlocked
                                ? 'bg-purple-400 cursor-not-allowed'
                                : 'bg-purple-600 hover:bg-purple-700')
                        }
                    >
                        {launching ? '⏳ Launching…' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
