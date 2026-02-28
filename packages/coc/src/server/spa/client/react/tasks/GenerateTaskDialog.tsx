/**
 * GenerateTaskDialog — modal dialog for AI-powered task generation.
 *
 * Submits the task to the queue via useQueueTaskGeneration, then closes.
 * The user can track progress in the Queue tab.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button } from '../shared';
import { useQueueTaskGeneration } from '../hooks/useQueueTaskGeneration';
import { usePreferences } from '../hooks/usePreferences';
import { useImagePaste } from '../hooks/useImagePaste';
import { useGlobalToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import { type TaskFolder, filterGitMetadataFolders } from '../hooks/useTaskTree';
import { getApiBase } from '../utils/config';

// ── helpers ──────────────────────────────────────────────────────────────────

function flattenFolders(folder: TaskFolder, acc: string[] = []): string[] {
    acc.push(folder.relativePath);
    for (const child of folder.children) flattenFolders(child, acc);
    return acc;
}

// ── props ────────────────────────────────────────────────────────────────────

export interface GenerateTaskDialogProps {
    /** Workspace id used to enqueue the task and fetch folders/models. */
    wsId: string;
    /** Pre-selected target folder path (relative). Empty string = root. */
    initialFolder?: string;
    /** Called when the task is successfully queued; receives the taskId. */
    onSuccess: (taskId: string) => void;
    /** Called when the user cancels or closes without completing. */
    onClose: () => void;
}

// ── component ────────────────────────────────────────────────────────────────

export function GenerateTaskDialog({
    wsId,
    initialFolder = '',
    onSuccess,
    onClose,
}: GenerateTaskDialogProps) {
    // --- preferences (persisted model) ---
    const { model: savedModel, setModel: persistModel } = usePreferences();
    const { addToast } = useGlobalToast();
    const { dispatch: appDispatch } = useApp();

    // --- form state ---
    const [prompt, setPrompt] = useState('');
    const [name, setName] = useState('');
    const [targetFolder, setTargetFolder] = useState(initialFolder);
    const [model, setModel] = useState('');
    const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
    const [depth, setDepth] = useState<'deep' | 'normal'>('deep');

    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- data ---
    const [models, setModels] = useState<string[]>([]);
    const [folders, setFolders] = useState<string[]>(['']);

    // --- hook ---
    const { status, taskId, error, enqueue, reset } =
        useQueueTaskGeneration(wsId);

    // --- image paste ---
    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();

    // --- fetch models on mount ---
    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + '/queue/models')
            .then(r => (r.ok ? r.json() : []))
            .then(data => {
                if (!cancelled) setModels(data?.models ?? (Array.isArray(data) ? data : []));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // --- fetch task folders on mount ---
    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (!cancelled && data) {
                    const filtered = filterGitMetadataFolders(data as TaskFolder);
                    const paths = flattenFolders(filtered);
                    setFolders(paths);
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [wsId]);

    // --- notify parent and navigate to Queue tab after successful enqueue ---
    useEffect(() => {
        if (status === 'queued') {
            addToast(`Task queued${taskId ? ` (${taskId.slice(0, 8)})` : ''}`, 'success');
            appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
            clearImages();
            onSuccess(taskId || '');
        }
    }, [status, taskId, addToast, appDispatch, clearImages, onSuccess]);

    const handleGenerate = useCallback(() => {
        enqueue({
            prompt: prompt.trim(),
            name: name.trim() || undefined,
            targetFolder: targetFolder || undefined,
            model: model || undefined,
            mode: 'from-feature',
            depth,
            priority,
            images: images.length > 0 ? images : undefined,
        });
    }, [prompt, name, targetFolder, model, depth, priority, images, enqueue]);

    const isSubmitting = status === 'submitting';
    const isQueued = status === 'queued';
    const isError = status === 'error';

    const footer = (
        <>
            <Button
                id="gen-task-cancel"
                variant="secondary"
                onClick={onClose}
            >
                Close
            </Button>
            <Button
                id="gen-task-generate"
                onClick={handleGenerate}
                loading={isSubmitting}
                disabled={!prompt.trim() || isSubmitting || isQueued}
            >
                Generate
            </Button>
        </>
    );

    return (
        <Dialog
            open
            id="generate-task-overlay"
            onClose={isSubmitting ? undefined : onClose}
            title="Generate Task"
            className="max-w-[600px]"
            footer={footer}
        >
            <div className="flex flex-col gap-4">
                {/* Close × button */}
                <button
                    id="gen-task-close"
                    className="absolute top-3 right-3 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                    onClick={isSubmitting ? undefined : onClose}
                    aria-label="Close"
                >
                    ×
                </button>

                {/* Prompt textarea (required) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">Prompt</label>
                    <textarea
                        id="gen-task-prompt"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] resize-y min-h-[80px]"
                        rows={4}
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        onPaste={isSubmitting || isQueued ? undefined : addFromPaste}
                        disabled={isSubmitting || isQueued}
                        placeholder="Describe the task to generate…"
                    />
                    {/* Image preview strip */}
                    {images.length > 0 && (
                        <div id="gen-task-images" className="flex flex-wrap gap-2 mt-1">
                            {images.map((img, i) => (
                                <div key={i} className="relative group">
                                    <img
                                        src={img}
                                        alt={`Attachment ${i + 1}`}
                                        className="w-[80px] h-[80px] object-cover rounded border border-[#e0e0e0] dark:border-[#3c3c3c]"
                                    />
                                    <button
                                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-80 hover:opacity-100"
                                        onClick={() => removeImage(i)}
                                        aria-label={`Remove image ${i + 1}`}
                                        disabled={isSubmitting || isQueued}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Task name (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Task name <span className="text-[#848484]">(optional)</span>
                    </label>
                    <input
                        id="gen-task-name"
                        type="text"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isSubmitting || isQueued}
                        placeholder="Leave blank — AI will decide"
                    />
                </div>

                {/* Target folder (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Target folder <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="gen-task-folder"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={targetFolder}
                        onChange={e => setTargetFolder(e.target.value)}
                        disabled={isSubmitting || isQueued}
                    >
                        <option value="">Root</option>
                        {folders
                            .filter(f => f !== '')
                            .map(f => (
                                <option key={f} value={f}>
                                    {f}
                                </option>
                            ))}
                    </select>
                </div>

                {/* Model (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Model <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="gen-task-model"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={model}
                        onChange={e => {
                            setModel(e.target.value);
                            persistModel(e.target.value);
                        }}
                        disabled={isSubmitting || isQueued}
                    >
                        <option value="">Default</option>
                        {models.map(m => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Priority (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Priority <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="gen-task-priority"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={priority}
                        onChange={e => setPriority(e.target.value as 'high' | 'normal' | 'low')}
                        disabled={isSubmitting || isQueued}
                    >
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                    </select>
                </div>

                {/* Depth (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Depth <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="gen-task-depth"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={depth}
                        onChange={e => setDepth(e.target.value as 'deep' | 'normal')}
                        disabled={isSubmitting || isQueued}
                    >
                        <option value="deep">Deep (uses go-deep skill)</option>
                        <option value="normal">Normal</option>
                    </select>
                </div>

                {/* Error banner with Retry */}
                {isError && (
                    <div
                        id="gen-task-error"
                        className="flex items-center gap-2 text-xs text-red-500"
                    >
                        <span>{error}</span>
                        <button className="underline" onClick={reset}>
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </Dialog>
    );
}
