/**
 * FollowPromptDialog — modal for running a skill-based AI action on a task file.
 * Fetches available skills, lets user pick one or more, and submits to queue.
 */

import { useState, useEffect, useCallback } from 'react';
import { FloatingDialog } from '../ui';
import { useModels } from '../hooks/useModels';
import { usePreferences } from '../hooks/preferences/usePreferences';
import { useRecentSkills } from '../features/skills/hooks/useRecentSkills';
import { useApp } from '../contexts/AppContext';
import { useGlobalToast } from '../contexts/ToastContext';
import { toNativePath } from '@plusplusoneplusplus/forge/utils/path-utils';
import { RunSkillPanel } from './RunSkillPanel';
import type { SkillItem } from './RunSkillPanel';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

export interface FollowPromptDialogProps {
    wsId: string;
    taskPath: string;
    taskName: string;
    onClose: () => void;
}

const DEFAULT_TASKS_FOLDER = '.vscode/tasks';

async function getTasksFolderPath(wsId: string): Promise<string> {
    try {
        const data = await getSpaCocClient().tasks.getSettings(wsId);
        return typeof data.folderPath === 'string' ? data.folderPath : DEFAULT_TASKS_FOLDER;
    } catch {
        return DEFAULT_TASKS_FOLDER;
    }
}

export function FollowPromptDialog({ wsId, taskPath, taskName, onClose }: FollowPromptDialogProps) {
    const { state } = useApp();
    const { models: savedModels, skills: savedSkills, setModel, setSkill, loaded: prefsLoaded } = usePreferences(wsId);
    const model = savedModels.task;
    const { recentItems, trackUsage } = useRecentSkills(wsId);
    const { addToast } = useGlobalToast();

    const { models: modelInfos } = useModels();
    const enabledModels = modelInfos.filter(m => m.enabled);
    const models = (enabledModels.length > 0 ? enabledModels : modelInfos).map(m => m.id);
    const [selectedWsId, setSelectedWsId] = useState(wsId);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [additionalInfo, setAdditionalInfo] = useState('');
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const skills = await getSpaCocClient().skills.listWorkspace(selectedWsId);
                if (cancelled) return;
                setSkills(skills);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedWsId]);

    // Pre-populate selectedSkills from saved task preference when both are ready.
    useEffect(() => {
        if (!prefsLoaded || savedSkills.task.length === 0 || skills.length === 0) return;
        setSelectedSkills(prev => {
            if (prev.length > 0) return prev;
            return savedSkills.task.filter(name => skills.some(s => s.name === name));
        });
    }, [prefsLoaded, savedSkills.task, skills]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleSkill = useCallback((name: string) => {
        setSelectedSkills(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
    }, []);

    const handleSubmitSkills = useCallback(async (skillNames: string[]) => {
        if (skillNames.length === 0) return;
        setSubmitting(true);
        try {
            for (const name of skillNames) {
                trackUsage(name);
                if (selectedWsId) {
                    getSpaCocClient().skills.recordUsage(selectedWsId, name).catch(() => { /* ignore */ });
                }
            }

            const ws = state.workspaces.find((w: any) => w.id === selectedWsId);
            const workingDirectory = ws?.rootPath || '';
            const isAbsTaskPath = taskPath.startsWith('/') || /^[A-Za-z]:/.test(taskPath);
            let planFilePath: string;
            if (isAbsTaskPath) {
                planFilePath = toNativePath(taskPath);
            } else {
                const tasksFolder = await getTasksFolderPath(selectedWsId);
                const isAbsFolder = tasksFolder.startsWith('/') || /^[A-Za-z]:/.test(tasksFolder);
                const taskBase = isAbsFolder ? tasksFolder : (workingDirectory + '/' + tasksFolder);
                planFilePath = workingDirectory
                    ? toNativePath(taskBase + '/' + taskPath)
                    : taskPath;
            }

            const displayLabel = skillNames.length === 1 ? skillNames[0] : skillNames.join(', ');
            const trimmed = additionalInfo.trim();
            const skillInstruction = `Use the ${displayLabel} skill${skillNames.length > 1 ? 's' : ''}.`;
            const fullPrompt = trimmed ? `${skillInstruction}\n\n${trimmed}` : skillInstruction;
            const chatPayload: Record<string, any> = {
                kind: 'chat',
                mode: 'autopilot',
                prompt: fullPrompt,
                workingDirectory,
                context: {
                    files: [planFilePath],
                    skills: skillNames,
                },
            };

            const displayName = skillNames.length === 1
                ? `Follow: ${skillNames[0]} on ${taskName}`
                : `Follow: ${skillNames.join(', ')} on ${taskName}`;
            const body: any = {
                type: 'chat',
                priority: 'normal',
                displayName,
                payload: chatPayload,
            };
            if (model) body.config = { model };

            await getSpaCocClient().queue.enqueue(body);
            setSelectedSkills([]);
            setSkill('task', skillNames);
            addToast('Queued successfully', 'success');
            onClose();
        } catch (err) {
            addToast(getSpaCocClientErrorMessage(err, 'Failed to queue'), 'error');
        } finally {
            setSubmitting(false);
        }
    }, [selectedWsId, taskPath, taskName, model, additionalInfo, state.workspaces, addToast, onClose, trackUsage, setSkill]);

    return (
        <>
            <FloatingDialog open onClose={onClose} title="Run Skill" id="follow-prompt-submenu" closeButtonId="fp-close" resizable minWidth={360} minHeight={200}>
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
                        onSubmitSkills={handleSubmitSkills}
                        onAdditionalInfoChange={setAdditionalInfo}
                        onModelChange={val => setModel('task', val)}
                        selectionMode="multi"
                        modelSelectId="fp-model"
                        additionalInfoId="fp-additional-info"
                        afterModelContent={
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-[#616161] dark:text-[#999]">Workspace</label>
                                <select
                                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                    value={selectedWsId}
                                    onChange={e => setSelectedWsId(e.target.value)}
                                >
                                    {state.workspaces.map((ws: any) => (
                                        <option key={ws.id} value={ws.id}>{ws.name || ws.rootPath || ws.id}</option>
                                    ))}
                                </select>
                            </div>
                        }
                    />
                </div>
            </FloatingDialog>
        </>
    );
}
