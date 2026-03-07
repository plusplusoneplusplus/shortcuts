/**
 * EnqueueDialog — form to enqueue a new AI task.
 * Posts to POST /api/queue/tasks with type 'follow-prompt' for both freeform and skill-based tasks.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { Dialog, FloatingDialog, Button } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { usePreferences } from '../hooks/usePreferences';
import { useImagePaste } from '../hooks/useImagePaste';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ImagePreviews } from '../shared/ImagePreviews';
import { filterGitMetadataFolders } from '../hooks/useTaskTree';
import { getApiBase } from '../utils/config';
import { useMinimizedDialog } from '../context/MinimizedDialogsContext';
import { useSlashCommands } from '../repos/useSlashCommands';
import { SlashCommandMenu } from '../repos/SlashCommandMenu';

interface FolderOption { label: string; value: string; }
interface SkillOption { name: string; description?: string; }

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
    const { isMobile } = useBreakpoint();
    const isAskMode = queueState.dialogMode === 'ask';
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const { model: savedModel, setModel: persistModel, queueTaskSkill: savedQueueTaskSkill, setQueueTaskSkill: persistQueueTaskSkill } = usePreferences(workspaceId);
    const [models, setModels] = useState<string[]>([]);
    const [folders, setFolders] = useState<FolderOption[]>([]);
    const [folderPath, setFolderPath] = useState<string>('');
    const [skills, setSkills] = useState<SkillOption[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const slashCommands = useSlashCommands(skills);

    // Sync model from preferences when loaded
    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seed folderPath and workspaceId from dialog initial values when dialog opens
    useEffect(() => {
        if (!queueState.showDialog) return;
        setFolderPath(queueState.dialogInitialFolderPath ?? '');
        if (queueState.dialogInitialWorkspaceId) {
            setWorkspaceId(queueState.dialogInitialWorkspaceId);
        }
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
                    setFolders(flattenFolders(filterGitMetadataFolders(data)));
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    // Fetch skills when workspaceId changes
    useEffect(() => {
        setSkills([]);
        setSelectedSkill('');
        if (!workspaceId) return;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/skills')
            .then((data: any) => {
                if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore saved Queue Task skill when both preferences and skills are loaded
    useEffect(() => {
        if (savedQueueTaskSkill && skills.length > 0 && !selectedSkill) {
            const match = skills.find(s => s.name === savedQueueTaskSkill);
            if (match) {
                setSelectedSkill(savedQueueTaskSkill);
            }
        }
    }, [savedQueueTaskSkill, skills]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleModelChange = useCallback((value: string) => {
        setModel(value);
        persistModel(value);
    }, [persistModel]);

    const handleSkillChange = useCallback((value: string) => {
        setSelectedSkill(value);
    }, []);

    const handleSubmit = useCallback(async () => {
        // Parse /skill tokens from prompt text
        const { skills: slashSkills, prompt: cleanedPrompt } = slashCommands.parseAndExtract(prompt);
        const effectiveSkill = selectedSkill || slashSkills[0] || '';
        const effectivePrompt = effectiveSkill ? cleanedPrompt : prompt.trim();

        if (!effectiveSkill && !effectivePrompt) return;
        setSubmitting(true);
        try {
            if (isAskMode) {
                // Ask mode: create a read-only chat task
                const ws = appState.workspaces.find((w: any) => w.id === workspaceId);
                const body: any = {
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt: effectivePrompt || `Ask: ${effectiveSkill}`,
                        workspaceId: workspaceId || undefined,
                        workingDirectory: ws?.rootPath || undefined,
                        ...(effectiveSkill ? { context: { skills: [effectiveSkill] } } : {}),
                    },
                    images: images.length > 0 ? images : undefined,
                };
                if (model) body.config = { model };
                await fetch(getApiBase() + '/queue/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } else if (effectiveSkill) {
                // Skill-based task
                const ws = appState.workspaces.find((w: any) => w.id === workspaceId);
                const workingDirectory = ws?.rootPath || '';
                const body: any = {
                    type: 'chat',
                    priority: 'normal',
                    displayName: `Skill: ${effectiveSkill}`,
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt: effectivePrompt || `Use the ${effectiveSkill} skill.`,
                        workingDirectory,
                        context: {
                            skills: [effectiveSkill],
                        },
                    },
                    images: images.length > 0 ? images : undefined,
                };
                if (model) body.config = { model };
                await fetch(getApiBase() + '/queue/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } else {
                // Freeform prompt
                const ws = appState.workspaces.find((w: any) => w.id === workspaceId);
                const body: any = {
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt: effectivePrompt,
                        workingDirectory: ws?.rootPath || folderPath || undefined,
                    },
                    images: images.length > 0 ? images : undefined,
                };
                if (model) body.config = { model };
                await fetch(getApiBase() + '/queue/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }
            setPrompt('');
            setSelectedSkill('');
            persistQueueTaskSkill(effectiveSkill);
            // Record skill usage for ordering
            if (effectiveSkill && workspaceId) {
                fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/preferences/skill-usage`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skillName: effectiveSkill }),
                }).catch(() => { /* ignore */ });
            }
            clearImages();
            queueDispatch({ type: 'CLOSE_DIALOG' });
        } catch { /* ignore */ }
        finally { setSubmitting(false); }
    }, [prompt, model, workspaceId, folderPath, selectedSkill, images, appState.workspaces, queueDispatch, clearImages, persistQueueTaskSkill, slashCommands, isAskMode]);

    const handleSlashSelect = useCallback((name: string) => {
        slashCommands.selectSkill(name, prompt, setPrompt);
        setSelectedSkill(name);
    }, [slashCommands, prompt]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (slashCommands.handleKeyDown(e)) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                if (selected) handleSlashSelect(selected.name);
            }
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !submitting) {
            e.preventDefault();
            handleSubmit();
        }
    }, [submitting, handleSubmit, slashCommands, handleSlashSelect]);

    // Reset minimized state when dialog closes externally
    useEffect(() => {
        if (!queueState.showDialog) setMinimized(false);
    }, [queueState.showDialog]);

    const handleMinimize = useCallback(() => setMinimized(true), []);
    const handleRestore = useCallback(() => setMinimized(false), []);
    const handleClose = useCallback(() => {
        setMinimized(false);
        queueDispatch({ type: 'CLOSE_DIALOG' });
    }, [queueDispatch]);

    // Derive pill label: truncated prompt or fallback
    const pillPreview = prompt.trim().length > 0
        ? (prompt.trim().length > 30 ? prompt.trim().slice(0, 30) + '…' : prompt.trim())
        : undefined;

    const minimizedEntry = useMemo(() => {
        if (!minimized || !queueState.showDialog) return null;
        return {
            id: 'enqueue-task',
            icon: '📋',
            label: 'Enqueue Task',
            preview: pillPreview,
            onRestore: handleRestore,
            onClose: handleClose,
        };
    }, [minimized, queueState.showDialog, pillPreview, handleRestore, handleClose]);
    useMinimizedDialog(minimizedEntry);

    if (minimized) return null;

    const dialogContent = (
        <div className="flex flex-col gap-3">
            <div>
                <label className="block text-xs font-medium text-[#848484] mb-1">Prompt</label>
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={e => {
                            setPrompt(e.target.value);
                            slashCommands.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                        }}
                        onPaste={submitting ? undefined : addFromPaste}
                        onKeyDown={handleKeyDown}
                        placeholder={selectedSkill ? `Additional context for ${selectedSkill} skill (optional)` : 'Enter your prompt… Type / for skills'}
                        rows={4}
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-y"
                    />
                    <SlashCommandMenu
                        skills={skills}
                        filter={slashCommands.menuFilter}
                        onSelect={handleSlashSelect}
                        onDismiss={slashCommands.dismissMenu}
                        visible={slashCommands.menuVisible}
                        highlightIndex={slashCommands.highlightIndex}
                    />
                </div>
                <ImagePreviews images={images} onRemove={removeImage} showHint />
            </div>
            {workspaceId && skills.length > 0 && (
                <div>
                    <label className="block text-xs font-medium text-[#848484] mb-1">Skill (optional)</label>
                    <select
                        value={selectedSkill}
                        onChange={e => handleSkillChange(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                        data-testid="skill-select"
                    >
                        <option value="">None</option>
                        {skills.map(s => (
                            <option key={s.name} value={s.name}>
                                ⚡ {s.name}{s.description ? ` — ${s.description}` : ''}
                            </option>
                        ))}
                    </select>
                </div>
            )}
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
    );

    const dialogTitle = isAskMode ? 'Ask AI (Read-only)' : 'Enqueue AI Task';
    const submitLabel = isAskMode ? 'Ask' : 'Enqueue';

    const footer = (
        <>
            <Button variant="secondary" onClick={() => queueDispatch({ type: 'CLOSE_DIALOG' })}>
                Cancel
            </Button>
            <Button
                variant="primary"
                onClick={handleSubmit}
                loading={submitting}
                disabled={!selectedSkill && !prompt.trim()}
                title="Ctrl+Enter"
            >
                {submitLabel}
            </Button>
        </>
    );

    if (!isMobile) {
        return (
            <FloatingDialog
                open={queueState.showDialog}
                onClose={() => queueDispatch({ type: 'CLOSE_DIALOG' })}
                onMinimize={submitting ? undefined : handleMinimize}
                title={dialogTitle}
                footer={footer}
                resizable
            >
                {dialogContent}
            </FloatingDialog>
        );
    }

    return (
        <Dialog
            open={queueState.showDialog}
            onClose={() => queueDispatch({ type: 'CLOSE_DIALOG' })}
            onMinimize={submitting ? undefined : handleMinimize}
            title={dialogTitle}
            footer={footer}
        >
            {dialogContent}
        </Dialog>
    );
}
