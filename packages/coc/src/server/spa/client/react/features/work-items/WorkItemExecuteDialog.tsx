/**
 * WorkItemExecuteDialog — modal for selecting skills plus optional AI
 * provider/model/reasoning controls before executing a work item.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button } from '../../ui';
import { useRecentSkills } from '../../features/skills/hooks/useRecentSkills';
import { fetchApi } from '../../hooks/useApi';
import { getSpaCocClient } from '../../api/cocClient';
import { RunSkillPanel } from '../../shared/RunSkillPanel';
import type { SkillItem } from '../../shared/RunSkillPanel';
import { ModalJobAiControls, useModalJobAiSelection } from '../../shared/ModalJobAiControls';

export interface WorkItemExecuteDialogProps {
    open: boolean;
    workspaceId: string;
    workItemId: string;
    workItemTitle: string;
    onClose: () => void;
    onExecuted: () => void;
}

export function WorkItemExecuteDialog({
    open,
    workspaceId,
    workItemId,
    workItemTitle,
    onClose,
    onExecuted,
}: WorkItemExecuteDialogProps) {
    const { recentItems, trackUsage } = useRecentSkills(workspaceId);
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'autopilot' });

    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
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
                const data = await fetchApi(
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
    }, [open, workspaceId]);

    const toggleSkill = useCallback((name: string) => {
        setSelectedSkills(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name],
        );
    }, []);

    const handleSubmit = useCallback(async (skillNames: string[]) => {
        if (skillNames.length === 0) return;
        setSubmitting(true);
        setError(null);
        try {
            await getSpaCocClient().workItems.execute(workspaceId, workItemId, {
                skillNames,
                ...(aiSelection.resolved.provider ? { provider: aiSelection.resolved.provider } : {}),
                ...(aiSelection.resolved.model ? { model: aiSelection.resolved.model } : {}),
                ...(aiSelection.resolved.reasoningEffort ? { reasoningEffort: aiSelection.resolved.reasoningEffort } : {}),
                ...(aiSelection.resolved.effortTier ? { effortTier: aiSelection.resolved.effortTier } : {}),
            });

            // Track skill usage (fire-and-forget)
            for (const name of skillNames) {
                trackUsage(name);
                getSpaCocClient().preferences.recordSkillUsage(workspaceId, name).catch(() => {});
            }

            onExecuted();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to execute');
        } finally {
            setSubmitting(false);
        }
    }, [workspaceId, workItemId, aiSelection.resolved, trackUsage, onExecuted, onClose]);

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
