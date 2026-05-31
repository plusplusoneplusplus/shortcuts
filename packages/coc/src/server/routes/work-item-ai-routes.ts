/**
 * Work Item AI Authoring REST API Routes
 *
 * AI-assisted creation and improvement of work items, goals, and child tasks.
 * All operations are workspace-scoped and require explicit user approval before
 * any data is persisted (review-before-save).
 *
 * Routes (all gated behind the `workItems.aiAuthoring` feature flag):
 *   POST /api/workspaces/:id/work-items/ai-draft
 *     — Generate a draft for a new work item from a free-text prompt.
 *
 *   POST /api/workspaces/:id/work-items/:workItemId/ai-draft
 *     — Generate an improvement draft for an existing work item.
 *
 * Response shape:
 *   { kind: 'clarification', questions: string[], clarificationCount: number }
 *   { kind: 'draft', workItem: WorkItemDraftFields, goal?: string, childTasks?: ChildTaskDraft[] }
 *
 * Draft data is ephemeral — nothing is persisted until the caller explicitly
 * applies it via the standard create/update/plan endpoints.
 *
 * NOTE: LLM integration is injected via `generateNewItemDraft` / `generateImproveDraft`.
 * The routes return 503 when no generator is provided (pre-LLM-integration state).
 */

import * as http from 'http';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, badRequest, forbidden, internalError, notFound } from '../errors';
import type { WorkItemStore, WorkItemType } from '../work-items/types';
import { WORK_ITEM_TYPES, HIERARCHY_CONTAINER_TYPES } from '../work-items/types';

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
    /** Returns true when the workItems.hierarchy feature flag is enabled. */
    getHierarchyEnabled?: () => boolean;
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

// ============================================================================
// Route Registration
// ============================================================================

export function registerWorkItemAiRoutes(ctx: WorkItemAiRouteContext): void {
    const { routes, workItemStore } = ctx;
    const isAiAuthoringEnabled = () => ctx.getAiAuthoringEnabled();
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

            // Validate targets
            const rawTargets = Array.isArray(body.targets) ? body.targets : ['fields', 'goal'];
            const invalidTargets = rawTargets.filter(t => !VALID_TARGETS.has(t));
            if (invalidTargets.length > 0) {
                return handleAPIError(res, badRequest(`Invalid targets: ${invalidTargets.join(', ')}. Valid: fields, goal, childTasks`));
            }
            const targets = rawTargets as Array<'fields' | 'goal' | 'childTasks'>;

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
}
