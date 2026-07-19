/**
 * Send To Conversation Tool
 *
 * Factory that creates a single dual-mode `send_to_conversation` custom tool for
 * the Copilot SDK. The `processId` argument is the mode switch:
 *
 *   - `processId` omitted → **create mode**: start a brand-new chat
 *     (fire-and-forget) through the same in-process queue path that
 *     `POST /api/queue` uses (no HTTP self-call) so the conversation appears in
 *     the dashboard chat list and is picked up by the queue executor. Returns
 *     immediately with the queued conversation's identity.
 *   - `processId` provided → **post mode**: post `content` as a follow-up
 *     message into that existing conversation, wrapping the same delivery path
 *     `POST /api/processes/:id/message` uses (via the injected `sendMessage`
 *     capability). Returns the appended user-turn index.
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance bound
 * to the store + enqueue/send capabilities + the caller's current workspace,
 * avoiding cross-request contamination.
 *
 * NOTE on `model` validation: legacy calls that only supply the existing `model`
 * argument keep the queue path's pass-through/coercion behavior. Calls that also
 * select a new explicit provider or effort tier validate provider compatibility
 * before enqueueing so the tool never falls back to a different provider.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { AIProcess, CreateTaskInput, ProcessStore, StoredEffortTiersMap } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, mergeEffortTiersWithDefaults, resolveModelForProvider, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { validateAndParseTask } from '../routes/queue-shared';
import { VALID_CHAT_PROVIDERS, type ChatProvider, type ReasoningEffort } from '../tasks/task-types';

// ============================================================================
// Types
// ============================================================================

/** Chat modes this tool may start / deliver as. `plan` and `ralph` are rejected. */
export type SendToConversationMode = 'autopilot' | 'ask';

/** Delivery modes for post mode (an existing conversation). */
export type SendToConversationDeliveryMode = 'immediate' | 'enqueue' | 'steer';

/** Concrete providers this tool accepts; `auto` and registry aliases are excluded. */
export type SendToConversationProvider = ChatProvider;

/** Provider-scoped effort tiers accepted by this tool. */
export type SendToConversationEffortTier = 'very-low' | 'low' | 'medium' | 'high';

export interface SendToConversationArgs {
    /** The message (post mode) / first prompt (create mode). Required. */
    content: string;
    /**
     * Mode switch. Omitted → create a new conversation; provided → post into
     * that existing conversation.
     */
    processId?: string;
    /** Create mode: target workspace/repo. Defaults to the caller's workspace. */
    workspaceId?: string;
    /** Chat mode, restricted to `autopilot` | `ask`. Default `ask`. */
    mode?: SendToConversationMode;
    /** Post mode: how the follow-up is delivered. Ignored in create mode. */
    deliveryMode?: SendToConversationDeliveryMode;
    /** Create mode: display name for the new chat. Auto-generated when omitted. */
    title?: string;
    /** Overrides the AI model (both modes). */
    model?: string;
    /**
     * Create mode: explicit concrete provider. Post mode: accepted but ignored;
     * the existing conversation provider remains authoritative.
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
    mode?: SendToConversationMode;
    model?: string;
    effort?: ReasoningEffort;
    deliveryMode?: SendToConversationDeliveryMode;
}) => Promise<{ turnIndex: number }>;

/** Validate a concrete provider before an explicit create-mode selection enqueues. */
export type ValidateSendToConversationProviderFn = (provider: SendToConversationProvider) => Promise<void> | void;

/** Read stored provider-specific effort-tier overrides; defaults are merged by the tool. */
export type GetSendToConversationEffortTiersFn = (provider: SendToConversationProvider) => StoredEffortTiersMap | undefined;

export interface SendToConversationRuntimeOptions {
    validateProvider?: ValidateSendToConversationProviderFn;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
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
    /** Runtime provider/tier helpers supplied by the server route layer. */
    runtime?: SendToConversationRuntimeOptions;
    /**
     * The parent chat's processId — the conversation in which this tool was
     * built/invoked. In create mode the handler reads the parent process
     * record's resolved `provider` / `model` / `reasoningEffort` from its
     * `metadata` and inherits them onto the spawned conversation unless an
     * explicit provider or effort tier asks for provider defaults. Mirrors the
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
}

export interface SendToConversationError {
    error: string;
}

export type SendToConversationResult = SendToConversationSuccess | SendToConversationError;

// ============================================================================
// Constants
// ============================================================================

/** Modes this tool may start — a strict subset of the queue's chat modes. */
const ALLOWED_MODES: ReadonlySet<string> = new Set<SendToConversationMode>(['autopilot', 'ask']);
const DEFAULT_MODE: SendToConversationMode = 'ask';

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
    const { store, workspaceId: callerWorkspaceId, enqueueChat, sendMessage, parentProcessId, runtime } = options;

    const tool = defineTool<SendToConversationArgs>('send_to_conversation', {
        description:
            'Send a message to a conversation. With `processId`, posts `content` into that EXISTING conversation and ' +
            'returns `{ processId, openLink, turnIndex }`. Without `processId`, starts a brand-new, separate ' +
            'fire-and-forget chat with `content` as its first prompt (it does NOT continue the current chat) and ' +
            'returns `{ processId, openLink }`. `content` is required; `mode` defaults to `ask` and create mode ' +
            'defaults to the current workspace.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The message (post mode) or first prompt (create mode). Required.',
                },
                processId: {
                    type: 'string',
                    description:
                        'Mode switch. When given, posts `content` into that existing conversation; ' +
                        'when omitted, starts a new conversation.',
                },
                workspaceId: {
                    type: 'string',
                    description: 'Create mode: target workspace/repo ID. Defaults to the current workspace.',
                },
                mode: {
                    type: 'string',
                    enum: ['autopilot', 'ask'],
                    description: 'Chat mode: `ask` (read-only, default) or `autopilot` (can edit/run).',
                },
                deliveryMode: {
                    type: 'string',
                    enum: ['immediate', 'enqueue', 'steer'],
                    description: 'Post mode: how the follow-up is delivered.',
                },
                title: {
                    type: 'string',
                    description: 'Create mode: display name for the new chat. Auto-generated when omitted.',
                },
                model: {
                    type: 'string',
                    description: 'Overrides the AI model (both modes).',
                },
                provider: {
                    type: 'string',
                    enum: ['copilot', 'codex', 'claude', 'opencode'],
                    description: 'Create mode: concrete AI provider for the new conversation.',
                },
                effortTier: {
                    type: 'string',
                    enum: ['very-low', 'low', 'medium', 'high'],
                    description: 'Provider-specific effort tier. Ignored when `model` is also provided.',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Create mode: queue priority. Default `normal`.',
                },
            },
            required: ['content'],
        },
        handler: async (args: SendToConversationArgs): Promise<SendToConversationResult> => {
            // --- content (required, non-empty) --------------------------------
            if (typeof args.content !== 'string' || !args.content.trim()) {
                return { error: 'Missing required field: content must be a non-empty string.' };
            }
            const content = args.content;

            // --- mode (restricted to ask|autopilot) ---------------------------
            const mode = args.mode ?? DEFAULT_MODE;
            if (!ALLOWED_MODES.has(mode)) {
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
            if (provider !== undefined && (typeof provider !== 'string' || !VALID_CHAT_PROVIDERS.has(provider as ChatProvider))) {
                return {
                    error:
                        `Invalid provider: '${String(args.provider)}'. ` +
                        `Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}. ` +
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
                return postToExistingConversation({
                    store,
                    sendMessage,
                    processId: targetProcessId,
                    content,
                    mode,
                    model,
                    effortTier: model ? undefined : effortTier,
                    getEffortTiersForProvider: runtime?.getEffortTiersForProvider,
                    deliveryMode: args.deliveryMode,
                });
            }

            // --- create mode: start a brand-new conversation ------------------
            return createNewConversation({
                store,
                callerWorkspaceId,
                enqueueChat,
                parentProcessId,
                args,
                content,
                mode,
                model,
                explicitProvider: provider,
                effortTier: model ? undefined : effortTier,
                validateProvider: runtime?.validateProvider,
                getEffortTiersForProvider: runtime?.getEffortTiersForProvider,
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
    mode: SendToConversationMode;
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
            mode,
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

async function createNewConversation(params: {
    store: ProcessStore;
    callerWorkspaceId?: string;
    enqueueChat: EnqueueChatFn;
    parentProcessId?: string;
    args: SendToConversationArgs;
    content: string;
    mode: SendToConversationMode;
    model?: string;
    explicitProvider?: SendToConversationProvider;
    effortTier?: SendToConversationEffortTier;
    validateProvider?: ValidateSendToConversationProviderFn;
    getEffortTiersForProvider?: GetSendToConversationEffortTiersFn;
}): Promise<SendToConversationResult> {
    const {
        store,
        callerWorkspaceId,
        enqueueChat,
        parentProcessId,
        args,
        content,
        mode,
        model,
        explicitProvider,
        effortTier,
        validateProvider,
        getEffortTiersForProvider,
    } = params;

    // --- workspace (default to caller's; must be registered) --------------
    const requestedWorkspaceId =
        typeof args.workspaceId === 'string' && args.workspaceId.trim()
            ? args.workspaceId.trim()
            : callerWorkspaceId;
    if (!requestedWorkspaceId) {
        return {
            error: 'No target workspace: provide `workspaceId` or invoke this tool from a workspace context.',
        };
    }
    const workspaces = await store.getWorkspaces();
    if (!workspaces.some(ws => ws.id === requestedWorkspaceId)) {
        return { error: `Unknown workspaceId: '${requestedWorkspaceId}' is not a registered workspace.` };
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
    const parentModel = typeof parent?.metadata?.model === 'string' ? parent.metadata.model : undefined;
    const parentEffort =
        typeof parent?.metadata?.reasoningEffort === 'string' ? parent.metadata.reasoningEffort : undefined;

    const resolvedProvider = explicitProvider ?? parentProvider;
    const resolvedModel = model ?? (explicitProvider || effortTier ? undefined : parentModel);
    const resolvedEffort = explicitProvider || effortTier ? undefined : parentEffort;

    // Only a missing provider is fatal. A resolvable parent whose model /
    // reasoningEffort are absent falls back to provider defaults below.
    if (!resolvedProvider) {
        return {
            error:
                'Cannot determine a provider for the new conversation: no parent chat ' +
                'context was available to inherit from and no explicit `provider` was supplied.',
        };
    }

    if (explicitProvider && validateProvider) {
        try {
            await validateProvider(explicitProvider);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return { error: `Provider '${explicitProvider}' is not available for send_to_conversation: ${reason}` };
        }
    }

    if (explicitProvider || effortTier) {
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

    // --- build + validate the task spec, then enqueue in-process ----------
    // Setting `payload.provider` makes the enqueue path treat the provider as
    // explicit, so inherited/selected providers suppress global default-provider
    // auto-routing. Resolved model goes onto `config.model` (with the existing
    // `payload.model` mirror), inherited effort onto `config.reasoningEffort`,
    // and an explicit tier onto `config.effortTier` for queue preparation.
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
    const config: Record<string, unknown> = {
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
        ...(effortTier ? { effortTier } : {}),
    };
    const taskSpec: Record<string, unknown> = {
        type: 'chat',
        priority,
        workspaceId: requestedWorkspaceId,
        ...(title ? { displayName: title } : {}),
        payload: {
            kind: 'chat',
            mode,
            prompt: content,
            workspaceId: requestedWorkspaceId,
            provider: resolvedProvider,
            ...(resolvedModel ? { model: resolvedModel } : {}),
            // Spawn link: persist the calling chat's processId onto the spawned
            // process's top-level `parentProcessId` so the chat list can nest
            // spawned descendants under their root.
            ...(parentProcessId ? { context: { spawnedFromProcessId: parentProcessId } } : {}),
        },
        ...(Object.keys(config).length > 0 ? { config } : {}),
    };

    // Reuse the canonical enqueue validation/normalization (config shape, model
    // resolution, display-name generation). Our up-front checks above already
    // reject the cases this path would silently coerce (unknown workspace,
    // ralph/plan mode).
    const validation = validateAndParseTask(taskSpec);
    if (!validation.valid || !validation.input) {
        return { error: validation.error ?? 'Failed to build the new conversation task.' };
    }

    const taskId = await enqueueChat(validation.input);
    const processId = toQueueProcessId(taskId);

    return {
        processId,
        openLink: `#/process/${processId}`,
    };
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
    provider: SendToConversationProvider;
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
    provider: SendToConversationProvider,
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

function normalizeProcessProvider(proc: AIProcess): SendToConversationProvider {
    const provider = proc.metadata?.provider;
    return typeof provider === 'string' && VALID_CHAT_PROVIDERS.has(provider as ChatProvider)
        ? (provider as SendToConversationProvider)
        : 'copilot';
}
