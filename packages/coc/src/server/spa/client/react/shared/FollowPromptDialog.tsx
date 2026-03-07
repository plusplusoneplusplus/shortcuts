/**
 * FollowPromptDialog — modal for running a "Follow Prompt" AI action on a task file.
 * Fetches available prompts/skills, lets user pick one and submit to queue.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button, Spinner } from './index';
import { usePreferences } from '../hooks/usePreferences';
import { useRecentPrompts } from '../hooks/useRecentPrompts';
import { useApp } from '../context/AppContext';
import { useGlobalToast } from '../context/ToastContext';
import { getApiBase } from '../utils/config';
import { toNativePath } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';

interface SkillItem {
    name: string;
    description?: string;
}

interface PromptItem {
    name: string;
    path: string;
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
    const { model, setModel, loaded: prefsLoaded } = usePreferences(wsId);
    const { recentItems, trackUsage } = useRecentPrompts(wsId);
    const { addToast } = useGlobalToast();

    const [models, setModels] = useState<string[]>([]);
    const [selectedWsId, setSelectedWsId] = useState(wsId);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [additionalInfo, setAdditionalInfo] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [modelsRes, skillRes, promptRes] = await Promise.all([
                    fetch(getApiBase() + '/queue/models').then(r => r.ok ? r.json() : []),
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/skills`).then(r => r.ok ? r.json() : null),
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/prompts`).then(r => r.ok ? r.json() : null),
                ]);
                if (cancelled) return;
                setModels(modelsRes?.models ?? (Array.isArray(modelsRes) ? modelsRes : []));
                setSkills(skillRes?.skills ?? []);
                setPrompts(promptRes?.prompts ?? []);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedWsId]);

    const handleSubmit = useCallback(async (type: 'prompt' | 'skill', name: string, path?: string, description?: string) => {
        setSubmitting(true);
        try {
            trackUsage(type, name, path, description);

            // Record skill usage for ordering
            if (type === 'skill' && selectedWsId) {
                fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/preferences/skill-usage`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skillName: name }),
                }).catch(() => { /* ignore */ });
            }

            const ws = state.workspaces.find((w: any) => w.id === selectedWsId);
            const workingDirectory = ws?.rootPath || '';
            const tasksFolder = await getTasksFolderPath(selectedWsId);
            const planFilePath = workingDirectory
                ? toNativePath(workingDirectory + '/' + tasksFolder + '/' + taskPath)
                : taskPath;

            let chatPayload: Record<string, any>;
            if (type === 'prompt') {
                const promptFilePath = workingDirectory
                    ? toNativePath(workingDirectory + '/' + (path || ''))
                    : path || '';
                chatPayload = {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: `Follow the instruction ${promptFilePath}.`,
                    workingDirectory,
                    context: {
                        files: [promptFilePath, planFilePath],
                    },
                };
            } else {
                chatPayload = {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: `Use the ${name} skill.`,
                    workingDirectory,
                    context: {
                        files: [planFilePath],
                        skills: [name],
                    },
                };
            }

            const trimmed = additionalInfo.trim();
            if (trimmed) {
                if (!chatPayload.context) chatPayload.context = {};
                if (!chatPayload.context.blocks) chatPayload.context.blocks = [];
                chatPayload.context.blocks.push({ label: 'Additional Info', content: trimmed });
            }

            const body: any = {
                type: 'chat',
                priority: 'normal',
                displayName: `Follow: ${name} on ${taskName}`,
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
            addToast('Queued successfully', 'success');
            onClose();
        } catch (err: any) {
            addToast(err.message || 'Failed to queue', 'error');
        } finally {
            setSubmitting(false);
        }
    }, [selectedWsId, taskPath, taskName, model, additionalInfo, state.workspaces, addToast, onClose, trackUsage]);

    return (
        <>
            <Dialog open onClose={onClose} title="Follow Prompt" id="follow-prompt-submenu">
                <div className="flex flex-col gap-4">
                    {/* Close button */}
                    <button
                        id="fp-close"
                        className="absolute top-3 right-3 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ×
                    </button>

                    {/* Model select */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[#616161] dark:text-[#999]">
                            Model <span className="text-[#848484]">(optional)</span>
                        </label>
                        <select
                            id="fp-model"
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                            value={model}
                            onChange={e => setModel(e.target.value)}
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
                                    key={`${item.type}-${item.name}`}
                                    className="fp-item fp-recent-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                                    data-name={item.name}
                                    disabled={submitting}
                                    onClick={() => handleSubmit(item.type, item.name, item.path, item.description)}
                                >
                                    <span>{item.type === 'prompt' ? '📝' : '⚡'}</span>
                                    <span className="truncate">{item.name}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Prompts and Skills list */}
                    {loading ? (
                        <div className="flex items-center gap-2 py-4 text-xs text-[#848484]">
                            <Spinner size="sm" /> Loading…
                        </div>
                    ) : prompts.length === 0 && skills.length === 0 ? (
                        <div className="text-xs text-[#848484] py-2">
                            <p>No prompts or skills found in this workspace.</p>
                            <p className="mt-1 text-[10px]">Create prompts in .github/prompts/ or skills in .github/skills/</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                            {prompts.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Prompts</div>
                                    {prompts.map(p => (
                                        <button
                                            key={p.name}
                                            className="fp-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                                            data-name={p.name}
                                            disabled={submitting}
                                            onClick={() => handleSubmit('prompt', p.name, p.path, p.description)}
                                        >
                                            <span>📝</span>
                                            <span className="flex-shrink-0 font-medium">{p.name}</span>
                                            {p.description && (
                                                <span className="text-xs text-[#848484] truncate">{p.description}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {skills.length > 0 && (
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Skills</div>
                                    {skills.map(s => (
                                        <button
                                            key={s.name}
                                            className="fp-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                                            data-name={s.name}
                                            disabled={submitting}
                                            onClick={() => handleSubmit('skill', s.name, undefined, s.description)}
                                        >
                                            <span>⚡</span>
                                            <span className="flex-shrink-0 font-medium">{s.name}</span>
                                            {s.description && (
                                                <span className="text-xs text-[#848484] truncate">{s.description}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Dialog>
        </>
    );
}
