/**
 * Create Conversation Tool
 *
 * Factory that creates a `create_conversation` custom tool for the Copilot SDK.
 * The model calls this tool to start a brand-new chat (its primary use case is
 * an agent delegating / spawning a separate piece of work) with a small,
 * simplified parameter set instead of the full `POST /api/queue` payload.
 *
 * The tool is fire-and-forget: it enqueues the new chat through the same
 * in-process queue path that `POST /api/queue` uses (no HTTP self-call) so the
 * conversation appears in the dashboard chat list and is picked up by the queue
 * executor, then returns immediately with the queued task's identity.
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance bound
 * to the store + enqueue capability + the caller's current workspace, avoiding
 * cross-request contamination.
 *
 * NOTE on `model` validation: the queue path already coerces a model that the
 * resolved provider does not support (see `resolveModelForProvider` in
 * `validateAndParseTask`). This tool therefore treats `model` as a pass-through
 * string — it only rejects an empty / non-string value — and leaves
 * provider-specific allow-listing to the shared enqueue machinery.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { VALID_CHAT_PROVIDERS, type ChatProvider } from '../tasks/task-types';
import { validateAndParseTask } from '../routes/queue-shared';

// ============================================================================
// Types
// ============================================================================

/** Chat modes this tool may start. `plan` and `ralph` are intentionally rejected. */
export type CreateConversationMode = 'autopilot' | 'ask';

export interface CreateConversationArgs {
    /** First message of the new conversation. Required. */
    prompt: string;
    /** Target workspace/repo. Defaults to the caller's current workspace. */
    workspaceId?: string;
    /** Chat mode, restricted to `autopilot` | `ask`. Default `ask`. */
    mode?: CreateConversationMode;
    /** Display name for the new chat. Auto-generated from the prompt when omitted. */
    title?: string;
    /** Overrides the AI model. */
    model?: string;
    /** AI provider, validated against the supported chat providers. */
    provider?: ChatProvider;
    /** Queue priority. Default `normal`. */
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

export interface CreateConversationToolOptions {
    /** ProcessStore instance — used to validate the target workspace exists. */
    store: ProcessStore;
    /** The caller's current workspace ID; the default enqueue target. */
    workspaceId?: string;
    /** Bound in-process enqueue capability. */
    enqueueChat: EnqueueChatFn;
    /**
     * The parent chat's processId — the conversation in which this tool was
     * built/invoked. The handler reads the parent process record's resolved
     * `provider` / `model` / `reasoningEffort` from its `metadata` and inherits
     * them onto the spawned conversation (per-field overridable by the explicit
     * `provider` / `model` params; `reasoningEffort` is always inherited).
     * Mirrors the `search_conversations` addon's `processId` threading.
     */
    parentProcessId?: string;
}

export interface CreateConversationSuccess {
    /** New process id, derived as `queue_<taskId>`. */
    processId: string;
    /** Resolved display name (explicit `title` or an auto-generated one). */
    title: string;
    /** Always `queued` — the tool is fire-and-forget. */
    status: 'queued';
    /** SPA deep-link to the new conversation. */
    openLink: string;
}

export interface CreateConversationError {
    error: string;
}

export type CreateConversationResult = CreateConversationSuccess | CreateConversationError;

// ============================================================================
// Constants
// ============================================================================

/** Modes this tool may start — a strict subset of the queue's chat modes. */
const ALLOWED_MODES: ReadonlySet<string> = new Set<CreateConversationMode>(['autopilot', 'ask']);
const DEFAULT_MODE: CreateConversationMode = 'ask';

const ALLOWED_PRIORITIES: ReadonlySet<string> = new Set(['high', 'normal', 'low']);
const DEFAULT_PRIORITY = 'normal';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a `create_conversation` custom tool definition for the Copilot SDK.
 *
 * @param options Tool options (store + caller workspace + enqueue capability).
 */
export function createCreateConversationTool(options: CreateConversationToolOptions) {
    const { store, workspaceId: callerWorkspaceId, enqueueChat, parentProcessId } = options;

    const tool = defineTool<CreateConversationArgs>('create_conversation', {
        description:
            'Start a brand-new, separate chat conversation (fire-and-forget). ' +
            'Use this to delegate or spawn a distinct piece of work into its own conversation; ' +
            'it does NOT continue or follow up the current chat. ' +
            'The new chat appears in the dashboard chat list and is executed by the queue. ' +
            'Returns immediately with the new conversation\'s processId and an open link — it does ' +
            'not wait for the new chat to start or produce output. ' +
            'Only `prompt` is required; `workspaceId` defaults to the current workspace and `mode` defaults to `ask`.',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The first message of the new conversation. Required.',
                },
                workspaceId: {
                    type: 'string',
                    description:
                        'Target workspace/repo ID. Any registered workspace may be targeted. ' +
                        'Defaults to the current workspace when omitted.',
                },
                mode: {
                    type: 'string',
                    enum: ['autopilot', 'ask'],
                    description: 'Chat mode: `ask` (read-only, default) or `autopilot` (can edit/run).',
                },
                title: {
                    type: 'string',
                    description: 'Display name for the new chat. Auto-generated from the prompt when omitted.',
                },
                model: {
                    type: 'string',
                    description: 'Overrides the AI model for the new chat.',
                },
                provider: {
                    type: 'string',
                    enum: [...VALID_CHAT_PROVIDERS],
                    description: 'AI provider for the new chat (`copilot`, `codex`, or `claude`).',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Queue priority for the new chat. Default `normal`.',
                },
            },
            required: ['prompt'],
        },
        handler: async (args: CreateConversationArgs): Promise<CreateConversationResult> => {
            // --- prompt (required, non-empty) ---------------------------------
            if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
                return { error: 'Missing required field: prompt must be a non-empty string.' };
            }
            const prompt = args.prompt;

            // --- workspace (default to caller's; must be registered) ----------
            const requestedWorkspaceId =
                typeof args.workspaceId === 'string' && args.workspaceId.trim()
                    ? args.workspaceId.trim()
                    : callerWorkspaceId;
            if (!requestedWorkspaceId) {
                return {
                    error:
                        'No target workspace: provide `workspaceId` or invoke this tool from a workspace context.',
                };
            }
            const workspaces = await store.getWorkspaces();
            if (!workspaces.some(ws => ws.id === requestedWorkspaceId)) {
                return {
                    error: `Unknown workspaceId: '${requestedWorkspaceId}' is not a registered workspace.`,
                };
            }

            // --- mode (restricted to ask|autopilot) ---------------------------
            const mode = args.mode ?? DEFAULT_MODE;
            if (!ALLOWED_MODES.has(mode)) {
                return {
                    error:
                        `Invalid mode: '${String(args.mode)}'. ` +
                        `create_conversation only supports: ${[...ALLOWED_MODES].join(', ')}.`,
                };
            }

            // --- provider (validated against the supported chat providers) ----
            if (args.provider !== undefined && !VALID_CHAT_PROVIDERS.has(args.provider)) {
                return {
                    error:
                        `Invalid provider: '${String(args.provider)}'. ` +
                        `Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}.`,
                };
            }

            // --- model (pass-through; reject empty/non-string) ----------------
            if (args.model !== undefined && (typeof args.model !== 'string' || !args.model.trim())) {
                return { error: 'Invalid model: must be a non-empty string when provided.' };
            }
            const model = args.model?.trim();

            // --- priority (default normal) ------------------------------------
            const priority = args.priority ?? DEFAULT_PRIORITY;
            if (!ALLOWED_PRIORITIES.has(priority)) {
                return {
                    error:
                        `Invalid priority: '${String(args.priority)}'. ` +
                        `Valid priorities: ${[...ALLOWED_PRIORITIES].join(', ')}.`,
                };
            }

            // --- inherit provider/model/reasoningEffort from the parent chat --
            // The tool is built per chat turn, so `parentProcessId` identifies
            // the conversation in which this tool was invoked. Read the parent's
            // resolved values from its process metadata (the same authoritative
            // fields the follow-up executor reads — see follow-up-executor.ts).
            // Resolution is per-field: an explicit `provider`/`model` param wins
            // for that field only; everything else inherits from the parent.
            // `reasoningEffort` has no param and is always inherited.
            const parent = parentProcessId ? await store.getProcess(parentProcessId) : undefined;
            const parentProvider =
                typeof parent?.metadata?.provider === 'string' ? parent.metadata.provider : undefined;
            const parentModel =
                typeof parent?.metadata?.model === 'string' ? parent.metadata.model : undefined;
            const parentEffort =
                typeof parent?.metadata?.reasoningEffort === 'string' ? parent.metadata.reasoningEffort : undefined;

            // Per-field override: explicit param wins; otherwise inherit parent.
            const resolvedProvider = args.provider ?? parentProvider;
            const resolvedModel = model ?? parentModel;
            const resolvedEffort = parentEffort;

            // Only a missing provider is fatal. A resolvable parent whose model /
            // reasoningEffort are absent falls back to provider defaults below.
            if (!resolvedProvider) {
                return {
                    error:
                        'Cannot determine a provider for the new conversation: no parent chat ' +
                        'context was available to inherit from, and no explicit `provider` was supplied.',
                };
            }

            // --- build + validate the task spec, then enqueue in-process ------
            // Setting `payload.provider` makes the enqueue path treat the
            // provider as explicit, so the inherited provider also suppresses
            // global default-provider auto-routing. Resolved model goes onto
            // `config.model` (with the existing `payload.model` mirror) and the
            // inherited effort onto `config.reasoningEffort`; `config.effortTier`
            // is intentionally never set (resolved values are equivalent).
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
                    prompt,
                    workspaceId: requestedWorkspaceId,
                    provider: resolvedProvider,
                    ...(resolvedModel ? { model: resolvedModel } : {}),
                },
                ...(Object.keys(config).length > 0 ? { config } : {}),
            };

            // Reuse the canonical enqueue validation/normalization (config shape,
            // model resolution, display-name generation). Our up-front checks
            // above already reject the cases this path would silently coerce
            // (unknown workspace, ralph/plan mode).
            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid || !validation.input) {
                return { error: validation.error ?? 'Failed to build the new conversation task.' };
            }

            const taskId = await enqueueChat(validation.input);
            const processId = toQueueProcessId(taskId);

            return {
                processId,
                title: validation.input.displayName ?? title ?? '',
                status: 'queued',
                openLink: `#/process/${processId}`,
            };
        },
    });

    return { tool };
}
