/**
 * Factory that creates the `send_to_conversation` custom tool.
 * Omitted `action` or `action: "send"` uses `processId` as the mode switch:
 *
 *   - `processId` omitted → **create mode**: start a brand-new chat
 *     (fire-and-forget) through the same in-process queue path that
 *     `POST /api/queue` uses (no HTTP self-call) so the conversation appears in
 *     the dashboard chat list and is picked up by the queue executor. Returns
 *     immediately with the queued conversation's identity.
 *     With `mode: "ralph"`, create mode instead launches a Ralph session
 *     straight into iteration 1 (no grilling) through the injected
 *     `launchRalph` capability — the same path `POST /api/ralph-launch` uses.
 *     `workspaceId` accepts a local ID, a remote clone key
 *     `remote:<serverId>:<workspaceId>`, or a repo name (`name@server` to
 *     disambiguate). Remote targets are started on that server's own
 *     `POST /api/queue` / `POST /api/ralph-launch` via the route-layer
 *     {@link WorkspaceDirectory}, with no local fallback.
 *   - `processId` provided → **post mode**: post `content` as a follow-up
 *     message into that existing conversation, wrapping the same delivery path
 *     `POST /api/processes/:id/message` uses (via the injected `sendMessage`
 *     capability). Returns the appended user-turn index. An omitted `mode`
 *     keeps the conversation's current mode (create mode defaults to `ask`,
 *     or `autopilot` when called from a sentinel chat).
 *   - `action: "cancel"` with `processId` stops local queued/running work through
 *     the shared process cancellation service, without content or a new turn.
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance bound
 * to the store + enqueue/send capabilities + the caller's current workspace,
 * avoiding cross-request contamination.
 *
 * NOTE on `model` validation: legacy calls that only supply the existing `model`
 * argument keep the queue path's pass-through/coercion behavior. Calls that also
 * select a concrete provider or inherited-provider effort tier validate compatibility
 * before enqueueing. Auto defers compatibility until the target selects a provider.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { AIProcess, CreateTaskInput, ProcessStore, StoredEffortTiersMap } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, mergeEffortTiersWithDefaults, resolveModelForProvider, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { validateAndParseTask } from '../routes/queue-shared';
import { normalizeChatMode, VALID_CHAT_PROVIDERS, type ChatProvider, type ReasoningEffort } from '../tasks/task-types';
import type { LaunchRalphFn } from '../ralph/ralph-launch-service';
import type { MessagingJobOrigin } from '../messaging/job-notices';
import { APIError } from '../errors';
import type { ConversationCancellationResult } from '../processes/cancel-conversation';
import {
    buildChatOpenLink,
    createWorkspaceDirectory,
    parseRemoteCloneKey,
    type WorkspaceDirectory,
} from '../servers/workspace-directory';

// ============================================================================
// Types
// ============================================================================

/** Chat modes a conversation may be started or continued in. */
export type SendToConversationChatMode = 'autopilot' | 'ask';

/** Modes this tool accepts. `ralph` is create-only; `plan` is rejected. */
export type SendToConversationMode = SendToConversationChatMode | 'ralph';

/** Delivery modes for post mode (an existing conversation). */
export type SendToConversationDeliveryMode = 'immediate' | 'enqueue' | 'steer';

/** Provider selection; `auto` requests the target server's automatic routing. */
export type SendToConversationProvider = ChatProvider | 'auto';

/** Provider-scoped effort tiers accepted by this tool. */
export type SendToConversationEffortTier = 'very-low' | 'low' | 'medium' | 'high';

export interface SendToConversationArgs {
    /** Omitted or `send` preserves create/post behavior; `cancel` requires processId only. */
    action?: 'send' | 'cancel';
    /** The message (post mode) / first prompt (create mode). Required for send only. */
    content?: string;
    /**
     * Mode switch. Omitted → create a new conversation; provided → post into
     * that existing conversation.
     */
    processId?: string;
    /**
     * Create mode: target workspace/repo — a local ID, a remote clone key
     * `remote:<serverId>:<workspaceId>`, or a repo name (`name@server`).
     * Defaults to the caller's workspace.
     */
    workspaceId?: string;
    /** `autopilot` | `ask` (default), or create-only `ralph` (launch a Ralph session with `content` as the goal). */
    mode?: SendToConversationMode;
    /** Post mode: how the follow-up is delivered. Ignored in create mode. */
    deliveryMode?: SendToConversationDeliveryMode;
    /** Create mode: persistent custom title (trimmed, non-empty, max 80 characters). Optional; ignored in post mode. */
    title?: string;
    /** Overrides the AI model (both modes). */
    model?: string;
    /**
     * Create mode: explicit concrete provider or target-server Auto routing.
     * Post mode: accepted but ignored; the existing provider stays authoritative.
     */
    provider?: SendToConversationProvider;
    /**
     * Provider-scoped effort tier. Create mode passes it through queue
     * preparation; post mode expands it against the target conversation provider.
     */
    effortTier?: SendToConversationEffortTier;
    /** Create mode: queue priority. Default `normal`. */
    priority?: 'high' | 'normal' | 'low';
}

/**
 * Enqueue capability injected by the server/route layer where the
 * `MultiRepoQueueRouter` and `QueueGlobalState` live. Returns the new task id.
 *
 * The bound callback is expected to run the same machinery `POST /api/queue`
 * uses (`prepareTaskForEnqueue` + `enqueueViaBridge`) so the conversation shows
 * up in the chat list and is executed by the queue executor.
 */
export type EnqueueChatFn = (input: CreateTaskInput) => Promise<string>;

/**
 * Post-mode delivery capability injected by the route layer. Wraps the same
 * in-process delivery `POST /api/processes/:id/message` performs and returns the
 * appended user-turn index.
 */
export type SendMessageFn = (input: {
    processId: string;
    content: string;
    mode?: SendToConversationChatMode;
    model?: string;
    effort?: ReasoningEffort;
    deliveryMode?: SendToConversationDeliveryMode;
}) => Promise<{ turnIndex: number }>;

/** Validate a concrete provider before an explicit create-mode selection enqueues. */
export type ValidateSendToConversationProviderFn = (provider: ChatProvider) => Promise<void> | void;

/** Read stored provider-specific effort-tier overrides; defaults are merged by the tool. */
export type GetSendToConversationEffortTiersFn = (provider: ChatProvider) => StoredEffortTiersMap | undefined;

export interface SendToConversationRuntimeOptions {
    /** Shared process/queue cancellation lifecycle, bound on the owning local server. */
    cancelConversation?: (processId: string, workspaceId?: string) => Promise<ConversationCancellationResult>;
    /** Capability check only; routing/quota errors must not trigger fallback. */
    isAutoProviderRoutingAvailable?: () => boolean;
    validateProvider?: ValidateSendToConversationProviderFn;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
    /**
     * Local + remote repo directory (also backs `list_workspaces`). Absent →
     * a local-only directory over the store; remote targets are then unknown.
     */
    workspaceDirectory?: WorkspaceDirectory;
    /**
     * Per turn: the WhatsApp/Teams origin of the turn invoking the tool.
     * Local create-mode chats record it as `metadata.messagingOrigin` and are
     * tracked for completion notices; dashboard turns resolve undefined.
     */
    messagingOrigin?: () => MessagingJobOrigin | undefined;
    /** Registers a handed-off local chat for completion notices. */
    trackMessagingJob?: (job: { processId: string; workspaceId: string; origin: MessagingJobOrigin }) => void;
}

export interface SendToConversationToolOptions {
    /** ProcessStore instance — used to validate the target workspace exists. */
    store: ProcessStore;
    /** The caller's current workspace ID; the default create-mode target. */
    workspaceId?: string;
    /** Bound in-process enqueue capability (create mode). */
    enqueueChat: EnqueueChatFn;
    /** Bound in-process follow-up delivery capability (post mode). */
    sendMessage?: SendMessageFn;
    /** Bound in-process Ralph launch (create mode with `mode: "ralph"`). */
    launchRalph?: LaunchRalphFn;
    /** Runtime provider/tier helpers supplied by the server route layer. */
    runtime?: SendToConversationRuntimeOptions;
    /**
     * The parent chat's processId — the conversation in which this tool was
     * built/invoked. In create mode the handler reads the parent process
     * record's `provider` and, with an explicit model and no provider override,
     * `reasoningEffort` from its `metadata`. New chats without an explicit model
     * use the supplied tier or Medium. Mirrors the
     * `search_conversations` addon's `processId` threading.
     */
    parentProcessId?: string;
}

export interface SendToConversationSuccess {
    /** Conversation process id. */
    processId: string;
    /** SPA deep-link to the conversation. */
    openLink: string;
    /** Post mode only: appended user-turn index. */
    turnIndex?: number;
    /** Ralph mode only: the launched Ralph session id. */
    sessionId?: string;
    /** Cancel only: false means the conversation was already terminal. */
    cancelled?: boolean;
    /** Cancel only: resulting process/task status. */
    status?: ConversationCancellationResult['status'];
    /** Cancel only: the target's workspace, when recorded. */
    workspaceId?: string;
    /** Remote launches cannot return terminal results to the originating conversation. */
    resultDelivery?: { status: 'unavailable'; reason: string };
}

export interface SendToConversationError {
    error: string;
    code?: string;
}

export type SendToConversationResult = SendToConversationSuccess | SendToConversationError;

// ============================================================================
// Constants
// ============================================================================

/** Modes this tool may start — a strict subset of the queue's chat modes. */
const ALLOWED_MODES: ReadonlySet<string> = new Set<SendToConversationMode>(['autopilot', 'ask', 'ralph']);
const DEFAULT_MODE: SendToConversationMode = 'ask';
/** Create-mode default for a call made from a sentinel (dispatcher) chat. */
const SENTINEL_DEFAULT_MODE: SendToConversationMode = 'autopilot';

const ALLOWED_PRIORITIES: ReadonlySet<string> = new Set(['high', 'normal', 'low']);
const DEFAULT_PRIORITY = 'normal';

const ALLOWED_DELIVERY_MODES: ReadonlySet<string> = new Set<SendToConversationDeliveryMode>([
    'immediate',
    'enqueue',
    'steer',
]);

const ALLOWED_EFFORT_TIERS: ReadonlySet<string> = new Set<SendToConversationEffortTier>([
    'very-low',
    'low',
    'medium',
    'high',
]);

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a `send_to_conversation` custom tool definition for the Copilot SDK.
 *
 * @param options Tool options (store + caller workspace + enqueue/send capabilities).
 */
export function createSendToConversationTool(options: SendToConversationToolOptions) {
    const { store, workspaceId: callerWorkspaceId, enqueueChat, sendMessage, launchRalph, parentProcessId, runtime } = options;
    const directory = runtime?.workspaceDirectory ?? createWorkspaceDirectory({ store });

    const tool = defineTool<SendToConversationArgs>('send_to_conversation', {
        description:
            'With `processId`, post to an existing local chat; without it, create a separate fire-and-forget chat. ' +
            'Returns `{ processId, openLink, turnIndex? }`. Supply a short, task-specific `title` for new chats. ' +
            '`mode: "ralph"` starts an autonomous goal loop; returns `sessionId` too. `plan` is not supported. ' +
            'Prefer `provider: "auto"` unless a provider/model was requested. ' +
            'Remote launches return `resultDelivery.status: "unavailable"`: no automatic result reviews or WhatsApp/Teams return; inspect `openLink`. ' +
            'Do not promise an automatic return or start a duplicate job. ' +
            'Use `{ action: "cancel", processId }` to stop local work, retaining history. ' +
            'Omit send-only fields; optional `workspaceId` asserts ownership. Returns `cancelled` and `status`; ' +
            '`cancelled: false` means already terminal. Unknown IDs and failures return errors.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['send', 'cancel'],
                    description: 'Default `send`; `cancel` stops a local process without sending content.',
                },
                content: {
                    type: 'string',
                    description: 'Message or new-chat prompt; Ralph goal spec. Required for send; omit for cancel.',
                },
                processId: {
                    type: 'string',
                    description:
                        'Local chat to post to or cancel, including queue_<taskId>. Omit to create.',
                },
                workspaceId: {
                    type: 'string',
                    description: 'New-chat target: ID from `list_workspaces`, remote:<serverId>:<workspaceId>, repo name, or name@server. ' +
                        'Default: current workspace. Cancel: optional local owner ID.',
                },
                mode: {
                    type: 'string',
                    enum: ['autopilot', 'ask', 'ralph'],
                    description: 'Ask: read-only; Autopilot: edit/run; Ralph: new goal loop only. ' +
                        'New-chat default: ask (autopilot from Sentinel). Post default: unchanged.',
                },
                deliveryMode: {
                    type: 'string',
                    enum: ['immediate', 'enqueue', 'steer'],
                    description: 'Post mode: how the follow-up is delivered.',
                },
                title: {
                    type: 'string',
                    description: 'New-chat persistent title; trimmed, non-empty, max 80 characters. Omit for auto-title; ignored in post mode.',
                },
                model: {
                    type: 'string',
                    description: 'Overrides the AI model (both modes).',
                },
                provider: {
                    type: 'string',
                    enum: ['auto', 'copilot', 'codex', 'claude', 'opencode'],
                    description: 'New-chat provider. Auto uses destination routing without parent settings; unavailable Auto or omission uses the parent provider. Ignored in post mode.',
                },
                effortTier: {
                    type: 'string',
                    enum: ['very-low', 'low', 'medium', 'high'],
                    description: 'Provider-specific tier. New-chat default: medium. No post default. Explicit model wins.',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Create mode: queue priority. Default `normal`.',
                },
            },
            anyOf: [
                { properties: { action: { const: 'cancel' } }, required: ['action', 'processId'] },
                { properties: { action: { enum: ['send'] } }, required: ['content'] },
            ],
        },
        handler: async (args: SendToConversationArgs): Promise<SendToConversationResult> => {
            if (args.action !== undefined && args.action !== 'send' && args.action !== 'cancel') {
                return { error: `Unknown action: '${String(args.action)}'. Valid actions: send, cancel.` };
            }
            if (args.action === 'cancel') {
                if (typeof args.processId !== 'string' || !args.processId.trim()) {
                    return { error: 'Cancel requires a non-empty processId.' };
                }
                const processId = args.processId.trim();
                if (args.workspaceId !== undefined && typeof args.workspaceId !== 'string') {
                    return { error: 'Cancel workspaceId must be an exact local workspace ID.' };
                }
                if (processId.startsWith('remote:') || args.workspaceId?.startsWith('remote:') || args.workspaceId?.includes('@')) {
                    return { error: 'Cancellation on a remote CoC server is not supported. Cancel only accepts local conversation IDs and workspace IDs.' };
                }
                if ((['content', 'mode', 'deliveryMode', 'title', 'model', 'provider', 'effortTier', 'priority'] as const)
                    .some(field => args[field] !== undefined)) {
                    return { error: 'Cancel does not accept send-only fields; use { action: "cancel", processId, workspaceId? }.' };
                }
                if (!runtime?.cancelConversation) {
                    return { error: 'Cancellation is not available in this context (no cancellation capability was wired).' };
                }
                try {
                    const result = await runtime.cancelConversation(processId, args.workspaceId);
                    return { ...result, openLink: result.workspaceId
                        ? buildChatOpenLink(result.workspaceId, result.processId)
                        : `#/process/${encodeURIComponent(result.processId)}` };
                } catch (err) {
                    return {
                        error: `Failed to cancel conversation: ${err instanceof Error ? err.message : String(err)}`,
                        ...(err instanceof APIError ? { code: err.code } : {}),
                    };
                }
            }
            // --- content (required, non-empty) --------------------------------
            if (typeof args.content !== 'string' || !args.content.trim()) {
                return { error: 'Missing required field: content must be a non-empty string.' };
            }
            const content = args.content;

            // --- mode (restricted to ask|autopilot) ---------------------------
            if (args.mode !== undefined && !ALLOWED_MODES.has(args.mode)) {
                return {
                    error:
                        `Invalid mode: '${String(args.mode)}'. ` +
                        `send_to_conversation only supports: ${[...ALLOWED_MODES].join(', ')}.`,
                };
            }

            // --- model (pass-through; reject empty/non-string) ----------------
            if (args.model !== undefined && (typeof args.model !== 'string' || !args.model.trim())) {
                return { error: 'Invalid model: must be a non-empty string when provided.' };
            }
            const model = args.model?.trim();

            // --- provider (create only; accepted+ignored in post mode) ----------
            const provider = args.provider;
            if (provider !== undefined && (typeof provider !== 'string' || (provider !== 'auto' && !VALID_CHAT_PROVIDERS.has(provider as ChatProvider)))) {
                return {
                    error:
                        `Invalid provider: '${String(args.provider)}'. ` +
                        `Valid providers: auto, ${[...VALID_CHAT_PROVIDERS].join(', ')}. ` +
                        'Note: provider only applies when creating a new conversation; in post mode the existing ' +
                        'conversation provider is unchanged.',
                };
            }

            // --- effortTier (both modes; model wins over tier resolution) -------
            const effortTier = args.effortTier;
            if (effortTier !== undefined && (typeof effortTier !== 'string' || !ALLOWED_EFFORT_TIERS.has(effortTier))) {
                return {
                    error:
                        `Invalid effortTier: '${String(args.effortTier)}'. ` +
                        `Valid tiers: ${[...ALLOWED_EFFORT_TIERS].join(', ')}. ` +
                        'Note: when `model` is also supplied, `model` wins and the tier is ignored.',
                };
            }

            // --- mode switch: processId provided → post into existing chat ----
            const targetProcessId =
                typeof args.processId === 'string' && args.processId.trim() ? args.processId.trim() : undefined;
            if (targetProcessId) {
                if (targetProcessId.startsWith('remote:')) {
                    return {
                        error:
                            'Posting into a conversation on a remote CoC server is not supported yet. ' +
                            'Post mode only accepts local conversation processIds.',
                    };
                }
                if (args.mode === 'ralph') {
                    return {
                        error:
                            "Invalid mode: 'ralph' only applies when creating a new conversation. " +
                            'Omit `processId` to launch a Ralph session, or post with `ask` / `autopilot`.',
                    };
                }
                return postToExistingConversation({
                    store,
                    sendMessage,
                    processId: targetProcessId,
                    content,
                    // Omitted → the delivery path keeps the conversation's mode.
                    mode: args.mode,
                    model,
                    effortTier: model ? undefined : effortTier,
                    getEffortTiersForProvider: runtime?.getEffortTiersForProvider,
                    deliveryMode: args.deliveryMode,
                });
            }

            // --- create mode: start a brand-new conversation ------------------
            return createNewConversation({
                store,
                directory,
                callerWorkspaceId,
                enqueueChat,
                launchRalph,
                parentProcessId,
                args,
                content,
                mode: args.mode ?? await resolveDefaultCreateMode(store, parentProcessId),
                model,
                explicitProvider: provider,
                effortTier: model ? undefined : effortTier ?? 'medium',
                validateProvider: runtime?.validateProvider,
                isAutoProviderRoutingAvailable: runtime?.isAutoProviderRoutingAvailable,
                getEffortTiersForProvider: runtime?.getEffortTiersForProvider,
                messagingOrigin: runtime?.messagingOrigin,
                trackMessagingJob: runtime?.trackMessagingJob,
            });
        },
    });

    return { tool };
}

// ============================================================================
// Post mode — deliver into an existing conversation
// ============================================================================

async function postToExistingConversation(params: {
    store: ProcessStore;
    sendMessage?: SendMessageFn;
    processId: string;
    content: string;
    mode?: SendToConversationChatMode;
    model?: string;
    effortTier?: SendToConversationEffortTier;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
    deliveryMode?: SendToConversationDeliveryMode;
}): Promise<SendToConversationResult> {
    const { store, sendMessage, processId, content, mode, model, effortTier, getEffortTiersForProvider, deliveryMode } = params;

    if (deliveryMode !== undefined && !ALLOWED_DELIVERY_MODES.has(deliveryMode)) {
        return {
            error:
                `Invalid deliveryMode: '${String(deliveryMode)}'. ` +
                `Valid delivery modes: ${[...ALLOWED_DELIVERY_MODES].join(', ')}. ` +
                'Note: deliveryMode only applies when posting into an existing conversation.',
        };
    }

    if (!sendMessage) {
        return {
            error:
                'Posting to an existing conversation is not available in this context ' +
                '(no message-delivery capability was wired).',
        };
    }

    try {
        const tierOverride = effortTier
            ? await resolvePostModeEffortTier({
                store,
                processId,
                effortTier,
                getEffortTiersForProvider,
            })
            : {};
        if ('error' in tierOverride) {
            return { error: tierOverride.error };
        }

        const { turnIndex } = await sendMessage({
            processId,
            content,
            ...(mode ? { mode } : {}),
            ...(model ? { model } : {}),
            ...tierOverride,
            ...(deliveryMode ? { deliveryMode } : {}),
        });
        return {
            processId,
            openLink: `#/process/${processId}`,
            turnIndex,
        };
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { error: `Failed to post message to conversation '${processId}': ${reason}` };
    }
}

// ============================================================================
// Create mode — start a brand-new conversation
// ============================================================================

/**
 * Create-mode default when the call omits `mode`: `autopilot` from a sentinel
 * (dispatcher) chat, whose hand-offs are meant to do the work, otherwise `ask`.
 */
async function resolveDefaultCreateMode(
    store: ProcessStore,
    parentProcessId: string | undefined,
): Promise<SendToConversationMode> {
    if (!parentProcessId) return DEFAULT_MODE;
    try {
        const parent = await store.getProcess(parentProcessId);
        return normalizeChatMode(parent?.metadata?.mode) === 'sentinel' ? SENTINEL_DEFAULT_MODE : DEFAULT_MODE;
    } catch {
        return DEFAULT_MODE;
    }
}

async function createNewConversation(params: {
    store: ProcessStore;
    directory: WorkspaceDirectory;
    callerWorkspaceId?: string;
    enqueueChat: EnqueueChatFn;
    launchRalph?: LaunchRalphFn;
    parentProcessId?: string;
    args: SendToConversationArgs;
    content: string;
    mode: SendToConversationMode;
    model?: string;
    explicitProvider?: SendToConversationProvider;
    effortTier?: SendToConversationEffortTier;
    validateProvider?: ValidateSendToConversationProviderFn;
    isAutoProviderRoutingAvailable?: () => boolean;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
    messagingOrigin?: SendToConversationRuntimeOptions['messagingOrigin'];
    trackMessagingJob?: SendToConversationRuntimeOptions['trackMessagingJob'];
}): Promise<SendToConversationResult> {
    const {
        store,
        directory,
        callerWorkspaceId,
        enqueueChat,
        launchRalph,
        parentProcessId,
        args,
        content,
        mode,
        model,
        explicitProvider,
        effortTier,
        validateProvider,
        isAutoProviderRoutingAvailable,
        getEffortTiersForProvider,
        messagingOrigin,
        trackMessagingJob,
    } = params;

    if (args.title !== undefined && (typeof args.title !== 'string' || !args.title.trim())) {
        return { error: 'Invalid title: must be a non-empty string when provided.' };
    }
    const title = args.title?.trim();
    if (title !== undefined && title.length > 80) {
        return { error: 'Invalid title: exceeds 80 characters.' };
    }

    // --- workspace (default to caller's; local ID, clone key, or name) -----
    const target = await resolveCreateTarget({
        store,
        directory,
        requested: typeof args.workspaceId === 'string' ? args.workspaceId.trim() : undefined,
        callerWorkspaceId,
    });
    if ('error' in target) {
        return target;
    }

    // --- priority (default normal) ----------------------------------------
    const priority = args.priority ?? DEFAULT_PRIORITY;
    if (!ALLOWED_PRIORITIES.has(priority)) {
        return {
            error:
                `Invalid priority: '${String(args.priority)}'. ` +
                `Valid priorities: ${[...ALLOWED_PRIORITIES].join(', ')}.`,
        };
    }

    if (target.kind === 'remote') {
        return createRemoteConversation({
            directory, target, content, mode, title, priority, model,
            explicitProvider, effortTier, store, parentProcessId,
        });
    }
    const requestedWorkspaceId = target.workspaceId;

    // --- resolve provider/model/reasoningEffort ---------------------------
    // The tool is built per chat turn, so `parentProcessId` identifies the
    // conversation in which this tool was invoked. Read the parent's resolved
    // values from its process metadata (the same authoritative fields the
    // follow-up executor reads — see follow-up-executor.ts). An explicit provider
    // selects that provider's defaults instead of inheriting parent model/effort.
    const parent = parentProcessId ? await store.getProcess(parentProcessId) : undefined;
    const parentProvider =
        typeof parent?.metadata?.provider === 'string' && VALID_CHAT_PROVIDERS.has(parent.metadata.provider as ChatProvider)
            ? (parent.metadata.provider as ChatProvider)
            : undefined;
    const parentEffort =
        typeof parent?.metadata?.reasoningEffort === 'string' ? parent.metadata.reasoningEffort : undefined;

    const autoRequested = explicitProvider === 'auto' && isAutoProviderRoutingAvailable?.() === true;
    // Disabled/missing Auto capability uses ordinary parent inheritance. Never
    // reinterpret routing, quota, validation or dispatch errors as a fallback.
    const concreteOverride = explicitProvider !== 'auto' ? explicitProvider : undefined;
    const resolvedProvider = autoRequested ? undefined : concreteOverride ?? parentProvider;
    const resolvedModel = model;
    const resolvedEffort = autoRequested || concreteOverride || effortTier ? undefined : parentEffort;

    // Omitted provider requires parent context; explicit Auto can route without it.
    // Absent inherited model/effort use provider defaults.
    if (!resolvedProvider && !autoRequested) {
        return {
            error:
                'Cannot determine a provider for the new conversation: no parent chat ' +
                'context was available to inherit from. Supply a concrete `provider` or enable Auto routing.',
        };
    }

    if (resolvedProvider && explicitProvider && validateProvider) {
        try {
            await validateProvider(resolvedProvider);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return { error: `Provider '${resolvedProvider}' is not available for send_to_conversation: ${reason}` };
        }
    }

    if (resolvedProvider && (explicitProvider || effortTier)) {
        const compatibility = validateRequestedModelAndTier({
            provider: resolvedProvider,
            model: resolvedModel,
            effortTier,
            getEffortTiersForProvider,
        });
        if (compatibility) {
            return { error: compatibility };
        }
    }

    // Remote targets returned above. Ralph captures routing for session results only.
    const origin = mode === 'ralph' || trackMessagingJob ? messagingOrigin?.() : undefined;

    if (mode === 'ralph') {
        return launchRalphConversation({
            launchRalph,
            goalSpec: content,
            workspaceId: requestedWorkspaceId,
            title,
            parentProcessId,
            messagingOrigin: origin,
            provider: resolvedProvider,
            autoProviderRouting: autoRequested,
            model: resolvedModel,
            reasoningEffort: resolvedEffort,
            effortTier,
        });
    }

    // --- build + validate the task spec, then enqueue in-process ----------
    // Setting `payload.provider` makes the enqueue path treat the provider as
    // explicit, so inherited/selected concrete providers suppress Auto routing.
    // Explicit Auto omits the provider and carries the existing routing marker.
    // Resolved model goes onto `config.model` (with the `payload.model` mirror),
    // inherited effort onto `config.reasoningEffort`,
    // and the selected/default tier onto `config.effortTier` for queue preparation.
    const taskSpec = buildChatTaskSpec({
        workspaceId: requestedWorkspaceId,
        mode,
        content,
        priority,
        title,
        provider: resolvedProvider,
        autoProviderRouting: autoRequested,
        model: resolvedModel,
        reasoningEffort: resolvedEffort,
        effortTier,
        // Spawn link: persist the calling chat's processId onto the spawned
        // process's top-level `parentProcessId` so the chat list can nest
        // spawned descendants under their root.
        spawnedFromProcessId: parentProcessId,
        messagingOrigin: origin,
    });

    // Reuse the canonical enqueue validation/normalization (config shape, model
    // resolution, display-name generation). Our up-front checks above already
    // reject the cases this path would silently coerce (unknown workspace,
    // plan mode).
    const validation = validateAndParseTask(taskSpec);
    if (!validation.valid || !validation.input) {
        return { error: validation.error ?? 'Failed to build the new conversation task.' };
    }

    const taskId = await enqueueChat(validation.input);
    const processId = toQueueProcessId(taskId);
    if (origin) {
        try {
            trackMessagingJob!({ processId, workspaceId: requestedWorkspaceId, origin });
        } catch (error) {
            console.error('[send_to_conversation] Could not track the completion notice:', error);
        }
    }

    return {
        processId,
        openLink: `#/process/${processId}`,
    };
}

/** The `POST /api/queue` chat task body, shared by local and remote create mode. */
function buildChatTaskSpec(params: {
    workspaceId: string;
    mode: SendToConversationChatMode;
    content: string;
    priority: string;
    title?: string;
    provider?: ChatProvider;
    autoProviderRouting?: boolean;
    model?: string;
    reasoningEffort?: string;
    effortTier?: SendToConversationEffortTier;
    spawnedFromProcessId?: string;
    messagingOrigin?: MessagingJobOrigin;
}): Record<string, unknown> {
    const { workspaceId, mode, content, priority, title, provider, autoProviderRouting, model, reasoningEffort, effortTier, spawnedFromProcessId, messagingOrigin } = params;
    const config: Record<string, unknown> = {
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(effortTier ? { effortTier } : {}),
    };
    return {
        type: 'chat',
        priority,
        workspaceId,
        ...(title ? { displayName: title } : {}),
        payload: {
            kind: 'chat',
            mode,
            prompt: content,
            workspaceId,
            ...(provider ? { provider } : {}),
            ...(title ? { customTitle: title } : {}),
            ...(model ? { model } : {}),
            ...(spawnedFromProcessId || messagingOrigin || autoProviderRouting ? {
                context: {
                    ...(autoProviderRouting ? { autoProviderRouting: { requested: true } } : {}),
                    ...(spawnedFromProcessId ? { spawnedFromProcessId } : {}),
                    ...(messagingOrigin ? { messagingOrigin } : {}),
                },
            } : {}),
        },
        ...(Object.keys(config).length > 0 ? { config } : {}),
    };
}

type CreateTarget =
    | { kind: 'local'; workspaceId: string }
    | { kind: 'remote'; serverId: string; workspaceId: string; cloneKey: string };

/**
 * Resolve create-mode `workspaceId`: omitted → caller workspace; a remote clone
 * key → that remote; a registered local ID → local; otherwise a
 * case-insensitive repo name (exact, then `name@server`) over the directory.
 */
async function resolveCreateTarget(params: {
    store: ProcessStore;
    directory: WorkspaceDirectory;
    requested?: string;
    callerWorkspaceId?: string;
}): Promise<CreateTarget | SendToConversationError> {
    const { store, directory, callerWorkspaceId } = params;
    const requested = params.requested || callerWorkspaceId;
    if (!requested) {
        return {
            error: 'No target workspace: provide `workspaceId` or invoke this tool from a workspace context.',
        };
    }

    const clone = parseRemoteCloneKey(requested);
    if (clone) {
        return { kind: 'remote', ...clone, cloneKey: requested };
    }

    const workspaces = await store.getWorkspaces();
    if (workspaces.some(ws => ws.id === requested)) {
        return { kind: 'local', workspaceId: requested };
    }

    const { entries } = await directory.list();
    const lower = requested.toLowerCase();
    let candidates = entries.filter(e => e.name.toLowerCase() === lower);
    const at = requested.lastIndexOf('@');
    if (candidates.length === 0 && at > 0 && at < requested.length - 1) {
        const name = lower.slice(0, at);
        const server = lower.slice(at + 1);
        candidates = entries.filter(e => e.name.toLowerCase() === name && e.server.toLowerCase() === server);
    }

    if (candidates.length === 0) {
        return {
            error:
                `Unknown workspaceId: '${requested}' is not a registered workspace ID or a known repo name. ` +
                'Call `list_workspaces` to find the right id.',
        };
    }
    if (candidates.length > 1) {
        return {
            error:
                `Ambiguous workspace name '${requested}' matches ${candidates.length} repos: ` +
                candidates.map(c => `${c.id} (server: ${c.server})`).join(', ') +
                '. Retry with one of these ids, or use `name@server`.',
        };
    }

    const match = candidates[0];
    const remote = parseRemoteCloneKey(match.id);
    if (!remote) {
        return { kind: 'local', workspaceId: match.id };
    }
    if (!match.online) {
        return {
            error: `Remote server "${match.server}" is offline, so '${match.name}' cannot be reached. The chat was not started.`,
        };
    }
    return { kind: 'remote', ...remote, cloneKey: match.id };
}

/**
 * Start the new conversation on a remote CoC server through its own queue (or
 * Ralph launch) API. Explicit overrides travel; disabled Auto selects the parent
 * concrete provider after destination capability validation. Remote defaults
 * own model/effort inheritance. The local parent's spawn link stays local.
 */
async function createRemoteConversation(params: {
    directory: WorkspaceDirectory;
    target: Extract<CreateTarget, { kind: 'remote' }>;
    content: string;
    mode: SendToConversationMode;
    title?: string;
    priority: string;
    model?: string;
    explicitProvider?: SendToConversationProvider;
    effortTier?: SendToConversationEffortTier;
    store: ProcessStore;
    parentProcessId?: string;
}): Promise<SendToConversationResult> {
    const { directory, target, content, mode, title, priority, model, explicitProvider, effortTier } = params;
    let provider = explicitProvider;
    if (provider === 'auto') {
        try {
            const available = await directory.isRemoteAutoProviderRoutingAvailable?.(target.serverId);
            if (!available) {
                const parent = params.parentProcessId ? await params.store.getProcess(params.parentProcessId) : undefined;
                const parentProvider = parent?.metadata?.provider;
                if (typeof parentProvider !== 'string' || !VALID_CHAT_PROVIDERS.has(parentProvider as ChatProvider)) {
                    return { error: 'Cannot determine a provider for the new conversation: Auto is unavailable and no concrete parent provider is available.' };
                }
                provider = parentProvider as ChatProvider;
                // Validate against the destination, never against local services
                // or effort tiers. Remote defaults own model/effort inheritance.
                if (!directory.validateRemoteProvider) {
                    return { error: 'Remote provider validation is unavailable; the chat was not started.' };
                }
                await directory.validateRemoteProvider(target.serverId, provider);
                const compatibility = validateRequestedModelAndTier({ provider, model });
                if (compatibility) {
                    return { error: compatibility };
                }
            }
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }
    const body = mode === 'ralph'
        ? {
            goalSpec: content.trim(),
            workspaceId: target.workspaceId,
            ...(provider === 'auto' ? { autoProviderRouting: true } : provider ? { provider } : {}),
            config: {
                ...(model ? { model } : {}),
                ...(effortTier ? { effortTier } : {}),
            },
            ...(title ? { title } : {}),
        }
        : buildChatTaskSpec({
            workspaceId: target.workspaceId,
            mode,
            content,
            priority,
            title,
            provider: provider === 'auto' ? undefined : provider,
            autoProviderRouting: provider === 'auto',
            model,
            effortTier,
        });
    try {
        const result = await directory.startRemoteChat({
            serverId: target.serverId,
            kind: mode === 'ralph' ? 'ralph' : 'queue',
            body,
        });
        return {
            processId: result.processId,
            openLink: buildChatOpenLink(target.cloneKey, result.processId),
            resultDelivery: {
                status: 'unavailable',
                reason: 'The remote job was started, but automatic result return to the originating conversation '
                    + '(including WhatsApp/Teams) is unavailable. Use openLink to inspect its outcome; do not launch a duplicate job.',
            },
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Launch a Ralph session through the shared launch service. The AI selection
 * is the one create mode resolved (inherited or explicit-provider defaults);
 * no worktree is requested and max iterations come from repo preferences.
 */
async function launchRalphConversation(params: {
    launchRalph?: LaunchRalphFn;
    goalSpec: string;
    workspaceId: string;
    title?: string;
    parentProcessId?: string;
    messagingOrigin?: MessagingJobOrigin;
    provider?: ChatProvider;
    autoProviderRouting?: boolean;
    model?: string;
    reasoningEffort?: string;
    effortTier?: SendToConversationEffortTier;
}): Promise<SendToConversationResult> {
    const { launchRalph, goalSpec, workspaceId, title, parentProcessId, messagingOrigin, provider, autoProviderRouting, model, reasoningEffort, effortTier } = params;
    if (!launchRalph) {
        return {
            error: "Launching a Ralph session is not available in this context (no Ralph launch capability was wired).",
        };
    }

    try {
        const result = await launchRalph({
            goalSpec: goalSpec.trim(),
            workspaceId,
            aiSelection: {
                ...(provider ? { provider } : {}),
                ...(autoProviderRouting ? { autoProviderRouting: true } : {}),
                config: {
                    ...(model ? { model } : {}),
                    ...(reasoningEffort ? { reasoningEffort } : {}),
                    ...(effortTier ? { effortTier } : {}),
                },
            },
            ...(title ? { title } : {}),
            ...(parentProcessId ? { spawnedFromProcessId: parentProcessId } : {}),
            ...(messagingOrigin ? { messagingOrigin } : {}),
        });
        if (!result.ok) {
            return { error: `Failed to launch Ralph session: ${result.error}` };
        }
        return {
            processId: result.processId,
            sessionId: result.sessionId,
            openLink: `#/process/${result.processId}`,
        };
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { error: `Failed to launch Ralph session: ${reason}` };
    }
}

async function resolvePostModeEffortTier(params: {
    store: ProcessStore;
    processId: string;
    effortTier: SendToConversationEffortTier;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
}): Promise<{ model?: string; effort?: ReasoningEffort } | { error: string }> {
    const { store, processId, effortTier, getEffortTiersForProvider } = params;
    const proc = await resolveProcessForTool(store, processId);
    if (!proc) {
        return { error: `Cannot resolve effortTier '${effortTier}': process '${processId}' was not found.` };
    }

    const provider = normalizeProcessProvider(proc);
    const tier = resolveTierForProvider(provider, effortTier, getEffortTiersForProvider);
    if (!tier) {
        return { error: `No effort tier '${effortTier}' is configured for provider '${provider}'.` };
    }

    const modelResolution = resolveModelForProvider(provider, tier.model);
    if (modelResolution.coerced) {
        return {
            error:
                `Effort tier '${effortTier}' resolves to model '${tier.model}', ` +
                `which is not compatible with provider '${provider}'.`,
        };
    }

    return {
        model: modelResolution.model,
        ...(tier.reasoningEffort ? { effort: tier.reasoningEffort as ReasoningEffort } : {}),
    };
}

function validateRequestedModelAndTier(params: {
    provider: ChatProvider;
    model?: string;
    effortTier?: SendToConversationEffortTier;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
}): string | undefined {
    const { provider, model, effortTier, getEffortTiersForProvider } = params;
    if (model) {
        const modelResolution = resolveModelForProvider(provider, model);
        if (modelResolution.coerced) {
            return `Model '${model}' is not compatible with provider '${provider}'.`;
        }
        return undefined;
    }
    if (!effortTier) return undefined;

    const tier = resolveTierForProvider(provider, effortTier, getEffortTiersForProvider);
    if (!tier) {
        return `No effort tier '${effortTier}' is configured for provider '${provider}'.`;
    }
    const modelResolution = resolveModelForProvider(provider, tier.model);
    if (modelResolution.coerced) {
        return (
            `Effort tier '${effortTier}' resolves to model '${tier.model}', ` +
            `which is not compatible with provider '${provider}'.`
        );
    }
    return undefined;
}

function resolveTierForProvider(
    provider: ChatProvider,
    effortTier: SendToConversationEffortTier,
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn,
) {
    const tiers = mergeEffortTiersWithDefaults(provider, getEffortTiersForProvider?.(provider));
    return tiers[effortTier];
}

async function resolveProcessForTool(store: ProcessStore, processId: string): Promise<AIProcess | undefined> {
    const direct = await store.getProcess(processId);
    if (direct) return direct;
    if (isQueueProcessId(processId)) {
        return store.getProcess(toTaskId(processId));
    }
    return undefined;
}

function normalizeProcessProvider(proc: AIProcess): ChatProvider {
    const provider = proc.metadata?.provider;
    return typeof provider === 'string' && VALID_CHAT_PROVIDERS.has(provider as ChatProvider)
        ? (provider as ChatProvider)
        : 'copilot';
}
