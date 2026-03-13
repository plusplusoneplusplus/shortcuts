/**
 * FollowPromptDialog — modal for running a skill-based AI action on a task file.
 * Fetches available skills, lets user pick one or more, and submits to queue.
 */

import { useState, useEffect, useCallback } from 'react';
import { FloatingDialog, Button, Spinner } from './index';
import { usePreferences } from '../hooks/usePreferences';
import { useRecentSkills } from '../hooks/useRecentSkills';
import { useApp } from '../context/AppContext';
import { useGlobalToast } from '../context/ToastContext';
import { getApiBase } from '../utils/config';
import { toNativePath } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';

interface SkillItem {
    name: string;
    description?: string;
}

export interface FollowPromptDialogProps {
    wsId: string;
    taskPath: string;
    taskName: string;
    onClose: () => void;
}

const DEFAULT_TASKS_FOLDER = '.vscode/tasks';

async function getTasksFolderPath(wsId: string): Promise<string> {
    try {
        const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks/settings`);
        if (!res.ok) return DEFAULT_TASKS_FOLDER;
        const data = await res.json();
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

    const [models, setModels] = useState<string[]>([]);
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
                const [modelsRes, skillRes] = await Promise.all([
                    fetch(getApiBase() + '/queue/models').then(r => r.ok ? r.json() : []),
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/skills`).then(r => r.ok ? r.json() : null),
                ]);
                if (cancelled) return;
                setModels(modelsRes?.models ?? (Array.isArray(modelsRes) ? modelsRes : []));
                setSkills(skillRes?.skills ?? []);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedWsId]);

    // Pre-populate selectedSkills from saved plan preference when both are ready
    useEffect(() => {
        if (!prefsLoaded || savedSkills.plan.length === 0 || skills.length === 0) return;
        setSelectedSkills(prev => {
            if (prev.length > 0) return prev;
            return savedSkills.plan.filter(name => skills.some(s => s.name === name));
        });
    }, [prefsLoaded, savedSkills.plan, skills]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleSkill = useCallback((name: string) => {
        setSelectedSkills(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
    }, []);

    const handleSubmitSkills = useCallback(async (skillNames: string[], description?: string) => {
        if (skillNames.length === 0) return;
        setSubmitting(true);
        try {
            for (const name of skillNames) {
                trackUsage(name, description);
                if (selectedWsId) {
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/preferences/skill-usage`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ skillName: name }),
                    }).catch(() => { /* ignore */ });
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
            const chatPayload: Record<string, any> = {
                kind: 'chat',
                mode: 'autopilot',
                prompt: `Use the ${displayLabel} skill${skillNames.length > 1 ? 's' : ''}.`,
                workingDirectory,
                context: {
                    files: [planFilePath],
                    skills: skillNames,
                },
            };

            const trimmed = additionalInfo.trim();
            if (trimmed) {
                if (!chatPayload.context.blocks) chatPayload.context.blocks = [];
                chatPayload.context.blocks.push({ label: 'Additional Info', content: trimmed });
            }

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

            const res = await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            setSelectedSkills([]);
            setSkill('plan', skillNames);
            addToast('Queued successfully', 'success');
            onClose();
        } catch (err: any) {
            addToast(err.message || 'Failed to queue', 'error');
        } finally {
            setSubmitting(false);
        }
    }, [selectedWsId, taskPath, taskName, model, additionalInfo, state.workspaces, addToast, onClose, trackUsage, setSkill]);

    return (
        <>
            <FloatingDialog open onClose={onClose} title="Run Skill" id="follow-prompt-submenu" closeButtonId="fp-close" resizable minWidth={360} minHeight={200}>
                <div className="flex flex-col gap-4">
                    {/* Model select */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[#616161] dark:text-[#999]">
                            Model <span className="text-[#848484]">(optional)</span>
                        </label>
                        <select
                            id="fp-model"
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                            value={model}
                            onChange={e => setModel('task', e.target.value)}
                        >
                            <option value="">Default</option>
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>

                    {/* Workspace select */}
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

                    {/* Additional info */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[#616161] dark:text-[#999]">
                            Additional info <span className="text-[#848484]">(optional)</span>
                        </label>
                        <textarea
                            id="fp-additional-info"
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] resize-y"
                            rows={3}
                            placeholder="Extra context for the AI (e.g. &quot;focus on auth module&quot;)"
                            value={additionalInfo}
                            onChange={e => setAdditionalInfo(e.target.value)}
                            disabled={submitting}
                        />
                    </div>

                    {/* Last Used section */}
                    {recentItems.length > 0 && !loading && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Last Used</div>
                            {recentItems.map(item => (
                                <button
                                    key={`skill-${item.name}`}
                                    className="fp-item fp-recent-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                                    data-name={item.name}
                                    disabled={submitting}
                                    onClick={() => handleSubmitSkills([item.name], item.description)}
                                >
                                    <span>⚡</span>
                                    <span className="truncate">{item.name}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Skills list */}
                    {loading ? (
                        <div className="flex items-center gap-2 py-4 text-xs text-[#848484]">
                            <Spinner size="sm" /> Loading…
                        </div>
                    ) : skills.length === 0 ? (
                        <div className="text-xs text-[#848484] py-2">
                            <p>No skills found in this workspace.</p>
                            <p className="mt-1 text-[10px]">Create skills in .github/skills/</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Skills</div>
                                <div className="flex flex-wrap gap-1.5 mb-2" data-testid="fp-skill-chips">
                                    {skills.map(s => {
                                        const isActive = selectedSkills.includes(s.name);
                                        return (
                                            <button
                                                key={s.name}
                                                type="button"
                                                className={`fp-item inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors ${
                                                    isActive
                                                        ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                                        : 'bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#555] hover:border-[#0078d4]'
                                                }`}
                                                data-name={s.name}
                                                disabled={submitting}
                                                onClick={() => toggleSkill(s.name)}
                                                title={s.description || s.name}
                                            >
                                                <span>⚡</span>
                                                <span className="font-medium">{s.name}</span>
                                                {isActive && <span className="ml-0.5">✕</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                                {selectedSkills.length > 0 && (
                                    <button
                                        type="button"
                                        className="w-full px-3 py-1.5 text-xs font-medium text-white bg-[#0078d4] rounded hover:bg-[#006cc1] disabled:opacity-50"
                                        disabled={submitting}
                                        onClick={() => handleSubmitSkills(selectedSkills)}
                                        data-testid="fp-submit-skills"
                                    >
                                        {submitting ? 'Submitting…' : `Submit with ${selectedSkills.length} skill${selectedSkills.length > 1 ? 's' : ''}`}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </FloatingDialog>
        </>
    );
}
