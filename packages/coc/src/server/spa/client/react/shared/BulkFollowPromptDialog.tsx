/**
 * BulkFollowPromptDialog — modal for running a skill on every task file
 * inside a folder. Collects all markdown files (excluding context files like
 * CONTEXT.md) and enqueues a separate skill-based task for each one.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog } from '../ui';
import { usePreferences } from '../hooks/preferences/usePreferences';
import { useRecentSkills } from '../features/skills/hooks/useRecentSkills';
import { useApp } from '../contexts/AppContext';
import { useGlobalToast } from '../contexts/ToastContext';
import { toNativePath } from '@plusplusoneplusplus/forge/utils/path-utils';
import type { TaskFolder } from '../tasks/hooks/useTaskTree';
import { isContextFile } from '../tasks/hooks/useTaskTree';
import { RunSkillPanel } from './RunSkillPanel';
import type { SkillItem } from './RunSkillPanel';
import { getSpaCocClient } from '../api/cocClient';
import { getActiveProvider } from '../utils/config';

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
        const data = await getSpaCocClient().tasks.getSettings(wsId);
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
    const { recentItems, trackUsage } = useRecentSkills();
    const { addToast } = useGlobalToast();

    const [models, setModels] = useState<string[]>([]);
    const [selectedWsId, setSelectedWsId] = useState(wsId);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [additionalInfo, setAdditionalInfo] = useState('');

    const taskFiles = useMemo(() => collectMarkdownFiles(folder), [folder]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [modelsRes, skillRes] = await Promise.all([
                    getSpaCocClient().agentProviders.listModels(getActiveProvider()),
                    getSpaCocClient().skills.listWorkspace(selectedWsId),
                ]);
                if (cancelled) return;
                setModels(Array.isArray(modelsRes.models) ? modelsRes.models.map((m: any) => m.id) : []);
                setSkills(Array.isArray(skillRes) ? skillRes : []);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedWsId]);

    const handleSubmit = useCallback(async (skillNames: string[]) => {
        if (skillNames.length === 0) return;
        const name = skillNames[0];
        setSubmitting(true);
        try {
            trackUsage(name);

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

                const trimmed = additionalInfo.trim();
                const skillInstruction = `Use the ${name} skill.`;
                const fullPrompt = trimmed ? `${skillInstruction}\n\n${trimmed}` : skillInstruction;
                const chatPayload: Record<string, any> = {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: fullPrompt,
                    workingDirectory,
                    context: {
                        files: [planFilePath],
                        skills: [name],
                    },
                };

                const body: any = {
                    type: 'chat',
                    priority: 'normal',
                    displayName: `Follow: ${name} on ${taskName}`,
                    payload: chatPayload,
                };
                if (model) body.config = { model };

                try {
                    await getSpaCocClient().queue.enqueue(body);
                    succeeded++;
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
        <Dialog open onClose={onClose} title="Run Skill" id="bulk-follow-prompt-dialog">
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

                <RunSkillPanel
                    skills={skills}
                    recentItems={recentItems}
                    models={models}
                    loading={loading}
                    selectedSkills={[]}
                    additionalInfo={additionalInfo}
                    model={model}
                    submitting={submitting}
                    disabled={taskFiles.length === 0}
                    onSkillToggle={() => {}}
                    onSubmitSkills={handleSubmit}
                    onAdditionalInfoChange={setAdditionalInfo}
                    onModelChange={val => setModel('task', val)}
                    selectionMode="single"
                    modelSelectId="bfp-model"
                    additionalInfoId="bfp-additional-info"
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
        </Dialog>
    );
}
