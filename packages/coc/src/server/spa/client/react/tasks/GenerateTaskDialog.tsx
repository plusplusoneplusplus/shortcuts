/**
 * GenerateTaskDialog — modal dialog for AI-powered task generation.
 *
 * Submits the task to the queue via useQueueTaskGeneration, then closes.
 * The user can track progress in the Queue tab.
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Dialog, Button, ImageLightbox } from '../shared';
import { useQueueTaskGeneration } from '../hooks/useQueueTaskGeneration';
import { usePreferences } from '../hooks/usePreferences';
import { useImagePaste } from '../hooks/useImagePaste';
import { useGlobalToast } from '../context/ToastContext';
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
    /** Whether the dialog is currently minimized into a pill. */
    minimized?: boolean;
    /** Called when the user wants to minimize the dialog. */
    onMinimize?: () => void;
    /** Called when the user wants to restore from minimized state. */
    onRestore?: () => void;
    /** Called when the task is successfully queued; receives the taskId. */
    onSuccess: (taskId: string) => void;
    /** Called when the user cancels or closes without completing. */
    onClose: () => void;
}

// ── component ────────────────────────────────────────────────────────────────

export function GenerateTaskDialog({
    wsId,
    initialFolder = '',
    minimized = false,
    onMinimize,
    onRestore,
    onSuccess,
    onClose,
}: GenerateTaskDialogProps) {
    // --- preferences (persisted model + depth) ---
    const { model: savedModel, setModel: persistModel, depth: savedDepth, setDepth: persistDepth } = usePreferences();
    const { addToast } = useGlobalToast();

    // --- form state ---
    const [prompt, setPrompt] = useState('');
    const [name, setName] = useState('');
    const [targetFolder, setTargetFolder] = useState(initialFolder);
    const [model, setModel] = useState('');
    const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
    const [depth, setDepth] = useState<'deep' | 'normal'>('deep');
    const [includeContext, setIncludeContext] = useState(false);

    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (savedDepth === 'deep' || savedDepth === 'normal') setDepth(savedDepth);
    }, [savedDepth]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- data ---
    const [models, setModels] = useState<string[]>([]);
    const [folders, setFolders] = useState<string[]>(['']);

    // --- hook ---
    const { status, taskId, error, enqueue, reset } =
        useQueueTaskGeneration(wsId);

    // --- image paste ---
    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();

    // --- image lightbox ---
    const [viewImageIndex, setViewImageIndex] = useState<number | null>(null);

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

    // --- notify parent after successful enqueue (user navigates to Queue tab manually) ---
    useEffect(() => {
        if (status === 'queued') {
            addToast(`Task queued${taskId ? ` (${taskId.slice(0, 8)})` : ''}`, 'success');
            clearImages();
            onSuccess(taskId || '');
        }
    }, [status, taskId, addToast, clearImages, onSuccess]);

    const handleGenerate = useCallback(() => {
        enqueue({
            prompt: prompt.trim(),
            name: name.trim() || undefined,
            targetFolder: targetFolder || undefined,
            model: model || undefined,
            mode: includeContext ? 'from-feature' : undefined,
            depth,
            priority,
            images: images.length > 0 ? images : undefined,
        });
    }, [prompt, name, targetFolder, model, includeContext, depth, priority, images, enqueue]);

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
                Generate <kbd className="ml-1 text-[9px] opacity-60">Ctrl+Enter</kbd>
            </Button>
        </>
    );

    // ── minimized pill ─────────────────────────────────────────────────────
    if (minimized) {
        const preview = prompt.trim().length > 30 ? prompt.trim().slice(0, 30) + '…' : prompt.trim();
        return ReactDOM.createPortal(
            <div
                data-testid="generate-task-pill"
                className="fixed bottom-4 right-4 z-[10001] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] cursor-pointer hover:shadow-xl transition-shadow"
                onClick={onRestore}
            >
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">✨ Generate Task</span>
                {preview && (
                    <span className="text-xs text-[#848484] max-w-[160px] truncate" data-testid="pill-prompt-preview">
                        ▪ &ldquo;{preview}&rdquo;
                    </span>
                )}
                <span
                    className="ml-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                    data-testid="pill-restore-btn"
                >
                    Restore
                </span>
            </div>,
            document.body,
        );
    }

    // ── full dialog ─────────────────────────────────────────────────────────
    return (
        <Dialog
            open
            id="generate-task-overlay"
            onClose={isSubmitting ? undefined : onClose}
            onMinimize={isSubmitting ? undefined : onMinimize}
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
                        onKeyDown={e => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim() && !isSubmitting && !isQueued) {
                                e.preventDefault();
                                handleGenerate();
                            }
                        }}
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
                                        className="w-[80px] h-[80px] object-cover rounded border border-[#e0e0e0] dark:border-[#3c3c3c] cursor-zoom-in"
                                        onClick={() => setViewImageIndex(i)}
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

                {/* Include folder context (optional) */}
                <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input
                        id="gen-task-include-context"
                        type="checkbox"
                        className="mt-0.5"
                        checked={includeContext}
                        onChange={e => setIncludeContext(e.target.checked)}
                        disabled={isSubmitting || isQueued}
                    />
                    <span className="flex flex-col">
                        <span className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Include folder context</span>
                        <span className="text-[10px] text-[#848484]">Attach plan.md, spec.md, and related files from the target folder</span>
                    </span>
                </label>

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
                        onChange={e => {
                            setDepth(e.target.value as 'deep' | 'normal');
                            persistDepth(e.target.value);
                        }}
                        disabled={isSubmitting || isQueued}
                    >
                        <option value="deep">Deep (uses go-deep skill)</option>
                        <option value="normal">Normal</option>
                    </select>
                </div>

                {/* Image lightbox */}
                <ImageLightbox
                    src={viewImageIndex !== null ? images[viewImageIndex] : null}
                    alt={viewImageIndex !== null ? `Attachment ${viewImageIndex + 1}` : undefined}
                    onClose={() => setViewImageIndex(null)}
                />

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
