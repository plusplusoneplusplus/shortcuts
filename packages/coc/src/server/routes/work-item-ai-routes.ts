/**
 * Work Item AI Authoring REST API Routes
 *
 * AI-assisted creation, improvement, and explicit draft application for work
 * items, goals, and child tasks. All operations are workspace-scoped. The
 * draft endpoints are review-before-save; the apply endpoint persists only when
 * the user explicitly invokes it against a fresh saved item snapshot.
 *
 * Routes (all gated behind the `workItems.aiAuthoring` feature flag):
 *   POST /api/workspaces/:id/work-items/ai-draft
 *     — Generate a draft for a new work item from a free-text prompt.
 *
 *   POST /api/workspaces/:id/work-items/:workItemId/ai-draft
 *     — Generate an improvement draft for an existing work item.
 *
 *   POST /api/workspaces/:id/work-items/:workItemId/ai-draft/apply
 *     — Generate and apply an AI draft to an existing local-only work-item,
 *       creating the next immutable plan/content version.
 *
 * Response shape:
 *   { kind: 'clarification', questions: string[], clarificationCount: number }
 *   { kind: 'draft', workItem: WorkItemDraftFields, goal?: string, childTasks?: ChildTaskDraft[] }
 *
 * Draft data is ephemeral unless the caller uses the explicit apply route.
 *
 * NOTE: LLM integration is injected via `generateNewItemDraft` / `generateImproveDraft`.
 * The routes return 503 when no generator is provided (pre-LLM-integration state).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { APIError, handleAPIError, badRequest, forbidden, internalError, notFound } from '../errors';
import type { WorkItem, WorkItemChange, WorkItemPlanVersion, WorkItemStore, WorkItemType } from '../work-items/types';
import { WORK_ITEM_TYPES, HIERARCHY_CONTAINER_TYPES } from '../work-items/types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';

// ============================================================================
// Public Types
// ============================================================================

/** Fields that a draft can carry for a work item (all optional — LLM may omit some). */
export interface WorkItemDraftFields {
    title?: string;
    description?: string;
    priority?: 'high' | 'normal' | 'low';
    tags?: string[];
    /** Markdown plan / goal content (maps to `plan.content` on the work item). */
    plan?: string;
    /** For `goal` type items: success criteria. */
    successCriteria?: string;
    /** Work item type suggested by the AI. */
    type?: WorkItemType;
}

/** A drafted child task (leaf work item) for a hierarchy breakdown. */
export interface ChildTaskDraft {
    title: string;
    description?: string;
    /** 'work-item' or 'bug' — child leaf types. */
    type?: 'work-item' | 'bug';
}

/** Response when the AI needs more information before generating a draft. */
export interface ClarificationResponse {
    kind: 'clarification';
    /** Up to 3 concise clarification questions. */
    questions: string[];
    /** Total number of clarification rounds completed so far (0-based). */
    clarificationCount: number;
}

/** Response when the AI has produced a complete draft. */
export interface DraftResponse {
    kind: 'draft';
    /** The generated work item fields. */
    workItem: WorkItemDraftFields;
    /** Optional goal/plan markdown stored as `plan.content`. */
    goal?: string;
    /** Optional child task breakdown (only populated when hierarchy is applicable). */
    childTasks?: ChildTaskDraft[];
}

export type AiDraftResponse = ClarificationResponse | DraftResponse;

// ============================================================================
// Request Bodies
// ============================================================================

/**
 * Body for POST /api/workspaces/:id/work-items/ai-draft
 */
export interface NewWorkItemAiDraftRequest {
    /** Free-text user prompt describing the feature / problem. Required. */
    prompt: string;
    /** Hint for the type to generate (defaults to 'work-item'). */
    type?: WorkItemType;
    /** Parent work item ID for hierarchy context. */
    parentId?: string;
    /**
     * Answers to previous clarification questions.
     * Pass to continue a clarification round (count 1-3).
     */
    clarificationAnswers?: string[];
    /** Number of clarification rounds already completed (0 = first request). */
    clarificationCount?: number;
}

/**
 * Body for POST /api/workspaces/:id/work-items/:workItemId/ai-draft
 */
export interface ImproveWorkItemAiDraftRequest {
    /** Instruction for what to improve / what to generate. Required. */
    prompt: string;
    /** Which aspects to draft ('fields', 'goal', 'childTasks'). Defaults to ['fields', 'goal']. */
    targets?: Array<'fields' | 'goal' | 'childTasks'>;
    /**
     * Answers to previous clarification questions.
     */
    clarificationAnswers?: string[];
    /** Number of clarification rounds already completed. */
    clarificationCount?: number;
}

/**
 * Body for POST /api/workspaces/:id/work-items/:workItemId/ai-draft/apply.
 *
 * The base fields are optimistic concurrency guards captured from the item
 * detail before the AI request starts. They are checked before and after the AI
 * call so generated content cannot silently overwrite newer saved edits.
 */
export interface ApplyWorkItemAiDraftRequest extends ImproveWorkItemAiDraftRequest {
    /** Work item updatedAt value the caller reviewed before starting AI drafting. */
    baseUpdatedAt: string;
    /** Optional current content version the caller reviewed. Use null for no current version. */
    baseContentVersion?: number | null;
    /** Optional summary stored on the immutable plan/content version. */
    summary?: string;
    /** Optional reason stored on the immutable plan/content version. */
    reason?: string;
}

export interface AppliedWorkItemAiDraftResponse {
    kind: 'applied';
    item: WorkItem;
    plan: WorkItemPlanVersion;
    version: number;
    previousVersion?: number;
}

export type ApplyWorkItemAiDraftResponse = ClarificationResponse | AppliedWorkItemAiDraftResponse;

// ============================================================================
// AI Generator Contracts (injected)
// ============================================================================

/** Context passed to the generator for a new work item draft. */
export interface NewItemDraftContext {
    workspaceId: string;
    prompt: string;
    type: WorkItemType;
    parentId?: string;
    clarificationAnswers?: string[];
    clarificationCount: number;
    hierarchyEnabled: boolean;
}

/** Context passed to the generator for an existing work item improvement draft. */
export interface ImproveItemDraftContext {
    workspaceId: string;
    workItemId: string;
    title: string;
    description: string;
    currentPlan?: string;
    type?: WorkItemType;
    prompt: string;
    targets: Array<'fields' | 'goal' | 'childTasks'>;
    clarificationAnswers?: string[];
    clarificationCount: number;
    hierarchyEnabled: boolean;
}

export type GenerateNewItemDraftFn = (ctx: NewItemDraftContext) => Promise<AiDraftResponse>;
export type GenerateImproveItemDraftFn = (ctx: ImproveItemDraftContext) => Promise<AiDraftResponse>;

// ============================================================================
// Route Context
// ============================================================================

export interface WorkItemAiRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    /** Returns true when the workItems.aiAuthoring feature flag is enabled. */
    getAiAuthoringEnabled: () => boolean;
    /** Returns true when the durable Work Items/Goals workflow flag is enabled. */
    getWorkflowEnabled?: () => boolean;
    /** Returns true when the workItems.hierarchy feature flag is enabled. */
    getHierarchyEnabled?: () => boolean;
    getWsServer?: () => ProcessWebSocketServer;
    /** AI generator for new work item drafts (injected; absent until LLM integration). */
    generateNewItemDraft?: GenerateNewItemDraftFn;
    /** AI generator for improving existing work item drafts (injected; absent until LLM integration). */
    generateImproveItemDraft?: GenerateImproveItemDraftFn;
}

// ============================================================================
// Helpers
// ============================================================================

/** Max allowed clarification rounds (enforced both client-side and server-side). */
export const MAX_CLARIFICATION_ROUNDS = 3;

const VALID_TARGETS = new Set<string>(['fields', 'goal', 'childTasks']);
const VALID_PRIORITIES = new Set<string>(['high', 'normal', 'low']);
const ALL_VALID_TYPES = new Set<string>(WORK_ITEM_TYPES);
const WORKFLOW_AI_APPLY_TYPES = new Set<WorkItemType>(['work-item']);

type AiDraftTarget = 'fields' | 'goal' | 'childTasks';

interface ApplyBaseSnapshot {
    baseUpdatedAt: string;
    checkContentVersion: boolean;
    baseContentVersion: number | null;
}

function parseTargets(
    value: unknown,
    options: { requireGoal?: boolean; disallowChildTasks?: boolean } = {},
): AiDraftTarget[] {
    const rawTargets = Array.isArray(value) ? value : ['fields', 'goal'];
    const invalidTargets = rawTargets.filter(t => typeof t !== 'string' || !VALID_TARGETS.has(t));
    if (invalidTargets.length > 0) {
        throw badRequest(`Invalid targets: ${invalidTargets.join(', ')}. Valid: fields, goal, childTasks`);
    }
    const targets = rawTargets as AiDraftTarget[];
    if (options.requireGoal && !targets.includes('goal')) {
        throw badRequest('AI draft apply requires the goal target so a new immutable plan/content version can be saved');
    }
    if (options.disallowChildTasks && targets.includes('childTasks')) {
        throw badRequest('AI draft apply supports fields and goal targets only');
    }
    return targets;
}

function currentContentVersion(item: WorkItem): number | null {
    return item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version ?? null;
}

function parseApplyBaseSnapshot(body: ApplyWorkItemAiDraftRequest): ApplyBaseSnapshot {
    if (typeof body.baseUpdatedAt !== 'string' || !body.baseUpdatedAt.trim()) {
        throw badRequest('baseUpdatedAt is required');
    }

    const checkContentVersion = Object.prototype.hasOwnProperty.call(body, 'baseContentVersion');
    let baseContentVersion: number | null = null;
    if (checkContentVersion) {
        if (body.baseContentVersion !== null && body.baseContentVersion !== undefined) {
            if (!Number.isInteger(body.baseContentVersion) || body.baseContentVersion <= 0) {
                throw badRequest('baseContentVersion must be a positive integer or null');
            }
            baseContentVersion = body.baseContentVersion;
        }
    }

    return {
        baseUpdatedAt: body.baseUpdatedAt.trim(),
        checkContentVersion,
        baseContentVersion,
    };
}

function assertFreshApplyBase(item: WorkItem, base: ApplyBaseSnapshot): void {
    const itemContentVersion = currentContentVersion(item);
    const contentVersionChanged = base.checkContentVersion && itemContentVersion !== base.baseContentVersion;
    if (item.updatedAt === base.baseUpdatedAt && !contentVersionChanged) return;

    throw new APIError(
        409,
        'Work item changed after AI drafting started; reload before applying the draft.',
        'WORK_ITEM_AI_DRAFT_STALE',
        {
            workItemId: item.id,
            expectedUpdatedAt: base.baseUpdatedAt,
            currentUpdatedAt: item.updatedAt,
            expectedContentVersion: base.checkContentVersion ? base.baseContentVersion : undefined,
            currentContentVersion: itemContentVersion,
        },
    );
}

function isLocalOnlyWorkflowAiApplyItem(item: WorkItem): boolean {
    const effectiveType = item.type ?? 'work-item';
    if (!WORKFLOW_AI_APPLY_TYPES.has(effectiveType)) return false;
    if (item.tracker && item.tracker.kind !== 'local-only') return false;
    return !item.githubMirror && !item.azureBoardsMirror;
}

function extractPlanContent(result: DraftResponse): string | undefined {
    const content = result.goal ?? result.workItem.plan;
    return typeof content === 'string' && content.trim() ? content : undefined;
}

function optionalTrimmedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerWorkItemAiRoutes(ctx: WorkItemAiRouteContext): void {
    const { routes, workItemStore } = ctx;
    const isAiAuthoringEnabled = () => ctx.getAiAuthoringEnabled();
    const isWorkflowEnabled = () => ctx.getWorkflowEnabled?.() ?? false;
    const isHierarchyEnabled = () => ctx.getHierarchyEnabled?.() ?? false;

    // POST /api/workspaces/:id/work-items/ai-draft — generate draft for a new work item
    // NOTE: this pattern must be registered BEFORE /:workItemId routes to avoid matching "ai-draft" as an ID
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/ai-draft$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            if (!isAiAuthoringEnabled()) {
                return handleAPIError(res, forbidden('workItems.aiAuthoring feature flag is not enabled'));
            }

            const workspaceId = decodeURIComponent(match![1]);

            let body: NewWorkItemAiDraftRequest;
            try {
                body = await parseBody(req) as NewWorkItemAiDraftRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
                return handleAPIError(res, badRequest('prompt is required'));
            }

            const requestedType = body.type;
            if (requestedType && !ALL_VALID_TYPES.has(requestedType)) {
                return handleAPIError(res, badRequest(`Invalid work item type: ${requestedType}`));
            }

            if (requestedType && HIERARCHY_CONTAINER_TYPES.has(requestedType as WorkItemType) && !isHierarchyEnabled()) {
                return handleAPIError(
                    res,
                    badRequest(`Type '${requestedType}' requires the workItems.hierarchy feature flag to be enabled`),
                );
            }

            const clarificationCount = typeof body.clarificationCount === 'number'
                ? Math.max(0, Math.floor(body.clarificationCount))
                : 0;

            if (clarificationCount >= MAX_CLARIFICATION_ROUNDS) {
                // Force draft generation — no more clarification allowed
            }

            if (!ctx.generateNewItemDraft) {
                return handleAPIError(res, internalError('AI authoring generator is not available'));
            }

            try {
                const result = await ctx.generateNewItemDraft({
                    workspaceId,
                    prompt: body.prompt.trim(),
                    type: (requestedType as WorkItemType) ?? 'work-item',
                    parentId: typeof body.parentId === 'string' ? body.parentId : undefined,
                    clarificationAnswers: Array.isArray(body.clarificationAnswers) ? body.clarificationAnswers : undefined,
                    clarificationCount,
                    hierarchyEnabled: isHierarchyEnabled(),
                });

                // Enforce clarification round limit
                if (result.kind === 'clarification') {
                    if (clarificationCount >= MAX_CLARIFICATION_ROUNDS - 1) {
                        // Should not happen if generator respects the limit, but enforce defensively
                        return handleAPIError(res, internalError('Clarification limit exceeded; generator must return a draft'));
                    }
                    return sendJSON(res, 200, result);
                }

                sendJSON(res, 200, result);
            } catch (err) {
                return handleAPIError(res, err instanceof Error ? err : internalError('Failed to generate draft'));
            }
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/ai-draft — generate improvement draft for existing work item
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/ai-draft$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            if (!isAiAuthoringEnabled()) {
                return handleAPIError(res, forbidden('workItems.aiAuthoring feature flag is not enabled'));
            }

            const workspaceId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, workspaceId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            let body: ImproveWorkItemAiDraftRequest;
            try {
                body = await parseBody(req) as ImproveWorkItemAiDraftRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
                return handleAPIError(res, badRequest('prompt is required'));
            }

            let targets: AiDraftTarget[];
            try {
                targets = parseTargets(body.targets);
            } catch (err) {
                return handleAPIError(res, err);
            }

            const clarificationCount = typeof body.clarificationCount === 'number'
                ? Math.max(0, Math.floor(body.clarificationCount))
                : 0;

            if (!ctx.generateImproveItemDraft) {
                return handleAPIError(res, internalError('AI authoring generator is not available'));
            }

            try {
                const result = await ctx.generateImproveItemDraft({
                    workspaceId,
                    workItemId,
                    title: item.title,
                    description: item.description,
                    currentPlan: item.plan?.content,
                    type: item.type,
                    prompt: body.prompt.trim(),
                    targets,
                    clarificationAnswers: Array.isArray(body.clarificationAnswers) ? body.clarificationAnswers : undefined,
                    clarificationCount,
                    hierarchyEnabled: isHierarchyEnabled(),
                });

                // Enforce clarification round limit
                if (result.kind === 'clarification') {
                    if (clarificationCount >= MAX_CLARIFICATION_ROUNDS - 1) {
                        return handleAPIError(res, internalError('Clarification limit exceeded; generator must return a draft'));
                    }
                    return sendJSON(res, 200, result);
                }

                sendJSON(res, 200, result);
            } catch (err) {
                return handleAPIError(res, err instanceof Error ? err : internalError('Failed to generate improvement draft'));
            }
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/ai-draft/apply — generate and persist AI draft to a saved local work-item
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/ai-draft\/apply$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            if (!isAiAuthoringEnabled()) {
                return handleAPIError(res, forbidden('workItems.aiAuthoring feature flag is not enabled'));
            }
            if (!isWorkflowEnabled()) {
                return handleAPIError(res, forbidden('workItems.workflow feature flag is not enabled'));
            }

            const workspaceId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: ApplyWorkItemAiDraftRequest;
            try {
                body = await parseBody(req) as ApplyWorkItemAiDraftRequest;
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
                return handleAPIError(res, badRequest('prompt is required'));
            }

            let targets: AiDraftTarget[];
            let baseSnapshot: ApplyBaseSnapshot;
            try {
                targets = parseTargets(body.targets, { requireGoal: true, disallowChildTasks: true });
                baseSnapshot = parseApplyBaseSnapshot(body);
            } catch (err) {
                return handleAPIError(res, err);
            }

            if (!ctx.generateImproveItemDraft) {
                return handleAPIError(res, internalError('AI authoring generator is not available'));
            }

            try {
                const item = await workItemStore.getWorkItem(workItemId, workspaceId);
                if (!item) {
                    return handleAPIError(res, notFound('Work item'));
                }
                if (!isLocalOnlyWorkflowAiApplyItem(item)) {
                    return handleAPIError(res, badRequest('AI draft apply is only available for local-only work-item items'));
                }
                assertFreshApplyBase(item, baseSnapshot);

                const clarificationCount = typeof body.clarificationCount === 'number'
                    ? Math.max(0, Math.floor(body.clarificationCount))
                    : 0;

                const result = await ctx.generateImproveItemDraft({
                    workspaceId,
                    workItemId,
                    title: item.title,
                    description: item.description,
                    currentPlan: item.plan?.content,
                    type: item.type,
                    prompt: body.prompt.trim(),
                    targets,
                    clarificationAnswers: Array.isArray(body.clarificationAnswers) ? body.clarificationAnswers : undefined,
                    clarificationCount,
                    hierarchyEnabled: isHierarchyEnabled(),
                });

                if (result.kind === 'clarification') {
                    if (clarificationCount >= MAX_CLARIFICATION_ROUNDS - 1) {
                        return handleAPIError(res, internalError('Clarification limit exceeded; generator must return a draft'));
                    }
                    return sendJSON(res, 200, result);
                }

                const planContent = extractPlanContent(result);
                if (!planContent) {
                    return handleAPIError(res, internalError('AI draft did not include plan content to apply'));
                }

                const latestItem = await workItemStore.getWorkItem(workItemId, workspaceId);
                if (!latestItem) {
                    return handleAPIError(res, notFound('Work item'));
                }
                assertFreshApplyBase(latestItem, baseSnapshot);

                const versions = await workItemStore.getPlanVersions(workItemId);
                const previousVersion = latestItem.plan?.version;
                const latestVersion = Math.max(previousVersion ?? 0, ...versions.map(version => version.version));
                const newVersion = latestVersion + 1;
                const now = new Date().toISOString();
                const summary = optionalTrimmedString(body.summary)
                    ?? (previousVersion ? 'AI revised implementation plan' : 'AI drafted implementation plan');
                const reason = optionalTrimmedString(body.reason)
                    ?? (previousVersion ? 'AI revision' : 'AI initial draft');
                const planVersion: WorkItemPlanVersion = {
                    version: newVersion,
                    content: planContent,
                    createdAt: now,
                    resolvedBy: 'ai',
                    source: 'ai',
                    authorType: 'ai',
                    reason,
                    summary,
                };

                await workItemStore.savePlanVersion(workItemId, planVersion);

                const includeFields = targets.includes('fields');
                const updates: Partial<Omit<WorkItem, 'id' | 'repoId' | 'createdAt'>> = {
                    currentContentVersion: newVersion,
                    plan: {
                        version: newVersion,
                        currentVersion: newVersion,
                        content: planContent,
                        updatedAt: now,
                        resolvedBy: 'ai',
                        source: 'ai',
                        reason,
                    },
                };
                if (includeFields && typeof result.workItem.description === 'string') {
                    updates.description = result.workItem.description;
                }
                if (includeFields && result.workItem.priority && VALID_PRIORITIES.has(result.workItem.priority)) {
                    updates.priority = result.workItem.priority;
                }
                if (includeFields && Array.isArray(result.workItem.tags)) {
                    updates.tags = result.workItem.tags.filter(tag => typeof tag === 'string');
                }
                if (latestItem.status === 'created' || latestItem.status === 'drafting') {
                    updates.status = 'planning';
                }

                const updated = await workItemStore.updateWorkItem(workItemId, updates);
                if (!updated) {
                    return handleAPIError(res, notFound('Work item'));
                }

                const change: WorkItemChange = {
                    id: crypto.randomUUID(),
                    planVersion: newVersion,
                    commits: [],
                    startedAt: now,
                    status: 'open',
                };
                workItemStore.addChange(workItemId, change).catch(() => { /* non-fatal */ });

                clearWorkItemResponseCacheForWorkspace(workspaceId);
                ctx.getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId, item: updated });
                sendJSON(res, 200, {
                    kind: 'applied',
                    item: updated,
                    plan: planVersion,
                    version: newVersion,
                    ...(previousVersion ? { previousVersion } : {}),
                } satisfies AppliedWorkItemAiDraftResponse);
            } catch (err) {
                return handleAPIError(res, err instanceof APIError
                    ? err
                    : err instanceof Error
                        ? internalError(err.message)
                        : internalError('Failed to apply AI draft'));
            }
        },
    });
}
