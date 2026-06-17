/**
 * WorkItemExecuteDialog — modal for selecting skills plus optional AI
 * provider/model/reasoning controls before executing a work item.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button } from '../../ui';
import { useRecentSkills } from '../../features/skills/hooks/useRecentSkills';
import { useCocClient } from '../../repos/cloneRouting';
import { RunSkillPanel } from '../../shared/RunSkillPanel';
import type { SkillItem } from '../../shared/RunSkillPanel';
import { ModalJobAiControls, useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import { resolveWorkItemOriginId } from './workItemOriginScope';

type WorkItemExecutionMode = 'one-shot' | 'ralph';

export interface WorkItemExecuteDialogProps {
    open: boolean;
    workspaceId: string;
    originId?: string;
    workItemId: string;
    workItemTitle: string;
    defaultExecutionMode?: WorkItemExecutionMode;
    allowExecutionModeSelection?: boolean;
    onClose: () => void;
    onExecuted: () => void;
}

export function WorkItemExecuteDialog({
    open,
    workspaceId,
    originId,
    workItemId,
    workItemTitle,
    defaultExecutionMode = 'one-shot',
    allowExecutionModeSelection = false,
    onClose,
    onExecuted,
}: WorkItemExecuteDialogProps) {
    const cloneClient = useCocClient(workspaceId); // AC-07: execute on the selected clone's server.
    const workItemOriginId = originId ?? resolveWorkItemOriginId({ workspaceId });
    const { recentItems, trackUsage } = useRecentSkills(workspaceId);
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'autopilot' });

    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [executionMode, setExecutionMode] = useState<WorkItemExecutionMode>(defaultExecutionMode);
    const [additionalInfo, setAdditionalInfo] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch merged global+repo skills
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                // AC-07: skills load from the selected clone's server (remote clones
                // route to their own host; local clones hit the default origin).
                const data = await cloneClient.request<{ skills?: SkillItem[] }>(
                    '/workspaces/' + encodeURIComponent(workspaceId) + '/skills',
                );
                if (cancelled) return;
                setSkills(data?.skills ?? []);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, workspaceId, cloneClient]);

    const toggleSkill = useCallback((name: string) => {
        setSelectedSkills(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name],
        );
    }, []);

    useEffect(() => {
        if (open) setExecutionMode(defaultExecutionMode);
    }, [defaultExecutionMode, open]);

    const handleSubmit = useCallback(async (skillNames: string[]) => {
        if (skillNames.length === 0) return;
        setSubmitting(true);
        setError(null);
        try {
            await cloneClient.workItems.executeForOrigin(workItemOriginId, workItemId, {
                ...(allowExecutionModeSelection ? { executionMode } : {}),
                skillNames,
                ...(aiSelection.resolved.provider ? { provider: aiSelection.resolved.provider } : {}),
                ...(aiSelection.resolved.model ? { model: aiSelection.resolved.model } : {}),
                ...(aiSelection.resolved.reasoningEffort ? { reasoningEffort: aiSelection.resolved.reasoningEffort } : {}),
                ...(aiSelection.resolved.effortTier ? { effortTier: aiSelection.resolved.effortTier } : {}),
                ...(aiSelection.resolved.autoProviderRouting ? { autoProviderRouting: true } : {}),
            }, { workspaceId });

            // Track skill usage (fire-and-forget)
            for (const name of skillNames) {
                trackUsage(name);
                cloneClient.preferences.recordSkillUsage(workspaceId, name).catch(() => {});
            }

            onExecuted();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to execute');
        } finally {
            setSubmitting(false);
        }
    }, [workspaceId, workItemOriginId, workItemId, allowExecutionModeSelection, executionMode, aiSelection.resolved, trackUsage, onExecuted, onClose, cloneClient]);

    if (!open) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={`Start Implementing: ${workItemTitle}`}
            id="work-item-execute-dialog"
            footer={
                <Button
                    variant="primary"
                    size="sm"
                    disabled={selectedSkills.length === 0 || submitting}
                    loading={submitting}
                    onClick={() => handleSubmit(selectedSkills)}
                    data-testid="wi-execute-submit"
                >
                    {submitting ? 'Starting…' : '⚡ Start Implementing'}
                </Button>
            }
        >
            <div className="flex flex-col gap-4">
                {allowExecutionModeSelection && (
                    <fieldset className="rounded-md border border-[#d0d7de] dark:border-[#555] p-3" data-testid="wi-execution-mode-fieldset">
                        <legend className="px-1 text-xs font-semibold text-[#57606a] dark:text-[#999]">Execution mode</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <label className="flex cursor-pointer items-start gap-2 rounded border border-[#d0d7de] dark:border-[#555] p-2 text-xs">
                                <input
                                    type="radio"
                                    name="wi-execution-mode"
                                    value="one-shot"
                                    checked={executionMode === 'one-shot'}
                                    onChange={() => setExecutionMode('one-shot')}
                                    disabled={submitting}
                                    data-testid="wi-execution-mode-one-shot"
                                />
                                <span>
                                    <span className="block font-semibold">One-shot</span>
                                    <span className="block text-[11px] text-[#656d76] dark:text-[#999]">Run a single implementation task.</span>
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 rounded border border-[#d0d7de] dark:border-[#555] p-2 text-xs">
                                <input
                                    type="radio"
                                    name="wi-execution-mode"
                                    value="ralph"
                                    checked={executionMode === 'ralph'}
                                    onChange={() => setExecutionMode('ralph')}
                                    disabled={submitting}
                                    data-testid="wi-execution-mode-ralph"
                                />
                                <span>
                                    <span className="block font-semibold">Ralph loop</span>
                                    <span className="block text-[11px] text-[#656d76] dark:text-[#999]">Iterate with progress checks until complete.</span>
                                </span>
                            </label>
                        </div>
                    </fieldset>
                )}
                <RunSkillPanel
                    skills={skills}
                    recentItems={recentItems}
                    models={[]}
                    loading={loading}
                    selectedSkills={selectedSkills}
                    additionalInfo={additionalInfo}
                    model=""
                    submitting={submitting}
                    onSkillToggle={toggleSkill}
                    onSubmitSkills={handleSubmit}
                    onAdditionalInfoChange={setAdditionalInfo}
                    onModelChange={() => {}}
                    selectionMode="multi"
                    submitLabel="⚡ Start Implementing"
                    modelSelectId="wi-exec-model"
                    additionalInfoId="wi-exec-additional-info"
                    aiControls={
                        <ModalJobAiControls
                            selection={aiSelection}
                            disabled={submitting}
                            testIdPrefix="wi-exec"
                        />
                    }
                />

                {error && (
                    <p className="text-xs text-red-600 dark:text-red-400" data-testid="wi-execute-error">
                        {error}
                    </p>
                )}

                <p className="text-[10px] text-[#848484]">
                    Select a skill to guide the AI implementation.
                </p>
            </div>
        </Dialog>
    );
}
