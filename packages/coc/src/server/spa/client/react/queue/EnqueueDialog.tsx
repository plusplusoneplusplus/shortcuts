/**
 * EnqueueDialog — form to enqueue a new AI task.
 * Posts to POST /api/queue/enqueue.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { Dialog, Button } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { usePreferences } from '../hooks/usePreferences';

interface FolderOption { label: string; value: string; }

function flattenFolders(node: any, depth = 0): FolderOption[] {
    const indent = '\u00a0\u00a0'.repeat(depth);
    const options: FolderOption[] = [];
    if (node.relativePath !== undefined) {
        const label = node.relativePath === '' ? '(root)' : indent + node.name;
        options.push({ label, value: node.relativePath });
    }
    for (const child of node.children ?? []) {
        options.push(...flattenFolders(child, depth + 1));
    }
    return options;
}

export function EnqueueDialog() {
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();
    const { model: savedModel, setModel: persistModel } = usePreferences();
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const [folders, setFolders] = useState<FolderOption[]>([]);
    const [folderPath, setFolderPath] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);

    // Sync model from preferences when loaded
    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seed folderPath from dialogInitialFolderPath and load models when dialog opens
    useEffect(() => {
        if (!queueState.showDialog) return;
        setFolderPath(queueState.dialogInitialFolderPath ?? '');
        fetchApi('/queue/models')
            .then((data: any) => {
                if (Array.isArray(data)) setModels(data);
                else if (data?.models && Array.isArray(data.models)) setModels(data.models);
            })
            .catch(() => { /* ignore */ });
    }, [queueState.showDialog]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch folders when workspaceId changes
    useEffect(() => {
        setFolders([]);
        if (!workspaceId) return;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/tasks')
            .then((data: any) => {
                if (data && typeof data === 'object') {
                    setFolders(flattenFolders(data));
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    const handleModelChange = useCallback((value: string) => {
        setModel(value);
        persistModel(value);
    }, [persistModel]);

    const handleSubmit = useCallback(async () => {
        if (!prompt.trim()) return;
        setSubmitting(true);
        try {
            await fetch('/api/queue/enqueue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    model: model || undefined,
                    workspaceId: workspaceId || undefined,
                    folderPath: folderPath || undefined,
                }),
            });
            setPrompt('');
            queueDispatch({ type: 'CLOSE_DIALOG' });
        } catch { /* ignore */ }
        finally { setSubmitting(false); }
    }, [prompt, model, workspaceId, folderPath, queueDispatch]);

    return (
        <Dialog
            open={queueState.showDialog}
            onClose={() => queueDispatch({ type: 'CLOSE_DIALOG' })}
            title="Enqueue AI Task"
            footer={
                <>
                    <Button variant="secondary" onClick={() => queueDispatch({ type: 'CLOSE_DIALOG' })}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        loading={submitting}
                        disabled={!prompt.trim()}
                    >
                        Enqueue
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <div>
                    <label className="block text-xs font-medium text-[#848484] mb-1">Prompt</label>
                    <textarea
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="Enter your prompt..."
                        rows={4}
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-y"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-[#848484] mb-1">Model</label>
                    <select
                        value={model}
                        onChange={e => handleModelChange(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                    >
                        <option value="">Default</option>
                        {models.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                </div>
                {appState.workspaces.length > 0 && (
                    <div>
                        <label className="block text-xs font-medium text-[#848484] mb-1">Workspace</label>
                        <select
                            value={workspaceId}
                            onChange={e => setWorkspaceId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                        >
                            <option value="">None</option>
                            {appState.workspaces.map((ws: any) => (
                                <option key={ws.id} value={ws.id}>{ws.name || ws.path || ws.id}</option>
                            ))}
                        </select>
                    </div>
                )}
                {workspaceId && folders.length > 0 && (
                    <div>
                        <label className="block text-xs font-medium text-[#848484] mb-1">Folder</label>
                        <select
                            value={folderPath}
                            onChange={e => setFolderPath(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                            data-testid="folder-select"
                        >
                            {folders.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>
        </Dialog>
    );
}
