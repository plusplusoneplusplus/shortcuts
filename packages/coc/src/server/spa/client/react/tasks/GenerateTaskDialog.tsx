/**
 * GenerateTaskDialog — modal dialog for AI-powered task generation.
 *
 * Submits the task to the queue via useQueueTaskGeneration, then closes.
 * The user can track progress in the Queue tab.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, FloatingDialog, Button, ImageLightbox } from '../shared';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useQueueTaskGeneration } from '../hooks/useQueueTaskGeneration';
import { usePreferences } from '../hooks/usePreferences';
import { useImagePaste } from '../hooks/useImagePaste';
import { useGlobalToast } from '../context/ToastContext';
import { useMinimizedDialog } from '../context/MinimizedDialogsContext';
import { type TaskFolder, filterGitMetadataFolders } from '../hooks/useTaskTree';
import { getApiBase } from '../utils/config';

// ── helpers ──────────────────────────────────────────────────────────────────

const AUTO_FOLDER_SENTINEL = '__auto__';
const FOLDER_STORAGE_KEY = 'coc.generateTask.lastFolder';

function flattenFolders(folder: TaskFolder, acc: string[] = []): string[] {
    acc.push(folder.relativePath);
    for (const child of folder.children) flattenFolders(child, acc);
    return acc;
}

// ── effort presets ──────────────────────────────────────────────────────────

export type EffortLevel = 'low' | 'medium' | 'high';
export type ConfigTab = 'effort' | 'advanced';

interface EffortPreset {
    modelPicker: (models: string[]) => string;
    priority: 'high' | 'normal' | 'low';
    depth: 'deep' | 'normal';
}

function pickModel(models: string[], keywords: string[]): string {
    for (const kw of keywords) {
        const found = models.find(m => m.toLowerCase().includes(kw));
        if (found) return found;
    }
    return '';
}

export const EFFORT_PRESETS: Record<EffortLevel, EffortPreset> = {
    low: {
        modelPicker: (models) => pickModel(models, ['sonnet', 'gpt-5.4', 'pro']),
        priority: 'normal',
        depth: 'normal',
    },
    medium: {
        modelPicker: (models) => pickModel(models, ['opus', 'gpt-5.3', 'codex', 'premium']),
        priority: 'normal',
        depth: 'normal',
    },
    high: {
        modelPicker: (models) => pickModel(models, ['opus', 'gpt-5.3', 'codex', 'premium']),
        priority: 'normal',
        depth: 'deep',
    },
};

const EFFORT_DESCRIPTIONS: Record<EffortLevel, string> = {
    low: 'Sonnet-class model, normal analysis',
    medium: 'Opus-class model, normal analysis',
    high: 'Opus-class model, deep analysis',
};

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
    // --- breakpoint ---
    const { isMobile } = useBreakpoint();

    // --- preferences (persisted model + depth + effort) ---
    const { models: savedModels, setModel: persistModel, depth: savedDepth, setDepth: persistDepth, effort: savedEffort, setEffort: persistEffort } = usePreferences(wsId);
    const { addToast } = useGlobalToast();

    // --- form state ---
    const [prompt, setPrompt] = useState('');
    const [name, setName] = useState('');
    const [targetFolder, setTargetFolder] = useState(
        initialFolder || localStorage.getItem(FOLDER_STORAGE_KEY) || AUTO_FOLDER_SENTINEL
    );
    const [model, setModel] = useState('');
    const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
    const [depth, setDepth] = useState<'deep' | 'normal'>('deep');
    const [includeContext, setIncludeContext] = useState(false);
    const [configTab, setConfigTab] = useState<ConfigTab>('effort');
    const [effortLevel, setEffortLevel] = useState<EffortLevel>('medium');

    useEffect(() => {
        if (savedModels.task && !model) setModel(savedModels.task);
    }, [savedModels]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (savedDepth === 'deep' || savedDepth === 'normal') setDepth(savedDepth);
    }, [savedDepth]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (savedEffort === 'low' || savedEffort === 'medium' || savedEffort === 'high') setEffortLevel(savedEffort);
    }, [savedEffort]); // eslint-disable-line react-hooks/exhaustive-deps

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
        let finalModel = model;
        let finalPriority = priority;
        let finalDepth = depth;
        if (configTab === 'effort') {
            const preset = EFFORT_PRESETS[effortLevel];
            finalModel = preset.modelPicker(models);
            finalPriority = preset.priority;
            finalDepth = preset.depth;
        }
        enqueue({
            prompt: prompt.trim(),
            name: name.trim() || undefined,
            targetFolder: targetFolder || undefined,
            model: finalModel || undefined,
            mode: includeContext ? 'from-feature' : undefined,
            depth: finalDepth,
            priority: finalPriority,
            images: images.length > 0 ? images : undefined,
        });
    }, [prompt, name, targetFolder, model, includeContext, depth, priority, images, enqueue, configTab, effortLevel, models]);

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

    // ── register with minimized dialogs tray ───────────────────────────────
    const pillPreview = prompt.trim().length > 30 ? prompt.trim().slice(0, 30) + '…' : prompt.trim();
    const minimizedEntry = useMemo(() => {
        if (!minimized || !onRestore) return null;
        return {
            id: 'generate-task',
            icon: '✨',
            label: 'Generate Plan',
            preview: pillPreview || undefined,
            onRestore,
        };
    }, [minimized, pillPreview, onRestore]);
    useMinimizedDialog(minimizedEntry);

    if (minimized) return null;

    // ── full dialog ─────────────────────────────────────────────────────────
    const dialogContent = (
        <div className="flex flex-col gap-4">
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
                        onChange={e => {
                            setTargetFolder(e.target.value);
                            localStorage.setItem(FOLDER_STORAGE_KEY, e.target.value);
                        }}
                        disabled={isSubmitting || isQueued}
                    >
                        <option value={AUTO_FOLDER_SENTINEL}>✨ Auto (AI decides)</option>
                        <option value="">Root</option>
                        {folders
                            .filter(f => f !== '')
                            .map(f => (
                                <option key={f} value={f}>
                                    {f}
                                </option>
                            ))}
                    </select>
                    {targetFolder === AUTO_FOLDER_SENTINEL && (
                        <p className="text-[10px] text-[#848484] mt-0.5">✨ AI will choose an existing folder or create a new one based on the task.</p>
                    )}
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

                {/* ── Configuration tabs ─────────────────────────────────── */}
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-3 mt-1">
                    <div className="flex gap-1 mb-3" role="tablist" data-testid="config-tabs">
                        <button
                            role="tab"
                            data-testid="tab-effort"
                            aria-selected={configTab === 'effort'}
                            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                                configTab === 'effort'
                                    ? 'bg-[#0078d4] text-white'
                                    : 'bg-[#f0f0f0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999] hover:bg-[#e0e0e0] dark:hover:bg-[#4c4c4c]'
                            }`}
                            onClick={() => setConfigTab('effort')}
                            disabled={isSubmitting || isQueued}
                        >
                            Effort
                        </button>
                        <button
                            role="tab"
                            data-testid="tab-advanced"
                            aria-selected={configTab === 'advanced'}
                            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                                configTab === 'advanced'
                                    ? 'bg-[#0078d4] text-white'
                                    : 'bg-[#f0f0f0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999] hover:bg-[#e0e0e0] dark:hover:bg-[#4c4c4c]'
                            }`}
                            onClick={() => setConfigTab('advanced')}
                            disabled={isSubmitting || isQueued}
                        >
                            Advanced
                        </button>
                    </div>

                    {/* Effort tab */}
                    {configTab === 'effort' && (
                        <div data-testid="effort-panel" className="flex gap-2">
                            {(['low', 'medium', 'high'] as EffortLevel[]).map(level => (
                                <button
                                    key={level}
                                    data-testid={`effort-${level}`}
                                    className={`flex-1 px-3 py-2 text-xs rounded-md font-medium border transition-colors ${
                                        effortLevel === level
                                            ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4] dark:text-[#3794ff]'
                                            : 'border-[#e0e0e0] dark:border-[#3c3c3c] text-[#616161] dark:text-[#999] hover:border-[#0078d4]/50'
                                    }`}
                                    onClick={() => { setEffortLevel(level); persistEffort(level); }}
                                    disabled={isSubmitting || isQueued}
                                >
                                    <span>{level.charAt(0).toUpperCase() + level.slice(1)}</span>
                                    <span className="block text-[10px] font-normal opacity-70 mt-0.5">{EFFORT_DESCRIPTIONS[level]}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Advanced tab */}
                    {configTab === 'advanced' && (
                        <div data-testid="advanced-panel" className="flex flex-col gap-4">
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
                                        persistModel('task', e.target.value);
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
                        </div>
                    )}
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
    );

    if (!isMobile) {
        return (
            <FloatingDialog
                open
                id="generate-task-overlay"
                onClose={isSubmitting ? undefined : onClose}
                onMinimize={isSubmitting ? undefined : onMinimize}
                disableClose={isSubmitting}
                title="Generate Plan"
                className="max-w-[600px]"
                footer={footer}
                resizable
            >
                {dialogContent}
            </FloatingDialog>
        );
    }

    return (
        <Dialog
            open
            id="generate-task-overlay"
            onClose={isSubmitting ? undefined : onClose}
            onMinimize={isSubmitting ? undefined : onMinimize}
            disableClose={isSubmitting}
            title="Generate Plan"
            className="max-w-[600px]"
            footer={footer}
        >
            {dialogContent}
        </Dialog>
    );
}
