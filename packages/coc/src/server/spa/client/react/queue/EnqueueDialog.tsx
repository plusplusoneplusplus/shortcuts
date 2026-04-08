/**
 * EnqueueDialog — form to enqueue a new AI task.
 * Posts to POST /api/queue/tasks with type 'follow-prompt' for both freeform and skill-based tasks.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { Dialog, FloatingDialog, Button } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useModels } from '../hooks/useModels';
import { usePreferences } from '../hooks/usePreferences';
import { useImagePaste } from '../hooks/useImagePaste';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ImagePreviews } from '../shared/ImagePreviews';
import { filterGitMetadataFolders } from '../hooks/useTaskTree';
import { getApiBase } from '../utils/config';
import { useMinimizedDialog } from '../context/MinimizedDialogsContext';
import { useSlashCommands } from '../repos/useSlashCommands';
import { SlashCommandMenu } from '../repos/SlashCommandMenu';
import { useSkillTemplates } from '../hooks/useSkillTemplates';
import { TemplatesTab } from './TemplatesTab';
import { useFloatingChats } from '../context/FloatingChatsContext';
import { SkillPicker } from './SkillPicker';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import type { PostAction } from '../../../task-types';

interface HookEntry {
    id: string;
    timing: 'before' | 'after';
    type: 'script' | 'skill';
    script: string;
    skillName: string;
    prompt: string;
}

interface FolderOption { label: string; value: string; }
interface SkillOption { name: string; description?: string; }

export function flattenFolders(node: any, depth = 0): FolderOption[] {
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
    const { state: appState, dispatch: appDispatch } = useApp();
    const { isMobile } = useBreakpoint();
    const { floatChat } = useFloatingChats();
    const isAskMode = queueState.dialogMode === 'ask';
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const [activeTab, setActiveTab] = useState<'templates' | 'advanced'>('advanced');
    const hasAutoSwitchedTab = useRef(false);
    const { models: savedModels, setModel: persistModel, skills: savedSkills, setSkill: persistSkill } = usePreferences(workspaceId);
    const { templates, saveTemplate, deleteTemplate, loaded: templatesLoaded } = useSkillTemplates(workspaceId || undefined);
    const { models: modelInfos } = useModels();
    const enabledModels = modelInfos.filter(m => m.enabled);
    const models = [...new Set(
        (enabledModels.length > 0 ? enabledModels : modelInfos)
            .map(m => m.id)
            .filter(Boolean)
    )];
    const [folders, setFolders] = useState<FolderOption[]>([]);
    const [folderPath, setFolderPath] = useState<string>('');
    const [skills, setSkills] = useState<SkillOption[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [hooks, setHooks] = useState<HookEntry[]>([]);

    const currentPostActions: PostAction[] = useMemo(() =>
        hooks
            .filter(h => h.timing === 'after' && ((h.type === 'script' && h.script.trim()) || (h.type === 'skill' && h.skillName)))
            .map(h => {
                if (h.type === 'script') return { type: 'script' as const, script: h.script.trim() };
                return { type: 'skill' as const, skillName: h.skillName, ...(h.prompt.trim() ? { prompt: h.prompt.trim() } : {}) };
            }),
        [hooks],
    );

    const addHook = () => setHooks(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timing: 'after',
        type: 'script',
        script: '',
        skillName: '',
        prompt: '',
    }]);

    const removeHook = (id: string) =>
        setHooks(prev => prev.filter(h => h.id !== id));

    const updateHook = (id: string, updates: Partial<HookEntry>) =>
        setHooks(prev => prev.map(h => h.id === id ? { ...h, ...updates } : h));

    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();
    const richTextRef = useRef<RichTextInputHandle>(null);
    const slashCommands = useSlashCommands(skills);
    const [contextFiles, setContextFiles] = useState<string[]>([]);
    const isBulkMode = queueState.dialogBulkMode && contextFiles.length > 1;
    const hasContextFiles = contextFiles.length > 0;

    // Track previous dialog mode to detect mode switches
    const prevModeRef = useRef(isAskMode);

    // Sync model from preferences when loaded (mode-specific).
    // On mode change: always apply the new mode's saved model (or clear).
    // On initial load: apply only when model is empty.
    useEffect(() => {
        if (selectedTemplateId) return;
        const modeChanged = prevModeRef.current !== isAskMode;
        const savedModel = isAskMode ? savedModels.ask : savedModels.task;
        if (modeChanged || !model) {
            setModel(savedModel || '');
        }
    }, [savedModels, isAskMode]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seed folderPath, workspaceId, and context files from dialog initial values when dialog opens
    useEffect(() => {
        if (!queueState.showDialog) return;
        setFolderPath(queueState.dialogInitialFolderPath ?? '');
        if (queueState.dialogInitialWorkspaceId) {
            setWorkspaceId(queueState.dialogInitialWorkspaceId);
        }
        if (queueState.dialogInitialPrompt) {
            setPrompt(queueState.dialogInitialPrompt);
            richTextRef.current?.setValue(queueState.dialogInitialPrompt);
        }
        setContextFiles(queueState.dialogContextFiles ?? []);
    }, [queueState.showDialog]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch folders when workspaceId changes
    useEffect(() => {
        setFolders([]);
        if (!workspaceId) return;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/summary')
            .then((resp: any) => {
                const data = resp?.tasks;
                if (data && typeof data === 'object') {
                    setFolders(flattenFolders(filterGitMetadataFolders(data)));
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    // Fetch skills when workspaceId changes (merged global + repo)
    useEffect(() => {
        setSkills([]);
        setSelectedSkills([]);
        if (!workspaceId) return;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/skills/all')
            .then((data: any) => {
                if (data?.merged && Array.isArray(data.merged)) {
                    setSkills(data.merged);
                } else if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore saved skills for the current dialog mode when both preferences and skills are loaded.
    // On mode change: always apply the new mode's saved skills (or clear).
    // On initial load: apply only when no skills are selected.
    // prevModeRef is updated here (last reader) to keep both restore effects consistent.
    useEffect(() => {
        const modeChanged = prevModeRef.current !== isAskMode;
        prevModeRef.current = isAskMode;

        if (selectedTemplateId && !modeChanged) return;
        const mode = isAskMode ? 'ask' : 'task';
        const savedSkillArr = savedSkills[mode];
        if (savedSkillArr && savedSkillArr.length > 0 && skills.length > 0 && (modeChanged || selectedSkills.length === 0)) {
            const valid = savedSkillArr.filter((s: string) => skills.some(sk => sk.name === s));
            if (valid.length > 0) { setSelectedSkills(valid); return; }
        }
        if (modeChanged) setSelectedSkills([]);
    }, [savedSkills, skills, isAskMode]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleModelChange = useCallback((value: string) => {
        setModel(value);
        setSelectedTemplateId(null);
        persistModel(isAskMode ? 'ask' : 'task', value);
    }, [persistModel, isAskMode]);

    const handleSkillChange = useCallback((name: string) => {
        setSelectedSkills(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
        setSelectedTemplateId(null);
    }, []);

    const handleSelectTemplate = useCallback((t: import('../hooks/useSkillTemplates').SkillTemplate) => {
        setSelectedSkills(t.skills);
        setModel(t.model);
        if (t.mode !== (isAskMode ? 'ask' : 'task')) {
            queueDispatch({ type: 'SET_DIALOG_MODE', mode: t.mode });
        }
        setSelectedTemplateId(t.id);
        // Restore hooks from template postActions
        if (t.postActions && t.postActions.length > 0) {
            setHooks(t.postActions.map((pa, i) => ({
                id: `tpl-${i}-${Date.now()}`,
                timing: 'after' as const,
                type: pa.type,
                script: pa.type === 'script' ? pa.script : '',
                skillName: pa.type === 'skill' ? pa.skillName : '',
                prompt: (pa.type === 'skill' ? pa.prompt : undefined) ?? '',
            })));
        } else {
            setHooks([]);
        }
    }, [isAskMode, queueDispatch]);

    const handleSaveTemplate = useCallback(() => {
        const mode = isAskMode ? 'ask' : 'task';
        const postActions: PostAction[] = hooks
            .filter(h => (h.type === 'script' && h.script.trim()) || (h.type === 'skill' && h.skillName))
            .map(h => {
                if (h.type === 'script') return { type: 'script' as const, script: h.script.trim() };
                return { type: 'skill' as const, skillName: h.skillName, ...(h.prompt.trim() ? { prompt: h.prompt.trim() } : {}) };
            });
        saveTemplate({ model: model || '', mode, skills: selectedSkills, postActions });
    }, [isAskMode, model, selectedSkills, hooks, saveTemplate]);

    const handleSubmit = useCallback(async () => {
        // Parse /skill tokens from prompt text (skills are extracted but prompt is kept intact)
        const rawText = richTextRef.current?.getValue() ?? prompt;
        const { skills: slashSkills } = slashCommands.parseAndExtract(rawText);
        const effectiveSkills = [...new Set([...selectedSkills, ...slashSkills])];
        const effectivePrompt = rawText.trim();

        if (effectiveSkills.length === 0 && !effectivePrompt) return;
        setSubmitting(true);
        queueDispatch({ type: 'SET_TASK_SUBMITTING', value: true });
        try {
            const ws = appState.workspaces.find((w: any) => w.id === workspaceId);
            const workingDirectory = ws?.rootPath || '';
            const contextTaskName = queueState.dialogContextTaskName;

            // Helper to build a single task body, optionally with context files
            const buildBody = (files?: string[], taskNameOverride?: string): any => {
                const skillLabel = effectiveSkills.length === 1 ? effectiveSkills[0] : effectiveSkills.join(', ');
                let body: any;
                if (isAskMode) {
                    body = {
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            mode: 'ask',
                            prompt: effectivePrompt || `Ask: ${skillLabel}`,
                            workspaceId: workspaceId || undefined,
                            workingDirectory: workingDirectory || undefined,
                            ...(effectiveSkills.length > 0 || files ? { context: { ...(effectiveSkills.length > 0 ? { skills: effectiveSkills } : {}), ...(files ? { files } : {}) } } : {}),
                        },
                        images: images.length > 0 ? images : undefined,
                    };
                } else if (effectiveSkills.length > 0) {
                    const displayLabel = taskNameOverride || contextTaskName;
                    const displayName = displayLabel
                        ? `Follow: ${skillLabel} on ${displayLabel}`
                        : effectiveSkills.length === 1
                            ? `Skill: ${effectiveSkills[0]}`
                            : `Skills: ${effectiveSkills.join(', ')}`;
                    body = {
                        type: 'chat',
                        priority: 'normal',
                        displayName,
                        payload: {
                            kind: 'chat',
                            mode: 'autopilot',
                            prompt: effectivePrompt || `Use the ${skillLabel} skill${effectiveSkills.length > 1 ? 's' : ''}.`,
                            workingDirectory,
                            context: {
                                skills: effectiveSkills,
                                ...(files ? { files } : {}),
                            },
                        },
                        images: images.length > 0 ? images : undefined,
                    };
                } else {
                    body = {
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            mode: 'autopilot',
                            prompt: effectivePrompt,
                            workingDirectory: workingDirectory || folderPath || undefined,
                            ...(files ? { context: { files } } : {}),
                        },
                        images: images.length > 0 ? images : undefined,
                    };
                }
                if (model) body.config = { model };
                // Before-hooks: take the first script-type before hook (backward compat)
                const beforeHook = hooks.find(h => h.timing === 'before' && h.type === 'script' && h.script.trim());
                if (beforeHook) body.payload.beforeScript = beforeHook.script.trim();

                // After-hooks → postActions array
                const afterHooks = hooks.filter(h => h.timing === 'after' && (
                    (h.type === 'script' && h.script.trim()) ||
                    (h.type === 'skill' && h.skillName)
                ));
                if (afterHooks.length > 0) {
                    body.payload.postActions = afterHooks.map(h => {
                        if (h.type === 'script') return { type: 'script' as const, script: h.script.trim() };
                        return { type: 'skill' as const, skillName: h.skillName, ...(h.prompt.trim() ? { prompt: h.prompt.trim() } : {}) };
                    });
                }
                // Backward compat: also set afterScript if there's exactly one script-type after hook
                if (afterHooks.length === 1 && afterHooks[0].type === 'script') {
                    body.payload.afterScript = afterHooks[0].script.trim();
                }
                return body;
            };

            if (isBulkMode) {
                // Bulk mode: one task per context file
                let succeeded = 0;
                let failed = 0;
                for (const file of contextFiles) {
                    const taskNameFromFile = file.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? '';
                    const body = buildBody([file], taskNameFromFile);
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
                // Bulk results are reported but we don't float chat for bulk
                if (failed > 0 && succeeded === 0) {
                    // All failed — just continue to cleanup
                }
            } else {
                // Single task (may include context files)
                const body = buildBody(
                    contextFiles.length > 0 ? contextFiles : undefined,
                );
                const res = await fetch(getApiBase() + '/queue/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (queueState.dialogLaunchMode === 'floating-chat') {
                    const created = await res.json().catch(() => null);
                    const createdId = created?.task?.id ?? created?.id;
                    if (createdId) {
                        floatChat({
                            taskId: createdId,
                            workspaceId: workspaceId || undefined,
                            title: (effectivePrompt || 'Ask AI').slice(0, 60),
                            status: 'running',
                        });
                    }
                }
            }
            setPrompt('');
            richTextRef.current?.setValue('');
            setSelectedSkills([]);
            setHooks([]);
            setContextFiles([]);
            persistSkill(isAskMode ? 'ask' : 'task', effectiveSkills);
            // Record skill usage for ordering
            for (const sk of effectiveSkills) {
                if (sk && workspaceId) {
                    fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/preferences/skill-usage`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ skillName: sk }),
                    }).catch(() => { /* ignore */ });
                }
            }
            clearImages();
            if (!appState.onboardingProgress?.hasRunWorkflow) {
                appDispatch({ type: 'UPDATE_ONBOARDING', payload: { hasRunWorkflow: true } });
            }
            queueDispatch({ type: 'CLOSE_DIALOG' });
        } catch { /* ignore */ }
        finally { setSubmitting(false); queueDispatch({ type: 'SET_TASK_SUBMITTING', value: false }); }
    }, [prompt, model, workspaceId, folderPath, selectedSkills, images, contextFiles, isBulkMode, appState.workspaces, appState.onboardingProgress, appDispatch, queueDispatch, clearImages, persistSkill, slashCommands, isAskMode, floatChat, queueState.dialogLaunchMode, queueState.dialogContextTaskName, hooks]);

    const handleSlashSelect = useCallback((name: string) => {
        slashCommands.selectSkill(name, prompt, setPrompt, richTextRef);
        setSelectedSkills(prev => prev.includes(name) ? prev : [...prev, name]);
    }, [slashCommands, prompt]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
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

    // When the dialog opens (or templates finish loading while open),
    // pick the default tab: Templates if mode-filtered templates exist, else Advanced.
    // The ref guard ensures this runs only once per dialog open so manual tab switches stick.
    useEffect(() => {
        if (!queueState.showDialog) {
            hasAutoSwitchedTab.current = false;
            return;
        }
        if (!templatesLoaded || hasAutoSwitchedTab.current) return;
        hasAutoSwitchedTab.current = true;
        const currentMode = isAskMode ? 'ask' : 'task';
        const filtered = templates.filter(t => t.mode === currentMode);
        setActiveTab(filtered.length > 0 ? 'templates' : 'advanced');
    }, [queueState.showDialog, templatesLoaded, templates, isAskMode]);

    // Reset minimized state when dialog closes externally
    useEffect(() => {
        if (!queueState.showDialog) setMinimized(false);
    }, [queueState.showDialog]);

    const handleMinimize = useCallback(() => setMinimized(true), []);
    const handleRestore = useCallback(() => setMinimized(false), []);
    const handleClose = useCallback(() => {
        setMinimized(false);
        setHooks([]);
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
            {/* Context files chips (document-context mode) */}
            {hasContextFiles && (
                <div data-testid="context-files-section">
                    <label className="block text-xs font-medium text-[#848484] mb-1">Context</label>
                    {isBulkMode && (
                        <div className="text-xs text-[#616161] dark:text-[#999] mb-1" data-testid="bulk-mode-banner">
                            {contextFiles.length} file{contextFiles.length !== 1 ? 's' : ''} — one task per file
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        {contextFiles.map(f => {
                            const name = f.split(/[/\\]/).pop() || f;
                            return (
                                <span
                                    key={f}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[#e8f0fe] dark:bg-[#1e3a5f] text-[#1e1e1e] dark:text-[#cccccc] border border-[#c4d7f2] dark:border-[#3c5a7f]"
                                    title={f}
                                    data-testid="context-file-chip"
                                >
                                    📄 {name}
                                    <button
                                        type="button"
                                        className="ml-0.5 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                        onClick={() => setContextFiles(prev => prev.filter(p => p !== f))}
                                        aria-label={`Remove ${name}`}
                                    >✕</button>
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}
            {/* Prompt — always visible */}
            <div>
                <label className="block text-xs font-medium text-[#848484] mb-1">Prompt</label>
                <div className="relative">
                    <RichTextInput
                        ref={richTextRef}
                        value={prompt}
                        onChange={(text, cursorPos) => {
                            setPrompt(text);
                            slashCommands.handleInputChange(text, cursorPos);
                        }}
                        onPaste={submitting ? undefined : addFromPaste}
                        onKeyDown={handleKeyDown}
                        disabled={submitting}
                        placeholder={selectedSkills.length > 0 ? `Additional context for ${selectedSkills.join(', ')} (optional)` : 'Enter your prompt… Type / for skills'}
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] min-h-[6rem]"
                        data-testid="prompt-input"
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

            {/* Lower section tab bar: Templates | Advanced */}
            <div className="flex border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                {(['templates', 'advanced'] as const).map(tab => {
                    const modeFilteredCount = templates.filter(t => t.mode === (isAskMode ? 'ask' : 'task')).length;
                    return (<button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 text-xs font-medium capitalize border-b-2 transition-colors ${
                            activeTab === tab
                                ? 'border-[#0078d4] text-[#0078d4]'
                                : 'border-transparent text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                        }`}
                    >
                        {tab === 'templates' ? `Templates${modeFilteredCount > 0 ? ` (${modeFilteredCount})` : ''}` : 'Advanced'}
                    </button>);
                })}
            </div>

            {/* Lower section content */}
            {activeTab === 'templates' ? (
                <TemplatesTab
                    templates={templates}
                    loaded={templatesLoaded}
                    currentModel={model}
                    currentMode={isAskMode ? 'ask' : 'task'}
                    currentSkills={selectedSkills}
                    currentPostActions={currentPostActions}
                    selectedTemplateId={selectedTemplateId}
                    onSelect={handleSelectTemplate}
                    onSave={handleSaveTemplate}
                    onDelete={deleteTemplate}
                />
            ) : (
            <>
            {workspaceId && skills.length > 0 && (
                <SkillPicker
                    skills={skills}
                    selectedSkills={selectedSkills}
                    onSkillChange={handleSkillChange}
                />
            )}
            <details data-testid="hooks-section">
                <summary className="text-xs font-medium text-[#848484] cursor-pointer select-none mb-1">
                    Hooks (optional)
                </summary>
                <div className="flex flex-col gap-2 mt-2">
                    {hooks.map(hook => (
                        <div
                            key={hook.id}
                            data-testid="hook-entry"
                            className="flex items-start gap-2 p-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a]"
                        >
                            {/* Timing selector */}
                            <select
                                value={hook.timing}
                                onChange={e => updateHook(hook.id, { timing: e.target.value as 'before' | 'after' })}
                                className="px-2 py-1.5 text-xs rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                                data-testid="hook-timing"
                            >
                                <option value="before">Before</option>
                                <option value="after">After</option>
                            </select>

                            {/* Type selector */}
                            <select
                                value={hook.type}
                                onChange={e => updateHook(hook.id, { type: e.target.value as 'script' | 'skill' })}
                                className="px-2 py-1.5 text-xs rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                                data-testid="hook-type"
                            >
                                <option value="script">Script</option>
                                <option value="skill">Skill</option>
                            </select>

                            {/* Type-specific inputs */}
                            {hook.type === 'script' ? (
                                <input
                                    type="text"
                                    value={hook.script}
                                    onChange={e => updateHook(hook.id, { script: e.target.value })}
                                    placeholder="./scripts/setup.sh"
                                    className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                                    data-testid="hook-script-input"
                                />
                            ) : (
                                <div className="flex-1 min-w-0 flex flex-col gap-1">
                                    <select
                                        value={hook.skillName}
                                        onChange={e => updateHook(hook.id, { skillName: e.target.value })}
                                        className="w-full px-2 py-1.5 text-xs rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                                        data-testid="hook-skill-select"
                                    >
                                        <option value="">Select skill…</option>
                                        {skills.map(s => (
                                            <option key={s.name} value={s.name}>{s.name}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="text"
                                        value={hook.prompt}
                                        onChange={e => updateHook(hook.id, { prompt: e.target.value })}
                                        placeholder="Optional instructions…"
                                        className="w-full px-2 py-1.5 text-xs rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                                        data-testid="hook-skill-prompt"
                                    />
                                </div>
                            )}

                            {/* Remove button */}
                            <button
                                type="button"
                                onClick={() => removeHook(hook.id)}
                                className="px-1.5 py-1 text-xs text-[#848484] hover:text-[#e51400] transition-colors"
                                title="Remove hook"
                                data-testid="hook-remove"
                            >
                                ✕
                            </button>
                        </div>
                    ))}

                    <button
                        type="button"
                        onClick={addHook}
                        className="self-start inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-dashed border-[#e0e0e0] dark:border-[#555] text-[#848484] hover:border-[#0078d4] hover:text-[#0078d4] transition-colors"
                        data-testid="hook-add"
                    >
                        + Add hook
                    </button>
                </div>
            </details>
            <div className="flex flex-row gap-2">
                <div className="flex-1 min-w-0">
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
                    <div className="flex-1 min-w-0">
                        <label className="block text-xs font-medium text-[#848484] mb-1">Workspace</label>
                        <select
                            value={workspaceId}
                            onChange={e => setWorkspaceId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                        >
                            <option value="">None</option>
                            {appState.workspaces.map((ws: any, i: number) => (
                                <option key={`${ws.id}::${i}`} value={ws.id}>{ws.name || ws.path || ws.id}</option>
                            ))}
                        </select>
                    </div>
                )}
                {workspaceId && folders.length > 0 && (
                    <div className="flex-1 min-w-0">
                        <label className="block text-xs font-medium text-[#848484] mb-1">Folder</label>
                        <select
                            value={folderPath}
                            onChange={e => setFolderPath(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                            data-testid="folder-select"
                        >
                            {folders.map((f, i) => (
                                <option key={`${f.value}::${i}`} value={f.value}>{f.label}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>
            </>
            )}
        </div>
    );

    const dialogTitle = isAskMode ? 'Ask AI (Read-only)' : hasContextFiles ? 'Run Skill' : 'Enqueue AI Task';
    const submitLabel = isAskMode ? 'Ask' : isBulkMode ? `Enqueue ${contextFiles.length} Tasks` : 'Enqueue';

    const footer = (
        <>
            <Button variant="secondary" onClick={() => queueDispatch({ type: 'CLOSE_DIALOG' })}>
                Cancel
            </Button>
            <Button
                variant="primary"
                onClick={handleSubmit}
                loading={submitting}
                disabled={
                    activeTab === 'templates'
                        ? selectedTemplateId === null
                        : selectedSkills.length === 0 && !prompt.trim()
                }
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
