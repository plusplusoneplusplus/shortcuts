/**
 * BulkFollowPromptDialog — modal for running "Follow Prompt" on every task file
 * inside a folder. Collects all markdown files (excluding context files like
 * CONTEXT.md) and enqueues a separate follow-prompt task for each one.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Button, Spinner } from './index';
import { usePreferences } from '../hooks/usePreferences';
import { useRecentPrompts } from '../hooks/useRecentPrompts';
import { useApp } from '../context/AppContext';
import { useGlobalToast } from '../context/ToastContext';
import { getApiBase } from '../utils/config';
import { toNativePath } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
import type { TaskFolder } from '../hooks/useTaskTree';
import { isContextFile } from '../hooks/useTaskTree';

interface PromptItem {
    name: string;
    relativePath: string;
}

interface SkillItem {
    name: string;
    description?: string;
}

export interface BulkFollowPromptDialogProps {
    wsId: string;
    folder: TaskFolder;
    onClose: () => void;
}

interface TaskFile {
    fileName: string;
    relativePath: string;
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

const INACTIVE_STATUSES = new Set(['future', 'done']);

function collectMarkdownFiles(folder: TaskFolder): TaskFile[] {
    const files: TaskFile[] = [];

    for (const doc of folder.singleDocuments) {
        if (
            doc.fileName.toLowerCase().endsWith('.md') &&
            !isContextFile(doc.fileName) &&
            !INACTIVE_STATUSES.has(doc.status ?? '')
        ) {
            const rel = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
            files.push({ fileName: doc.fileName, relativePath: rel });
        }
    }

    for (const group of folder.documentGroups) {
        for (const doc of group.documents) {
            if (
                doc.fileName.toLowerCase().endsWith('.md') &&
                !isContextFile(doc.fileName) &&
                !INACTIVE_STATUSES.has(doc.status ?? '')
            ) {
                const rel = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
                files.push({ fileName: doc.fileName, relativePath: rel });
            }
        }
    }

    for (const child of folder.children) {
        files.push(...collectMarkdownFiles(child));
    }

    return files;
}

export function BulkFollowPromptDialog({ wsId, folder, onClose }: BulkFollowPromptDialogProps) {
    const { state } = useApp();
    const { models: savedModels, setModel } = usePreferences(wsId);
    const model = savedModels.task;
    const { recentItems, trackUsage } = useRecentPrompts();
    const { addToast } = useGlobalToast();

    const [models, setModels] = useState<string[]>([]);
    const [selectedWsId, setSelectedWsId] = useState(wsId);
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [additionalInfo, setAdditionalInfo] = useState('');

    const taskFiles = useMemo(() => collectMarkdownFiles(folder), [folder]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [modelsRes, promptRes, skillRes] = await Promise.all([
                    fetch(getApiBase() + '/queue/models').then(r => r.ok ? r.json() : []),
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/prompts`).then(r => r.ok ? r.json() : null),
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(selectedWsId)}/skills`).then(r => r.ok ? r.json() : null),
                ]);
                if (cancelled) return;
                setModels(modelsRes?.models ?? (Array.isArray(modelsRes) ? modelsRes : []));
                setPrompts(promptRes?.prompts ?? []);
                setSkills(skillRes?.skills ?? []);
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

            const ws = state.workspaces.find((w: any) => w.id === selectedWsId);
            const workingDirectory = ws?.rootPath || '';
            const tasksFolder = await getTasksFolderPath(selectedWsId);

            let succeeded = 0;
            let failed = 0;

            for (const file of taskFiles) {
                const isAbsFolder = tasksFolder.startsWith('/') || /^[A-Za-z]:/.test(tasksFolder);
                const taskBase = isAbsFolder ? tasksFolder : (workingDirectory + '/' + tasksFolder);
                const planFilePath = workingDirectory
                    ? toNativePath(taskBase + '/' + file.relativePath)
                    : file.relativePath;

                const taskName = file.fileName.replace(/\.md$/, '');

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

                try {
                    const res = await fetch(getApiBase() + '/queue/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (res.ok) succeeded++;
                    else failed++;
                } catch {
                    failed++;
                }
            }

            if (failed === 0) {
                addToast(`Queued ${succeeded} task${succeeded !== 1 ? 's' : ''} successfully`, 'success');
            } else {
                addToast(`Queued ${succeeded}, failed ${failed}`, succeeded > 0 ? 'success' : 'error');
            }
            onClose();
        } catch (err: any) {
            addToast(err.message || 'Failed to queue', 'error');
        } finally {
            setSubmitting(false);
        }
    }, [selectedWsId, taskFiles, model, additionalInfo, state.workspaces, addToast, onClose, trackUsage]);

    return (
        <Dialog open onClose={onClose} title="Follow Prompt" id="bulk-follow-prompt-dialog">
            <div className="flex flex-col gap-4">
                <button
                    id="bfp-close"
                    className="absolute top-3 right-3 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                    onClick={onClose}
                    aria-label="Close"
                >
                    ×
                </button>

                {/* File count summary */}
                <div className="text-xs text-[#616161] dark:text-[#999]">
                    <strong>{folder.name}</strong> — {taskFiles.length} task{taskFiles.length !== 1 ? 's' : ''} will be queued
                </div>

                {/* Model select */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Model <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="bfp-model"
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
                        id="bfp-additional-info"
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
                                disabled={submitting || taskFiles.length === 0}
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
                        <Spinner size="sm" /> Loading prompts and skills…
                    </div>
                ) : prompts.length === 0 && skills.length === 0 ? (
                    <div className="text-xs text-[#848484] py-2">
                        <p>No prompts or skills found in this workspace.</p>
                        <p className="mt-1 text-[10px]">Create .prompt.md files in .vscode/pipelines/ or skills in .github/skills/</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                        {prompts.length > 0 && (
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Prompts</div>
                                {prompts.map(p => (
                                    <button
                                        key={p.relativePath}
                                        className="fp-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                                        data-name={p.name}
                                        disabled={submitting || taskFiles.length === 0}
                                        onClick={() => handleSubmit('prompt', p.name, p.relativePath)}
                                    >
                                        <span>📝</span>
                                        <span className="truncate">{p.name}</span>
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
                                        disabled={submitting || taskFiles.length === 0}
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
    );
}
