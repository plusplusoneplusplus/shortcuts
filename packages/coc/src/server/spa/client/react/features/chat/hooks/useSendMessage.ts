import { useCallback, useEffect, useRef } from 'react';
import { clearDraft } from './useDraftStore';
import { useChatPrefs } from '../../../contexts/ChatPreferencesContext';
import { CLIENT_PASTE_THRESHOLD } from './useTextPaste';
import { formatAttachedContext } from './useAttachedContext';
import type { AttachedContextItem } from './useAttachedContext';
import type { ClientConversationTurn } from '../../../types/dashboard';
import type { ChatMode } from '../../../repos/modeConfig';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import type { AttachmentPayload, ChatAttachment } from '../../../types/attachments';
import { CocApiError, type ChatProviderId, type ChatStyle, type ProcessMessageRequest } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { getCocClientForWorkspace, resolveCloneRoute } from '../../../repos/cloneRegistry';
import { parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { useCocClient } from '../../../repos/cloneRouting';
import { useWorkspaceOwner } from '../../../repos/workspaceOwnerContext';
import { validateSessionContextAttachmentsForSend } from '../sessionContextDrop';
import type { MetaCommand } from '../slash-command-parser';
import type { RalphGrillSetup } from '../../../../../../ralph/grill-planning';
import { getSentinelTodoContextClient, resolveSentinelTodoContext } from '../sentinelTodoContext';
import { SENTINEL_TODO_CONTEXT_DRAG_KIND } from '../sessionContextDrag';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from '../../repo-detail/unified-right-panel/sentinelTodoPanelModel';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

export interface SendFollowUpOptions {
    /** When false, send exactly the provided content without composer draft/paste/context/attachments. */
    includeComposerContext?: boolean;
    /** Optional mode override for generated sends that should not follow the current composer mode. */
    modeOverride?: ChatMode;
    /** Provider captured by the turn being retried; overrides composer state for this send. */
    providerOverride?: ChatProviderId;
    /**
     * Attachments to send *instead of* the composer's current ones.
     *
     * The in-bubble message editor keeps its draft in its own
     * `useFileAttachments` instance, so its images never reach the composer
     * state this hook closes over. Passing them here sends exactly that list
     * (an empty array sends none) and leaves the composer untouched. It is
     * independent of `includeComposerContext`, which governs draft/paste/context.
     */
    attachmentsOverride?: ChatAttachment[];
}

export interface UseSendMessageOptions {
    processId: string | null;
    taskId: string;
    inputDisabled: boolean;
    sending: boolean;
    isActiveGeneration: boolean;
    setSending: (v: boolean) => void;
    setError: (v: string | null) => void;
    setSessionExpired: (v: boolean) => void;
    setSuggestions: (v: string[]) => void;
    setTurnsAndRef: SetTurnsAndRef;
    removeStreamingPlaceholder: () => void;
    refreshConversation: (pid: string) => Promise<void>;
    queueDispatch: (action: any) => void;
    slashCommands: {
        parseAndExtract: (input: string) => { skills: string[]; prompt: string; metaCommands: MetaCommand[] };
        dismissMenu: () => void;
    };
    followUpInputRef: React.MutableRefObject<string>;
    setFollowUpInput: (v: string) => void;
    selectedMode: ChatMode;
    selectedModeRef: React.MutableRefObject<ChatMode>;
    images: string[];
    clearImages: () => void;
    /** Convert current attachments to wire format for API calls */
    toPayload?: () => AttachmentPayload[];
    clearPaste: () => void;
    /** Returns the raw pasted content held by useTextPaste, or null if no large paste is active. */
    getPastedContent?: () => string | null;
    lastFailedMessageRef: React.MutableRefObject<string>;
    setTask: (updater: (prev: any) => any) => void;
    /** Returns the currently attached context items. */
    getAttachedContext?: () => AttachedContextItem[];
    /** Clears attached context after send. */
    clearAttachedContext?: () => void;
    /** Optional model override to include in the POST body. */
    modelOverride?: string | null;
    /**
     * Confirmed concrete provider for this follow-up. Omit it to preserve the
     * active conversation provider and the request shape used by older servers.
     */
    providerOverride?: ChatProviderId;
    /** Active provider used to attribute optimistic turns, not to route the request. */
    activeProvider?: ChatProviderId;
    /**
     * Optional per-turn reasoning-effort override to include in the POST body.
     * `null` (or omitted) means no override — the executor falls back to the
     * persisted per-model effort, then the SDK default.
     */
    effortOverride?: 'low' | 'medium' | 'high' | 'xhigh' | null;
    /**
     * Response style for this turn. Pass `undefined` when the owning server has
     * the Style chip off — the field is then omitted from the request, so a
     * server that would reject it never sees it.
     */
    chatStyle?: ChatStyle;
    /**
     * Workspace ID used for the Ralph promotion endpoint when `selectedMode === 'ralph'`.
     * Without it the server falls back to the workspaceId stored on the process.
     */
    workspaceId?: string;
    /** Canonical owner from loaded process metadata; routing still uses the selection workspace. */
    owningWorkspaceId?: string;
    /** Owner-qualified client draft identity, separate from the process id on the wire. */
    draftKey?: string;
    /** Feature flag state for session-context attachments. Required before sending session pointers. */
    sessionContextAttachmentsEnabled?: boolean;
    /** Conversation retrieval capability for the active workspace/provider mode. */
    conversationRetrievalAvailable?: boolean | null;
    sentinelTodoOwner?: SentinelTodoOwner | null;
    /** Optional multi-agent grill setup used when promoting an ask-mode chat to Ralph. */
    ralphGrillSetup?: RalphGrillSetup;
    /**
     * Reset the mode pill back to 'ask' after a successful Ralph promotion.
     * Caller-owned because the visible pill is hidden by `allowedModes`
     * recomputation once the chat gains a ralph context.
     */
    onPromotedToRalph?: () => void;
    /**
     * Surface the result of a `/compact` meta-command as a transient
     * notification (toast). Success reports messages/tokens removed; failures
     * (unsupported provider, active turn) report the error. CoC's displayed
     * transcript is NOT rewritten, so this is the only user-visible signal.
     */
    notifyCompact?: (message: string, type: 'success' | 'error') => void;
    /**
     * Marks the conversation as compacting (AC-02) so the chat can render a
     * synthetic in-progress bubble from process state and block duplicate sends.
     * Called with `true` and the typed custom instructions when `/compact`
     * starts, and `false` when it settles (success or failure).
     */
    setCompacting?: (running: boolean, customInstructions?: string) => void;
}

export function useSendMessage({
    processId,
    taskId,
    inputDisabled,
    sending,
    isActiveGeneration,
    setSending,
    setError,
    setSessionExpired,
    setSuggestions,
    setTurnsAndRef,
    removeStreamingPlaceholder,
    refreshConversation,
    queueDispatch,
    slashCommands,
    followUpInputRef,
    setFollowUpInput,
    selectedMode,
    selectedModeRef,
    images,
    clearImages,
    toPayload,
    clearPaste,
    getPastedContent,
    lastFailedMessageRef,
    setTask,
    getAttachedContext,
    clearAttachedContext,
    modelOverride,
    providerOverride,
    activeProvider,
    effortOverride,
    chatStyle,
    workspaceId,
    owningWorkspaceId: messageOwnerWorkspaceId,
    draftKey = taskId,
    sessionContextAttachmentsEnabled = false,
    conversationRetrievalAvailable,
    sentinelTodoOwner,
    ralphGrillSetup,
    onPromotedToRalph,
    notifyCompact,
    setCompacting,
}: UseSendMessageOptions): {
    sendFollowUp: (overrideContent?: string, deliveryMode?: DeliveryMode, options?: SendFollowUpOptions) => Promise<void>;
    closeFollowUpStream: () => void;
    onSendComplete: () => void;
} {
    const { archivedChatIds, unarchiveChat } = useChatPrefs();
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const resolveCurrentSendRef = useRef<(() => void) | null>(null);
    // Synchronous re-entry guard: the `/compact` POST is blocking and the
    // conversation is not idle while it runs, so any concurrent send (a second
    // `/compact` or a normal follow-up) must be dropped. A ref closes the
    // double-click race that a React state flag would lose between renders.
    const compactingRef = useRef(false);
    const scopedOwner = useWorkspaceOwner(workspaceId);
    const scopedClient = useCocClient(workspaceId);
    const getMessageClient = useCallback(() => scopedOwner
        ? scopedClient : getCocClientForWorkspace(workspaceId), [scopedOwner, scopedClient, workspaceId]);
    const resolvingTodosRef = useRef(false);
    const todoSendOwnerKey = sentinelTodoOwner ? sentinelTodoOwnerKey(sentinelTodoOwner) : '';
    const todoSendOwnerRef = useRef(todoSendOwnerKey);
    todoSendOwnerRef.current = todoSendOwnerKey;
    const todoSendEpoch = useRef(0);
    useEffect(() => {
        todoSendOwnerRef.current = todoSendOwnerKey;
        todoSendEpoch.current += 1;
        return () => { todoSendOwnerRef.current = ''; todoSendEpoch.current += 1; };
    }, [todoSendOwnerKey]);

    const buildMessageRequest = useCallback((content: string, deliveryMode: DeliveryMode, skillNames: string[], options: SendFollowUpOptions = {}): ProcessMessageRequest => {
        // An explicit override wins over the composer's own attachments; without
        // one, `includeComposerContext: false` means "send no attachments".
        const override = options.attachmentsOverride;
        const outImages = override
            ? override.filter(a => a.category === 'image').map(a => a.dataUrl)
            : (options.includeComposerContext === false ? [] : images);
        const outAttachments: AttachmentPayload[] = override
            ? override.map(a => ({ name: a.name, mimeType: a.mimeType, size: a.size, dataUrl: a.dataUrl }))
            : (options.includeComposerContext === false || !toPayload ? [] : toPayload());
        const requestedProvider = options.providerOverride ?? providerOverride;
        return ({
        content,
        images: outImages.length > 0 ? outImages : undefined,
        ...(outAttachments.length > 0 ? { attachments: outAttachments } : {}),
        mode: options.modeOverride ?? selectedMode,
        deliveryMode,
        ...(skillNames.length > 0 ? { skillNames } : {}),
        ...(requestedProvider ? { provider: requestedProvider } : {}),
        ...(modelOverride ? { model: modelOverride } : {}),
        ...(effortOverride ? { reasoningEffort: effortOverride } : {}),
        ...(chatStyle ? { chatStyle } : {}),
        });
    }, [images, providerOverride, modelOverride, effortOverride, chatStyle, selectedMode, toPayload]);

    const closeFollowUpStream = useCallback(() => {
        if (followUpEventSourceRef.current) {
            followUpEventSourceRef.current.close();
            followUpEventSourceRef.current = null;
        }
    }, []);

    /** Called by useChatSSE when the main SSE stream fires 'done'. */
    const onSendComplete = useCallback(() => {
        if (resolveCurrentSendRef.current) {
            resolveCurrentSendRef.current();
            resolveCurrentSendRef.current = null;
        }
    }, []);

    /** Returns a promise that resolves when the main SSE stream fires 'done' via onSendComplete. */
    const waitForSendCompletion = useCallback((pid: string): Promise<void> => {
        if (typeof EventSource === 'undefined') {
            return refreshConversation(pid);
        }
        return new Promise<void>(resolve => {
            let settled = false;
            let timeout: ReturnType<typeof setTimeout>;
            // Resolve exactly once, whether via the main SSE 'done' (onSendComplete
            // invokes this through resolveCurrentSendRef) or the fallback timeout.
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (resolveCurrentSendRef.current === finish) {
                    resolveCurrentSendRef.current = null;
                }
                resolve();
            };
            // Fallback timeout: 3s for follow-up completion. If the main SSE
            // stream is blocked or missed, this re-enables send promptly instead
            // of leaving the button disabled until onSendComplete — which may
            // never fire.
            timeout = setTimeout(finish, 3_000);
            resolveCurrentSendRef.current = finish;
        });
    }, [refreshConversation]);

    /**
     * Run the `/compact` client-side action: call the workspace-routed compact
     * endpoint and surface the outcome. Success reports the messages/tokens
     * removed; unsupported-provider (422) and active-turn (409) failures report
     * the backend error. The server appends a display-only result turn to the
     * transcript (AC-03), so on success we refresh the conversation to surface it
     * — the toast is no longer the only visible completion signal.
     */
    const compactConversation = useCallback(async (pid: string, customInstructions: string | undefined) => {
        // Mark in-progress BEFORE the (blocking) POST so the chat renders the
        // synthetic compaction bubble and suppresses the empty assistant
        // placeholder while compaction runs (AC-02).
        compactingRef.current = true;
        setCompacting?.(true, customInstructions);
        try {
            const result = await getMessageClient().processes.compact(
                pid,
                customInstructions,
                workspaceId ? { workspace: workspaceId } : undefined,
            );
            if (result.state === 'queued' || result.state === 'running') {
                notifyCompact?.(result.state === 'queued' ? 'Compaction queued.' : 'Compaction already running.', 'success');
                await refreshConversation(pid);
                return;
            }
            const removed = result.messagesRemoved ?? 0;
            const freed = result.tokensRemoved ?? 0;
            notifyCompact?.(
                `Context compacted — removed ${removed} message${removed === 1 ? '' : 's'}, freed ~${freed} tokens`,
                'success',
            );
            // Pull in the server-appended display-only result turn so it shows
            // without a reload. Best-effort: a refresh failure must not mask the
            // successful compaction.
            try {
                await refreshConversation(pid);
            } catch {
                // ignore — the turn is persisted and will appear on next load
            }
        } catch (err: any) {
            notifyCompact?.(getSpaCocClientErrorMessage(err, 'Failed to compact the conversation.'), 'error');
        } finally {
            // Clear the in-progress state on both paths. On success the refresh
            // above has already landed the persisted result turn, so there is no
            // gap where neither the bubble nor the result turn is visible.
            compactingRef.current = false;
            setCompacting?.(false);
        }
    }, [workspaceId, getMessageClient, notifyCompact, refreshConversation, setCompacting]);

    const sendFollowUp = useCallback(async (overrideContent?: string, deliveryMode: DeliveryMode = 'enqueue', options: SendFollowUpOptions = {}) => {
        if (resolvingTodosRef.current) return;
        const includeComposerContext = options.includeComposerContext !== false;
        const requestedProvider = options.providerOverride ?? providerOverride;
        const messageMode = options.modeOverride ?? selectedMode;
        const userText = (overrideContent ?? followUpInputRef.current).trim();
        const pastedContent = includeComposerContext ? (getPastedContent?.() ?? null) : null;
        let contextItems = includeComposerContext ? (getAttachedContext?.() ?? []) : [];
        const sessionContextSendError = validateSessionContextAttachmentsForSend({
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId: workspaceId,
            currentProcessId: processId,
            items: contextItems,
            canRetrieveConversations: conversationRetrievalAvailable,
            sentinelTodoOwner,
        });
        if (sessionContextSendError) {
            setError(sessionContextSendError);
            return;
        }
        if (!processId || inputDisabled || (sending && !isActiveGeneration) || compactingRef.current) return;
        const hasTodoContext = contextItems.some(item => item.kind === 'sentinel-todo');
        if (hasTodoContext && sentinelTodoOwner) {
            const originalItems = contextItems;
            const originalDraft = followUpInputRef.current;
            const capturedOwnerKey = todoSendOwnerKey;
            const capturedEpoch = todoSendEpoch.current;
            resolvingTodosRef.current = true;
            setSending(true);
            try {
                contextItems = await Promise.all(contextItems.map(async item => {
                    if (item.kind !== 'sentinel-todo') return item;
                    const resolvedItem = await resolveSentinelTodoContext({
                        ...item, kind: SENTINEL_TODO_CONTEXT_DRAG_KIND, version: 1,
                    }, sentinelTodoOwner);
                    return { ...item, title: resolvedItem.title, resolvedItem };
                }));
                if (todoSendEpoch.current !== capturedEpoch || todoSendOwnerRef.current !== capturedOwnerKey) return;
                const currentItems = getAttachedContext?.() ?? [];
                if (currentItems.length !== originalItems.length
                    || currentItems.some((item, index) => item.id !== originalItems[index].id)
                    || followUpInputRef.current !== originalDraft) {
                    setError('The draft context changed while loading. Review it and send again.');
                    return;
                }
            } catch (error) {
                if (todoSendEpoch.current === capturedEpoch && todoSendOwnerRef.current === capturedOwnerKey) {
                    setError(getSpaCocClientErrorMessage(error, 'Could not resolve the to-do context.'));
                }
                return;
            } finally {
                resolvingTodosRef.current = false;
                if (todoSendEpoch.current === capturedEpoch && todoSendOwnerRef.current === capturedOwnerKey) setSending(false);
            }
        }
        const contextPrefix = formatAttachedContext(contextItems);
        const messageClient = hasTodoContext && sentinelTodoOwner
            ? getSentinelTodoContextClient(sentinelTodoOwner) : getMessageClient();
        const baseContent = pastedContent
            ? (userText ? userText + '\n\n' + pastedContent : pastedContent)
            : userText;
        const rawContent = contextPrefix ? contextPrefix + baseContent : baseContent;
        if (!processId || inputDisabled) return;
        if (!hasTodoContext && !scopedOwner && resolveCloneRoute(workspaceId).kind === 'unresolved-remote') {
            setError('The owning server is unavailable. Reconnect it before sending this message.');
            return;
        }
        const owner = hasTodoContext && sentinelTodoOwner
            ? sentinelTodoOwner.ownerWorkspaceId : messageOwnerWorkspaceId ?? workspaceId;
        const owningWorkspaceId = typeof owner === 'string'
            ? parseRemoteCloneKey(owner)?.workspaceId ?? owner : undefined;
        const ownerQuery = owningWorkspaceId ? { workspace: owningWorkspaceId } : undefined;
        if (sending && !isActiveGeneration) return;
        // Block every send — a second `/compact` or a normal follow-up — while a
        // compaction is still in flight (AC-02). The conversation is not idle
        // until the blocking POST settles.
        if (compactingRef.current) return;

        // ── /compact meta-command branch ──
        // `/compact` is a client-side action (like `/model`), not a message.
        // Compaction shrinks the model context used on the next turn; CoC's
        // displayed transcript is NOT rewritten — the result is surfaced as a
        // transient toast (see compactConversation). The text after the
        // `/compact` token becomes customInstructions (empty when none typed).
        const compactParse = slashCommands.parseAndExtract(userText);
        // Optional chaining guards against a parseAndExtract that omits
        // metaCommands (the real hook always returns it; test stubs may not).
        if (compactParse.metaCommands?.includes('compact')) {
            setSuggestions([]);
            if (includeComposerContext) {
                setFollowUpInput('');
                clearDraft(draftKey);
            }
            slashCommands.dismissMenu();
            setError(null);
            await compactConversation(processId, compactParse.prompt || undefined);
            return;
        }

        // ── Ralph promotion branch ──
        // When the follow-up mode pill is set to Ralph, "Send" promotes the
        // current ask-mode chat into a Ralph session via the dedicated endpoint
        // instead of enqueueing a normal follow-up. The user's typed text (if
        // any) is forwarded as `extraGuidance` to focus the synthesis prompt.
        // Empty input is fine — the synthesis prompt stands on its own.
        if (messageMode === 'ralph') {
            if (archivedChatIds.has(taskId)) unarchiveChat(taskId);
            setSuggestions([]);
            setFollowUpInput('');
            clearDraft(draftKey);
            slashCommands.dismissMenu();
            setError(null);
            setSending(true);
            try {
                // Route the write to the chat's clone (AC-07): a remote clone's
                // promotion hits its own server, never the local one.
                await getMessageClient().processes.promoteToRalph(processId, {
                    workspaceId,
                    extraGuidance: userText || undefined,
                    ...(ralphGrillSetup?.enabled ? { grill: ralphGrillSetup } : {}),
                });
                lastFailedMessageRef.current = '';
                clearImages();
                clearPaste();
                clearAttachedContext?.();
                onPromotedToRalph?.();
                // The synthesis turn streams into the same conversation via
                // SSE; refresh once so the new turn shows up promptly even if
                // the SSE subscription is still being (re)established.
                void refreshConversation(processId);
            } catch (err: any) {
                if (err instanceof CocApiError && err.status === 410) {
                    setSessionExpired(true);
                    setError('Session expired.');
                } else {
                    setError(getSpaCocClientErrorMessage(err, 'Failed to promote chat to Ralph.'));
                }
                lastFailedMessageRef.current = userText;
                if (userText) setFollowUpInput(userText);
            } finally {
                setSending(false);
            }
            return;
        }

        if (!rawContent) return;

        if (archivedChatIds.has(taskId)) {
            unarchiveChat(taskId);
        }

        const { skills: extractedSkills } = slashCommands.parseAndExtract(rawContent);

        setSuggestions([]);
        if (includeComposerContext) {
            setFollowUpInput('');
            clearDraft(draftKey);
        }
        slashCommands.dismissMenu();
        setError(null);

        // ── While AI is running: route through /message, let server decide ──
        if (isActiveGeneration) {
            if (deliveryMode === 'immediate') {
                // Immediate steer: add optimistic user turn so it appears in
                // the conversation right away. The server will attempt to inject
                // into the live session; if steering fails, the message is
                // buffered as a pending message and the SSE event will surface it
                // in the queued section.
                const timestamp = new Date().toISOString();
                setTurnsAndRef(prev => {
                    const nextIdx = Math.max(0, ...prev.map(t => t.turnIndex ?? -1)) + 1;
                    return [
                        ...prev,
                        { role: 'user' as const, content: rawContent, timestamp, timeline: [], turnIndex: nextIdx, ...(modelOverride ? { model: modelOverride } : {}) },
                    ];
                });
            }
            // Both immediate and enqueue: fire POST to /message and let the
            // server steer, buffer, or enqueue as appropriate.  No local
            // pending queue entry — the server is the source of truth.
            // Routed to the chat's clone (AC-07).
            try {
                await messageClient.processes.sendMessage(
                    processId,
                    buildMessageRequest(rawContent, deliveryMode, extractedSkills, options),
                    ownerQuery,
                );
            } catch (error) {
                setError(getSpaCocClientErrorMessage(error, 'Failed to send follow-up message.'));
                lastFailedMessageRef.current = rawContent;
                if (includeComposerContext) setFollowUpInput(userText);
                return;
            }

            if (includeComposerContext) {
                clearImages();
                clearPaste();
                clearAttachedContext?.();
            }
            return;
        }

        // ── AI is idle: start a new streaming follow-up ──
        setSending(true);
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });

        const timestamp = new Date().toISOString();
        const pasteExternalized = rawContent.length > CLIENT_PASTE_THRESHOLD || undefined;
        setTurnsAndRef(prev => {
            const nextIdx = Math.max(0, ...prev.map(t => t.turnIndex ?? -1)) + 1;
            const provider = requestedProvider ?? activeProvider;
            const providerAttribution = provider ? { provider } : {};
            return [
                ...prev,
                { role: 'user' as const, content: rawContent, timestamp, timeline: [], turnIndex: nextIdx, pasteExternalized, ...providerAttribution, ...(modelOverride ? { model: modelOverride } : {}) },
                { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [], turnIndex: nextIdx + 1, ...providerAttribution },
            ];
        });

        try {
            // Idle chat: start the streaming follow-up against the chat's clone (AC-07).
            await messageClient.processes.sendMessage(
                processId,
                buildMessageRequest(rawContent, deliveryMode, extractedSkills, options),
                ownerQuery,
            );

            lastFailedMessageRef.current = '';
            setTask((prev: any) => prev ? { ...prev, status: 'running' } : prev);
            if (includeComposerContext) {
                clearImages();
                clearPaste();
                clearAttachedContext?.();
            }
            await waitForSendCompletion(processId);
        } catch (err: any) {
            if (err instanceof CocApiError && err.status === 410) {
                setSessionExpired(true);
                setError('Session expired.');
            } else {
                setError(getSpaCocClientErrorMessage(err, 'Failed to send follow-up message.'));
            }
            lastFailedMessageRef.current = rawContent;
            if (hasTodoContext && includeComposerContext) setFollowUpInput(userText);
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
            void refreshConversation(processId);
        }
    }, [processId, taskId, draftKey, inputDisabled, sending, isActiveGeneration, selectedMode, images, archivedChatIds, unarchiveChat, modelOverride, providerOverride, activeProvider, buildMessageRequest, sessionContextAttachmentsEnabled, conversationRetrievalAvailable, workspaceId, messageOwnerWorkspaceId, compactConversation, scopedOwner, getMessageClient, sentinelTodoOwner, todoSendOwnerKey]); // eslint-disable-line react-hooks/exhaustive-deps

    return { sendFollowUp, closeFollowUpStream, onSendComplete };
}
