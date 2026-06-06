/**
 * EnqueueDialog — form to enqueue a new AI task.
 * Posts to POST /api/queue with type 'follow-prompt' for both freeform and skill-based tasks.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueue } from '../contexts/QueueContext';
import { useApp } from '../contexts/AppContext';
import { Dialog, FloatingDialog, Button } from '../ui';
import { fetchApi } from '../hooks/useApi';
import { getSpaCocClient } from '../api/cocClient';
import { usePreferences } from '../hooks/preferences/usePreferences';
import { useFileAttachments } from '../features/chat/hooks/useFileAttachments';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { AttachmentPreviews } from '../ui/AttachmentPreviews';
import { filterGitMetadataFolders } from '../tasks/hooks/useTaskTree';
import { useMinimizedDialog } from '../contexts/MinimizedDialogsContext';
import { useSlashCommands } from '../features/chat/hooks/useSlashCommands';
import { SlashCommandMenu } from '../features/chat/SlashCommandMenu';
import { useSkillTemplates } from '../features/templates/hooks/useSkillTemplates';
import { TemplatesTab } from './TemplatesTab';
import { useFloatingChats } from '../contexts/FloatingChatsContext';
import { SkillPicker } from './SkillPicker';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import type { PostAction } from '../../../task-types';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';
import { usePromptAutocomplete } from '../hooks/usePromptAutocomplete';
import { usePromptAutocompleteEnabled } from '../hooks/usePromptAutocompleteEnabled';
import { useChatPromptHistory } from '../hooks/useChatPromptHistory';
import { ModalJobAiControls, useModalJobAiSelection } from '../shared/ModalJobAiControls';
import type { EnqueueTaskRequest } from '@plusplusoneplusplus/coc-client';
import { AttachedContextPreviews } from '../ui/AttachedContextPreviews';
import { formatAttachedContext, useAttachedContext } from '../features/chat/hooks/useAttachedContext';
import { isSessionContextAttachmentsEnabled } from '../utils/config';
import {
    useConversationRetrievalCapability,
    validateSessionContextAttachmentsForSend,
} from '../features/chat/sessionContextDrop';

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
    const { state: appState } = useApp();
    const { updateOnboarding } = useOnboardingPreferences();
    const { isMobile } = useBreakpoint();
    const { floatChat } = useFloatingChats();
    const isAskMode = queueState.dialogMode === 'ask';
    const isResolveMode = queueState.dialogMode === 'resolve';
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const [activeTab, setActiveTab] = useState<'templates' | 'advanced'>('advanced');
    const hasAutoSwitchedTab = useRef(false);
    const { models: savedModels, setModel: persistModel, skills: savedSkills, setSkill: persistSkill } = usePreferences(workspaceId);
    const { templates, saveTemplate, deleteTemplate, loaded: templatesLoaded } = useSkillTemplates(workspaceId || undefined);
    const aiSelection = useModalJobAiSelection({ workspaceId: workspaceId || undefined, mode: isAskMode ? 'ask' : 'autopilot' });
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

    const { attachments, images, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, clearError: clearAttachmentError } = useFileAttachments();
    const attachedContext = useAttachedContext();
    const richTextRef = useRef<RichTextInputHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const slashCommands = useSlashCommands(skills);
    const [contextFiles, setContextFiles] = useState<string[]>([]);
    const isBulkMode = queueState.dialogBulkMode && contextFiles.length > 1;
    const hasContextFiles = contextFiles.length > 0;
    const [promptCursorPos, setPromptCursorPos] = useState(0);
    const [attachedContextError, setAttachedContextError] = useState<string | null>(null);
    const sessionContextAttachmentsEnabled = isSessionContextAttachmentsEnabled();
    const canRetrieveConversations = useConversationRetrievalCapability(
        workspaceId || undefined,
        sessionContextAttachmentsEnabled,
    );
    const promptAutocompleteEnabled = usePromptAutocompleteEnabled();
    const autocomplete = usePromptAutocomplete({
        text: prompt,
        cursorPos: promptCursorPos,
        enabled: promptAutocompleteEnabled && !submitting && !slashCommands.menuVisible,
        workspaceId: workspaceId || undefined,
        surface: 'queue',
    });

    // Bash-style up/down history navigation through past initial prompts.
    const promptHistory = useChatPromptHistory({
        workspaceId: workspaceId || undefined,
        value: prompt,
        cursorPos: promptCursorPos,
        enabled: !submitting,
        setValue: (next) => {
            setPrompt(next);
            setPromptCursorPos(next.length);
            richTextRef.current?.setValue(next, next.length);
        },
    });

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

    useEffect(() => {
        if (!queueState.showDialog) return;
        attachedContext.clear();
        setAttachedContextError(null);
        for (const payload of queueState.dialogAttachedContext ?? []) {
            attachedContext.addSessionContext(payload);
        }
    }, [queueState.showDialog, queueState.dialogAttachedContext]); // eslint-disable-line react-hooks/exhaustive-deps

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
        aiSelection.modelCommand.setModelOverride(value || null);
        setSelectedTemplateId(null);
        persistModel(isAskMode ? 'ask' : 'task', value);
    }, [aiSelection.modelCommand, persistModel, isAskMode]);

    const handleSkillChange = useCallback((name: string) => {
        setSelectedSkills(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
        setSelectedTemplateId(null);
    }, []);

    const handleSelectTemplate = useCallback((t: import('../hooks/useSkillTemplates').SkillTemplate) => {
        setSelectedSkills(t.skills);
        setModel(t.model);
        aiSelection.modelCommand.setModelOverride(t.model || null);
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
    }, [aiSelection.modelCommand, isAskMode, queueDispatch]);

    const handleSaveTemplate = useCallback(() => {
        const mode = isAskMode ? 'ask' : 'task';
        const postActions: PostAction[] = hooks
            .filter(h => (h.type === 'script' && h.script.trim()) || (h.type === 'skill' && h.skillName))
            .map(h => {
                if (h.type === 'script') return { type: 'script' as const, script: h.script.trim() };
                return { type: 'skill' as const, skillName: h.skillName, ...(h.prompt.trim() ? { prompt: h.prompt.trim() } : {}) };
            });
        saveTemplate({ model: aiSelection.validModelOverride || model || '', mode, skills: selectedSkills, postActions });
    }, [isAskMode, model, aiSelection.validModelOverride, selectedSkills, hooks, saveTemplate]);

    const handleSubmit = useCallback(async () => {
        // Parse /skill tokens from prompt text (skills are extracted but prompt is kept intact)
        const rawText = richTextRef.current?.getValue() ?? prompt;
        const { skills: slashSkills } = slashCommands.parseAndExtract(rawText);
        const effectiveSkills = [...new Set([...selectedSkills, ...slashSkills])];
        const contextItems = attachedContext.getItems();
        const sessionContextSendError = validateSessionContextAttachmentsForSend({
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId: workspaceId || undefined,
            currentProcessId: null,
            items: contextItems,
            canRetrieveConversations,
        });
        if (sessionContextSendError) {
            setAttachedContextError(sessionContextSendError);
            return;
        }
        setAttachedContextError(null);
        const effectivePrompt = formatAttachedContext(contextItems) + rawText.trim();

        if (effectiveSkills.length === 0 && !effectivePrompt && !contextFiles.length && !isResolveMode) return;

        // Resolve mode: delegate to the resolve callback instead of the queue API
        if (isResolveMode && queueState.dialogResolveContext) {
            queueState.dialogResolveContext.onSubmit(effectivePrompt, effectiveSkills, aiSelection.resolved.model || model);
            setPrompt('');
            richTextRef.current?.setValue('');
            setSelectedSkills([]);
            setHooks([]);
            clearAttachments();
            attachedContext.clear();
            queueDispatch({ type: 'CLOSE_DIALOG' });
            return;
        }

        setSubmitting(true);
        queueDispatch({ type: 'SET_TASK_SUBMITTING', value: true });
        try {
            const ws = appState.workspaces.find((w: any) => w.id === workspaceId);
            const workingDirectory = ws?.rootPath || '';
            const contextTaskName = queueState.dialogContextTaskName;
            const resolvedAi = aiSelection.resolved;
            const selectedModel = resolvedAi.model || (selectedTemplateId ? model : undefined);
            const buildConfig = (): EnqueueTaskRequest['config'] | undefined => {
                const config: EnqueueTaskRequest['config'] = {
                    ...(selectedModel ? { model: selectedModel } : {}),
                    ...(resolvedAi.reasoningEffort ? { reasoningEffort: resolvedAi.reasoningEffort } : {}),
                };
                return Object.keys(config).length > 0 ? config : undefined;
            };

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
                            provider: resolvedAi.provider,
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
                            workspaceId: workspaceId || undefined,
                            workingDirectory,
                            provider: resolvedAi.provider,
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
                            workspaceId: workspaceId || undefined,
                            workingDirectory: workingDirectory || folderPath || undefined,
                            provider: resolvedAi.provider,
                            ...(files ? { context: { files } } : {}),
                        },
                        images: images.length > 0 ? images : undefined,
                    };
                }
                const config = buildConfig();
                if (config) body.config = config;
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
                        await getSpaCocClient().queue.enqueue(body);
                        succeeded++;
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
                const created = await getSpaCocClient().queue.enqueue(body);
                if (queueState.dialogLaunchMode === 'floating-chat') {
                    const createdId = created?.task?.id;
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
            attachedContext.clear();
            persistSkill(isAskMode ? 'ask' : 'task', effectiveSkills);
            // Record skill usage for ordering
            for (const sk of effectiveSkills) {
                if (sk && workspaceId) {
                    getSpaCocClient().preferences.recordSkillUsage(workspaceId, sk).catch(() => { /* ignore */ });
                }
            }
            clearAttachments();
            if (!appState.onboardingProgress?.hasRunWorkflow) {
                await updateOnboarding({ hasRunWorkflow: true }).catch(() => {});
            }
            queueDispatch({ type: 'CLOSE_DIALOG' });
        } catch { /* ignore */ }
        finally { setSubmitting(false); queueDispatch({ type: 'SET_TASK_SUBMITTING', value: false }); }
    }, [prompt, model, workspaceId, folderPath, selectedSkills, images, contextFiles, isBulkMode, appState.workspaces, appState.onboardingProgress, updateOnboarding, queueDispatch, clearAttachments, attachedContext, persistSkill, slashCommands, isAskMode, isResolveMode, floatChat, queueState.dialogLaunchMode, queueState.dialogContextTaskName, queueState.dialogResolveContext, hooks, aiSelection.resolved, selectedTemplateId, sessionContextAttachmentsEnabled, canRetrieveConversations]);

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
        // Inline ghost-text acceptance — only when slash menu is hidden.
        if (
            e.key === 'Tab'
            && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
            && autocomplete.completion
        ) {
            e.preventDefault();
            const next = autocomplete.accept();
            setPrompt(next);
            richTextRef.current?.setValue(next, next.length);
            setPromptCursorPos(next.length);
            autocomplete.dismiss();
            return;
        }
        if (e.key === 'Escape' && autocomplete.completion) {
            e.preventDefault();
            autocomplete.dismiss();
            return;
        }
        // Bash-style up/down history navigation.
        if (promptHistory.handleKeyDown(e)) {
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !submitting) {
            e.preventDefault();
            handleSubmit();
        }
    }, [submitting, handleSubmit, slashCommands, handleSlashSelect, autocomplete, promptHistory]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            addFromFileInput(e.dataTransfer.files);
        }
    }, [addFromFileInput]);

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

    const dialogContent = (
        <div className="flex flex-col gap-3">
            {/* Context files chips (document-context mode) */}
            <AttachedContextPreviews
                items={attachedContext.items}
                onRemove={attachedContext.remove}
                data-testid="enqueue-attached-context-previews"
            />
            {attachedContextError && (
                <div className="text-xs text-[#f14c4c]" data-testid="enqueue-session-context-error">{attachedContextError}</div>
            )}
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
            {/* Resolve mode info */}
            {isResolveMode && queueState.dialogResolveContext && (
                <div className="text-xs text-[#848484]" data-testid="resolve-info">
                    ℹ️ Resolving {queueState.dialogResolveContext.commentCount} open comment{queueState.dialogResolveContext.commentCount !== 1 ? 's' : ''}
                </div>
            )}
            {/* Prompt — always visible */}
            <div>
                <label className="block text-xs font-medium text-[#848484] mb-1">{isResolveMode ? 'Additional context (optional)' : 'Prompt'}</label>
                {/* Hidden file input for the attach button */}
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    data-testid="enqueue-file-input-hidden"
                    onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                            addFromFileInput(e.target.files);
                        }
                        e.target.value = '';
                    }}
                />
                {attachmentError && (
                    <div className="text-xs text-[#f14c4c] mb-1" data-testid="enqueue-attachment-error">{attachmentError}</div>
                )}
                <div
                    className={`relative rounded border-2 border-dashed transition-colors ${
                        isDragOver
                            ? 'border-[#0078d4] bg-[#0078d4]/5 dark:bg-[#0078d4]/10'
                            : 'border-transparent'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    data-testid="enqueue-drop-zone"
                >
                    {isDragOver && (
                        <div className="absolute inset-0 flex items-center justify-center bg-[#0078d4]/5 dark:bg-[#0078d4]/10 rounded pointer-events-none z-10" data-testid="drop-zone-overlay">
                            <span className="text-sm font-medium text-[#0078d4]">📎 Drop files here</span>
                        </div>
                    )}
                    <div className="relative">
                        <RichTextInput
                            ref={richTextRef}
                            value={prompt}
                            ghostText={autocomplete.completion}
                            onChange={(text, cursorPos) => {
                                setPrompt(text);
                                setPromptCursorPos(cursorPos);
                                slashCommands.handleInputChange(text, cursorPos);
                            }}
                            onPaste={submitting ? undefined : addFromPaste}
                            onKeyDown={handleKeyDown}
                            disabled={submitting}
                            placeholder={isResolveMode ? 'Additional context… Type / for skills' : selectedSkills.length > 0 ? `Additional context for ${selectedSkills.join(', ')} (optional)` : 'Enter your prompt… Type / for skills'}
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
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        data-testid="enqueue-attach-btn"
                        aria-label="Attach image"
                        title="Attach images or drag & drop"
                    >
                        📎 Attach
                    </button>
                    <span className="text-[11px] text-[#a0a0a0] dark:text-[#666]">
                        or paste images (Ctrl+V) / drag & drop
                    </span>
                </div>
                <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} data-testid="enqueue-attachment-previews" />
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
            <div className="flex flex-col gap-1">
                <label className="block text-xs font-medium text-[#848484]">AI</label>
                <ModalJobAiControls
                    selection={aiSelection}
                    disabled={submitting}
                    testIdPrefix="enqueue"
                />
            </div>
            <div className="flex flex-row gap-2">
                {appState.workspaces.length > 0 && (
                    <div className="flex-1 min-w-0">
                        <label className="block text-xs font-medium text-[#848484] mb-1">Workspace</label>
                        <select
                            value={workspaceId}
                            onChange={e => setWorkspaceId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]"
                            data-testid="workspace-select"
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

    const dialogTitle = isResolveMode
        ? (queueState.dialogResolveContext?.title ?? 'Resolve with AI')
        : isAskMode ? 'Ask AI (Read-only)' : hasContextFiles ? 'Run Skill' : 'Enqueue AI Task';
    const submitLabel = isResolveMode ? '▶ Resolve' : isAskMode ? 'Ask' : isBulkMode ? `Enqueue ${contextFiles.length} Tasks` : 'Enqueue';

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
                    isResolveMode
                        ? false
                            : activeTab === 'templates'
                                ? selectedTemplateId === null
                                : selectedSkills.length === 0 && !prompt.trim() && !hasContextFiles && attachedContext.items.length === 0
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
                hidden={minimized}
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
            hidden={minimized}
        >
            {dialogContent}
        </Dialog>
    );
}
