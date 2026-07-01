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
 * NOTE on `model` validation: the queue path already coerces a model that the
 * resolved provider does not support (see `resolveModelForProvider` in
 * `validateAndParseTask`). This tool therefore treats `model` as a pass-through
 * string — it only rejects an empty / non-string value — and leaves
 * provider-specific allow-listing to the shared enqueue / delivery machinery.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { validateAndParseTask } from '../routes/queue-shared';

// ============================================================================
// Types
// ============================================================================

/** Chat modes this tool may start / deliver as. `plan` and `ralph` are rejected. */
export type SendToConversationMode = 'autopilot' | 'ask';

/** Delivery modes for post mode (an existing conversation). */
export type SendToConversationDeliveryMode = 'immediate' | 'enqueue' | 'steer';

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
    deliveryMode?: SendToConversationDeliveryMode;
}) => Promise<{ turnIndex: number }>;

export interface SendToConversationToolOptions {
    /** ProcessStore instance — used to validate the target workspace exists. */
    store: ProcessStore;
    /** The caller's current workspace ID; the default create-mode target. */
    workspaceId?: string;
    /** Bound in-process enqueue capability (create mode). */
    enqueueChat: EnqueueChatFn;
    /** Bound in-process follow-up delivery capability (post mode). */
    sendMessage?: SendMessageFn;
    /**
     * The parent chat's processId — the conversation in which this tool was
     * built/invoked. In create mode the handler reads the parent process
     * record's resolved `provider` / `model` / `reasoningEffort` from its
     * `metadata` and inherits them onto the spawned conversation (per-field
     * overridable by the explicit `model` param; `provider` and
     * `reasoningEffort` are always inherited). Mirrors the
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

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a `send_to_conversation` custom tool definition for the Copilot SDK.
 *
 * @param options Tool options (store + caller workspace + enqueue/send capabilities).
 */
export function createSendToConversationTool(options: SendToConversationToolOptions) {
    const { store, workspaceId: callerWorkspaceId, enqueueChat, sendMessage, parentProcessId } = options;

    const tool = defineTool<SendToConversationArgs>('send_to_conversation', {
        description:
            'Send a message to a conversation. ' +
            'If `processId` is provided, posts `content` as a message into that EXISTING ' +
            'conversation and returns `{ processId, openLink, turnIndex }`; the create-only ' +
            'fields (`workspaceId`, `title`, `priority`) are ignored in this mode. ' +
            'If `processId` is omitted, starts a brand-new, separate chat conversation ' +
            '(fire-and-forget) with `content` as its first prompt — it appears in the dashboard ' +
            'chat list and is executed by the queue, and `deliveryMode` is ignored; it does NOT ' +
            'continue or follow up the current chat. Returns `{ processId, openLink }`. ' +
            '`content` is required; in create mode `workspaceId` defaults to the current ' +
            'workspace and `mode` defaults to `ask`.',
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
                    description:
                        'Create mode: target workspace/repo ID. Any registered workspace may be ' +
                        'targeted. Defaults to the current workspace when omitted. Ignored in post mode.',
                },
                mode: {
                    type: 'string',
                    enum: ['autopilot', 'ask'],
                    description: 'Chat mode: `ask` (read-only, default) or `autopilot` (can edit/run).',
                },
                deliveryMode: {
                    type: 'string',
                    enum: ['immediate', 'enqueue', 'steer'],
                    description:
                        'Post mode: how the follow-up is delivered (`immediate`, `enqueue`, or `steer`). ' +
                        'Ignored in create mode.',
                },
                title: {
                    type: 'string',
                    description:
                        'Create mode: display name for the new chat. Auto-generated from `content` ' +
                        'when omitted. Ignored in post mode.',
                },
                model: {
                    type: 'string',
                    description: 'Overrides the AI model (both modes).',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Create mode: queue priority. Default `normal`. Ignored in post mode.',
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

            // --- mode switch: processId provided → post into existing chat ----
            const targetProcessId =
                typeof args.processId === 'string' && args.processId.trim() ? args.processId.trim() : undefined;
            if (targetProcessId) {
                return postToExistingConversation({
                    sendMessage,
                    processId: targetProcessId,
                    content,
                    mode,
                    model,
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
            });
        },
    });

    return { tool };
}

// ============================================================================
// Post mode — deliver into an existing conversation
// ============================================================================

async function postToExistingConversation(params: {
    sendMessage?: SendMessageFn;
    processId: string;
    content: string;
    mode: SendToConversationMode;
    model?: string;
    deliveryMode?: SendToConversationDeliveryMode;
}): Promise<SendToConversationResult> {
    const { sendMessage, processId, content, mode, model, deliveryMode } = params;

    if (deliveryMode !== undefined && !ALLOWED_DELIVERY_MODES.has(deliveryMode)) {
        return {
            error:
                `Invalid deliveryMode: '${String(deliveryMode)}'. ` +
                `Valid delivery modes: ${[...ALLOWED_DELIVERY_MODES].join(', ')}.`,
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
        const { turnIndex } = await sendMessage({
            processId,
            content,
            mode,
            ...(model ? { model } : {}),
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
}): Promise<SendToConversationResult> {
    const { store, callerWorkspaceId, enqueueChat, parentProcessId, args, content, mode, model } = params;

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

    // --- inherit provider/model/reasoningEffort from the parent chat ------
    // The tool is built per chat turn, so `parentProcessId` identifies the
    // conversation in which this tool was invoked. Read the parent's resolved
    // values from its process metadata (the same authoritative fields the
    // follow-up executor reads — see follow-up-executor.ts). An explicit `model`
    // param wins for that field; everything else inherits from the parent.
    const parent = parentProcessId ? await store.getProcess(parentProcessId) : undefined;
    const parentProvider =
        typeof parent?.metadata?.provider === 'string' ? parent.metadata.provider : undefined;
    const parentModel = typeof parent?.metadata?.model === 'string' ? parent.metadata.model : undefined;
    const parentEffort =
        typeof parent?.metadata?.reasoningEffort === 'string' ? parent.metadata.reasoningEffort : undefined;

    const resolvedProvider = parentProvider;
    const resolvedModel = model ?? parentModel;
    const resolvedEffort = parentEffort;

    // Only a missing provider is fatal. A resolvable parent whose model /
    // reasoningEffort are absent falls back to provider defaults below.
    if (!resolvedProvider) {
        return {
            error:
                'Cannot determine a provider for the new conversation: no parent chat ' +
                'context was available to inherit from.',
        };
    }

    // --- build + validate the task spec, then enqueue in-process ----------
    // Setting `payload.provider` makes the enqueue path treat the provider as
    // explicit, so the inherited provider also suppresses global default-provider
    // auto-routing. Resolved model goes onto `config.model` (with the existing
    // `payload.model` mirror) and the inherited effort onto
    // `config.reasoningEffort`; `config.effortTier` is intentionally never set.
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
    const config: Record<string, unknown> = {
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
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
