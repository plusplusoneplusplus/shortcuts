/**
 * Work Item From-Chat Command
 *
 * Owns `POST /api/workspaces/:id/work-items/from-chat`: builds the Work Item
 * from a chat process, seeds plan version 1 (AI-extracted or the generated
 * template), persists it, and settles cache/broadcast across every workspace id
 * that shares the item's origin.
 */

import * as crypto from 'crypto';
import { badRequest, notFound } from '../errors';
import { buildPlanFromContext } from './plan-template';
import type { WorkItem } from './types';
import {
    clearWorkItemResponseCacheForWorkspaces,
    resolveWorkItemResponseCacheWorkspaceIds,
} from './work-item-response-cache';
import type { WorkItemExecutionCommandContext } from './work-item-execution-shared';

export interface CreateWorkItemFromChatCommandInput {
    /** Workspace the item is created in; also the persisted `repoId`. */
    repoId: string;
    processId: unknown;
    id?: string;
    title?: string;
    description?: string;
    priority?: WorkItem['priority'];
    tags?: string[];
    /** Use the chat's AI result as plan version 1 instead of the template. */
    extractPlan?: boolean;
}

/** First 500 characters of the originating prompt, else the stored preview. */
export function extractDescriptionFromProcess(process: { fullPrompt?: string; promptPreview?: string }): string {
    if (process.fullPrompt) {
        const full = process.fullPrompt;
        return full.length > 500 ? full.slice(0, 500) + '...' : full;
    }
    return process.promptPreview || '';
}

export async function createWorkItemFromChatCommand(
    ctx: WorkItemExecutionCommandContext,
    input: CreateWorkItemFromChatCommandInput,
): Promise<WorkItem> {
    if (!input.processId) {
        throw badRequest('Missing required field: processId');
    }

    // Look up the chat process to extract info
    const process = await ctx.processStore.getProcess(input.processId as string);
    if (!process) {
        throw notFound('Chat process');
    }

    const title = input.title || process.title || process.promptPreview || 'Work item from chat';
    const description = input.description || extractDescriptionFromProcess(process);

    const now = new Date().toISOString();
    const item: WorkItem = {
        id: input.id || crypto.randomUUID(),
        repoId: input.repoId,
        title,
        description,
        status: 'planning',
        createdAt: now,
        updatedAt: now,
        source: 'chat',
        sourceId: input.processId as string,
        priority: input.priority || 'normal',
        tags: input.tags,
    };

    // Use the AI result as plan when extractPlan is requested; otherwise
    // auto-generate a structured plan template populated with the work item's
    // title and description.
    const fromAi = input.extractPlan === true && !!process.result;
    item.plan = {
        version: 1,
        currentVersion: 1,
        content: fromAi ? process.result! : buildPlanFromContext(title, description),
        updatedAt: now,
        resolvedBy: fromAi ? 'ai' : 'user',
        source: fromAi ? 'ai' : 'user',
    };
    item.currentContentVersion = 1;

    await ctx.workItemStore.addWorkItem(item);

    // Persist the plan version record
    await ctx.workItemStore.savePlanVersion(item.id, {
        version: 1,
        content: item.plan.content,
        createdAt: now,
        resolvedBy: fromAi ? 'ai' : 'user',
        source: fromAi ? 'ai' : 'user',
        authorType: fromAi ? 'ai' : 'user',
        reason: fromAi ? 'Extracted from chat session' : 'Auto-generated plan template',
        summary: fromAi ? 'Extracted from chat session' : 'Auto-generated plan template',
    });

    const scopeIds = await resolveWorkItemResponseCacheWorkspaceIds(ctx.workItemStore, input.repoId);
    clearWorkItemResponseCacheForWorkspaces(scopeIds);
    for (const scopeId of scopeIds) {
        ctx.getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-added', workspaceId: scopeId, item });
    }
    return item;
}
