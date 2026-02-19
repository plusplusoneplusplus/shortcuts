/**
 * UpdateDocumentDialog — modal for running an "Update Document" AI action on a task file.
 * Similar to FollowPromptDialog but with a pre-filled prompt template.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button, Spinner } from './index';
import { usePreferences } from '../hooks/usePreferences';
import { useApp } from '../context/AppContext';
import { useGlobalToast } from '../context/ToastContext';
import { getApiBase } from '../utils/config';

export interface UpdateDocumentDialogProps {
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

export function UpdateDocumentDialog({ wsId, taskPath, taskName, onClose }: UpdateDocumentDialogProps) {
    const { state } = useApp();
    const { model, setModel } = usePreferences();
    const { addToast } = useGlobalToast();

    const [models, setModels] = useState<string[]>([]);
    const [selectedWsId, setSelectedWsId] = useState(wsId);
    const [prompt, setPrompt] = useState(`Update the document "${taskName}" based on the current state of the codebase. Review the task file and update its status, notes, and checklist items to reflect the latest changes.`);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + '/queue/models')
            .then(r => r.ok ? r.json() : [])
            .then(data => {
                if (!cancelled) setModels(data?.models ?? (Array.isArray(data) ? data : []));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!prompt.trim()) return;
        setSubmitting(true);
        try {
            const ws = state.workspaces.find((w: any) => w.id === selectedWsId);
            const workingDirectory = ws?.rootPath || '';
            const tasksFolder = await getTasksFolderPath(selectedWsId);
            const planFilePath = workingDirectory
                ? workingDirectory + '/' + tasksFolder + '/' + taskPath
                : taskPath;

            const body: any = {
                type: 'custom',
                priority: 'normal',
                displayName: `Update: ${taskName}`,
                payload: {
                    data: {
                        prompt,
                        workingDirectory,
                        planFilePath,
                    },
                },
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
    }, [prompt, selectedWsId, taskPath, taskName, model, state.workspaces, addToast, onClose]);

    return (
        <>
            <Dialog
                open
                id="update-doc-overlay"
                onClose={onClose}
                title="Update Document"
                footer={
                    <>
                        <Button id="update-doc-cancel" variant="secondary" onClick={onClose}>Cancel</Button>
                        <Button id="update-doc-submit" onClick={handleSubmit} loading={submitting} disabled={!prompt.trim()}>
                            Submit
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    {/* Close button */}
                    <button
                        id="update-doc-close"
                        className="absolute top-3 right-3 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ×
                    </button>

                    {/* Prompt textarea */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[#616161] dark:text-[#999]">Prompt</label>
                        <textarea
                            id="update-doc-instruction"
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] resize-y min-h-[80px]"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            rows={4}
                        />
                    </div>

                    {/* Model select */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-[#616161] dark:text-[#999]">
                            Model <span className="text-[#848484]">(optional)</span>
                        </label>
                        <select
                            id="update-doc-model"
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
                </div>
            </Dialog>
        </>
    );
}
