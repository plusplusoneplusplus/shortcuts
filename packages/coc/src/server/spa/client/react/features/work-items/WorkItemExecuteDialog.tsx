/**
 * WorkItemExecuteDialog — modal for selecting skills and model before
 * executing a work item.  Skill selection is required; model is optional.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button } from '../../ui';
import { useModels } from '../../hooks/useModels';
import { useRecentSkills } from '../../features/skills/hooks/useRecentSkills';
import { fetchApi } from '../../hooks/useApi';
import { getApiBase } from '../../utils/config';
import { RunSkillPanel } from '../../shared/RunSkillPanel';
import type { SkillItem } from '../../shared/RunSkillPanel';

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
    const { models: modelInfos } = useModels();
    const enabledModels = modelInfos.filter(m => m.enabled);
    const models = (enabledModels.length > 0 ? enabledModels : modelInfos).map(m => m.id);

    const { recentItems, trackUsage } = useRecentSkills(workspaceId);

    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [model, setModel] = useState('');
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
            await fetchApi(
                `/workspaces/${encodeURIComponent(workspaceId)}/work-items/${encodeURIComponent(workItemId)}/execute`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        skillNames,
                        ...(model ? { model } : {}),
                    }),
                },
            );

            // Track skill usage (fire-and-forget)
            for (const name of skillNames) {
                trackUsage(name);
                fetch(
                    getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/preferences/skill-usage`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ skillName: name }),
                    },
                ).catch(() => {});
            }

            onExecuted();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to execute');
        } finally {
            setSubmitting(false);
        }
    }, [workspaceId, workItemId, model, trackUsage, onExecuted, onClose]);

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
                    models={models}
                    loading={loading}
                    selectedSkills={selectedSkills}
                    additionalInfo={additionalInfo}
                    model={model}
                    submitting={submitting}
                    onSkillToggle={toggleSkill}
                    onSubmitSkills={handleSubmit}
                    onAdditionalInfoChange={setAdditionalInfo}
                    onModelChange={setModel}
                    selectionMode="multi"
                    submitLabel="⚡ Start Implementing"
                    modelSelectId="wi-exec-model"
                    additionalInfoId="wi-exec-additional-info"
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
