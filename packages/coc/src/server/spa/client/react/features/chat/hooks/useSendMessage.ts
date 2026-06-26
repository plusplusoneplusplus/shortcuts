import { useCallback, useRef } from 'react';
import { clearDraft } from './useDraftStore';
import { useChatPrefs } from '../../../contexts/ChatPreferencesContext';
import { CLIENT_PASTE_THRESHOLD } from './useTextPaste';
import { formatAttachedContext } from './useAttachedContext';
import type { AttachedContextItem } from './useAttachedContext';
import type { ClientConversationTurn } from '../../../types/dashboard';
import type { ChatMode } from '../../../repos/modeConfig';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import type { AttachmentPayload } from '../../../types/attachments';
import { CocApiError, type ProcessMessageRequest } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { validateSessionContextAttachmentsForSend } from '../sessionContextDrop';
import type { RalphGrillSetup } from '../../../../../../ralph/grill-planning';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

export interface SendFollowUpOptions {
    /** When false, send exactly the provided content without composer draft/paste/context/attachments. */
    includeComposerContext?: boolean;
    /** Optional mode override for generated sends that should not follow the current composer mode. */
    modeOverride?: ChatMode;
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
        parseAndExtract: (input: string) => { skills: string[]; prompt: string };
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
     * Optional per-turn reasoning-effort override to include in the POST body.
     * `null` (or omitted) means no override — the executor falls back to the
     * persisted per-model effort, then the SDK default.
     */
    effortOverride?: 'low' | 'medium' | 'high' | 'xhigh' | null;
    /**
     * Workspace ID used for the Ralph promotion endpoint when `selectedMode === 'ralph'`.
     * Without it the server falls back to the workspaceId stored on the process.
     */
    workspaceId?: string;
    /** Feature flag state for session-context attachments. Required before sending session pointers. */
    sessionContextAttachmentsEnabled?: boolean;
    /** Conversation retrieval capability for the active workspace/provider mode. */
    conversationRetrievalAvailable?: boolean | null;
    /** Optional multi-agent grill setup used when promoting an ask-mode chat to Ralph. */
    ralphGrillSetup?: RalphGrillSetup;
    /**
     * Reset the mode pill back to 'ask' after a successful Ralph promotion.
     * Caller-owned because the visible pill is hidden by `allowedModes`
     * recomputation once the chat gains a ralph context.
     */
    onPromotedToRalph?: () => void;
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
    effortOverride,
    workspaceId,
    sessionContextAttachmentsEnabled = false,
    conversationRetrievalAvailable,
    ralphGrillSetup,
    onPromotedToRalph,
}: UseSendMessageOptions): {
    sendFollowUp: (overrideContent?: string, deliveryMode?: DeliveryMode, options?: SendFollowUpOptions) => Promise<void>;
    closeFollowUpStream: () => void;
    onSendComplete: () => void;
} {
    const { archivedChatIds, unarchiveChat } = useChatPrefs();
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const resolveCurrentSendRef = useRef<(() => void) | null>(null);

    const buildMessageRequest = useCallback((content: string, deliveryMode: DeliveryMode, skillNames: string[], options: SendFollowUpOptions = {}): ProcessMessageRequest => ({
        content,
        images: options.includeComposerContext === false ? undefined : (images.length > 0 ? images : undefined),
        ...(options.includeComposerContext === false || !toPayload ? {} : (() => { const ap = toPayload(); return ap.length > 0 ? { attachments: ap } : {}; })()),
        mode: options.modeOverride ?? selectedMode,
        deliveryMode,
        ...(skillNames.length > 0 ? { skillNames } : {}),
        ...(modelOverride ? { model: modelOverride } : {}),
        ...(effortOverride ? { reasoningEffort: effortOverride } : {}),
    }), [images, modelOverride, effortOverride, selectedMode, toPayload]);

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
            resolveCurrentSendRef.current = resolve;
            // Fallback timeout: 3s for follow-up completion.
            // If main SSE is blocked/missed, this ensures send re-enables promptly.
            const timeout = setTimeout(() => {
                if (resolveCurrentSendRef.current === resolve) {
                    resolveCurrentSendRef.current = null;
                    resolve();
                }
            }, 3_000);
            const origResolve = resolve;
            resolveCurrentSendRef.current = () => {
                clearTimeout(timeout);
                origResolve();
            };
        });
    }, [refreshConversation]);

    const sendFollowUp = useCallback(async (overrideContent?: string, deliveryMode: DeliveryMode = 'enqueue', options: SendFollowUpOptions = {}) => {
        const includeComposerContext = options.includeComposerContext !== false;
        const messageMode = options.modeOverride ?? selectedMode;
        const userText = (overrideContent ?? followUpInputRef.current).trim();
        const pastedContent = includeComposerContext ? (getPastedContent?.() ?? null) : null;
        const contextItems = includeComposerContext ? (getAttachedContext?.() ?? []) : [];
        const sessionContextSendError = validateSessionContextAttachmentsForSend({
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId: workspaceId,
            currentProcessId: processId,
            items: contextItems,
            canRetrieveConversations: conversationRetrievalAvailable,
        });
        if (sessionContextSendError) {
            setError(sessionContextSendError);
            return;
        }
        const contextPrefix = formatAttachedContext(contextItems);
        const baseContent = pastedContent
            ? (userText ? userText + '\n\n' + pastedContent : pastedContent)
            : userText;
        const rawContent = contextPrefix ? contextPrefix + baseContent : baseContent;
        if (!processId || inputDisabled) return;
        if (sending && !isActiveGeneration) return;

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
            clearDraft(taskId);
            slashCommands.dismissMenu();
            setError(null);
            setSending(true);
            try {
                // Route the write to the chat's clone (AC-07): a remote clone's
                // promotion hits its own server, never the local one.
                await getCocClientForWorkspace(workspaceId).processes.promoteToRalph(processId, {
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
            clearDraft(taskId);
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
            void getCocClientForWorkspace(workspaceId).processes.sendMessage(
                processId,
                buildMessageRequest(rawContent, deliveryMode, extractedSkills, options),
            ).catch(() => {});

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
            return [
                ...prev,
                { role: 'user' as const, content: rawContent, timestamp, timeline: [], turnIndex: nextIdx, pasteExternalized, ...(modelOverride ? { model: modelOverride } : {}) },
                { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [], turnIndex: nextIdx + 1 },
            ];
        });

        try {
            // Idle chat: start the streaming follow-up against the chat's clone (AC-07).
            await getCocClientForWorkspace(workspaceId).processes.sendMessage(
                processId,
                buildMessageRequest(rawContent, deliveryMode, extractedSkills, options),
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
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
            void refreshConversation(processId);
        }
    }, [processId, taskId, inputDisabled, sending, isActiveGeneration, selectedMode, images, archivedChatIds, unarchiveChat, modelOverride, buildMessageRequest, sessionContextAttachmentsEnabled, conversationRetrievalAvailable, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    return { sendFollowUp, closeFollowUpStream, onSendComplete };
}
