/**
 * Owns `POST .../work-items/:wid/ai-review`: eligibility checks, review prompt
 * construction, the queued review payload, and the persisted execution-history
 * entry. Queue `config` and history `aiSettings` are both derived from the one
 * parsed {@link WorkItemAiSettings} value so the recorded metadata can never
 * disagree with what the queue actually ran.
 */

import { badRequest } from '../errors';
import type { WorkItem, WorkItemChange } from './types';
import {
    aiSettingsExecutionMetadata,
    aiSettingsTaskConfig,
    type WorkItemAiSettings,
} from './work-item-execution-settings';
import {
    isLocalOnlyWorkflowLeaf,
    requireEnqueue,
    requireWorkItem,
    settleWorkItemUpdate,
    type WorkItemCommandScope,
    type WorkItemExecutionCommandContext,
} from './work-item-execution-shared';

type WorkItemExecutionEntry = NonNullable<WorkItem['executionHistory']>[number];

export interface StartWorkItemAiReviewCommandInput extends WorkItemCommandScope {
    settings: WorkItemAiSettings;
}

export interface StartWorkItemAiReviewCommandResult {
    taskId: string;
    workItem: WorkItem | undefined;
}

/** Newest completed implementation run (resolve/review runs excluded). */
export function findLatestImplementationExecution(
    item: WorkItem,
): { execution: WorkItemExecutionEntry; index: number } | undefined {
    return item.executionHistory
        ?.map((execution, index) => ({ execution, index }))
        .filter(({ execution }) => execution.status === 'completed'
            && execution.sessionCategory !== 'resolve-plan-comments'
            && execution.sessionCategory !== 'resolve-commit-comments'
            && execution.sessionCategory !== 'work-item-ai-review')
        .at(-1);
}

export function buildWorkItemReviewPrompt(
    item: WorkItem,
    change: WorkItemChange | undefined,
    execution: WorkItemExecutionEntry | undefined,
): string {
    const effectiveType = item.type ?? 'work-item';
    const lines = [
        `# Work Item AI Review: ${item.title}`,
        '',
        'Review the implementation produced for this local Work Item workflow run. Do not modify files, create commits, or submit pull requests. Focus only on correctness, regressions, security, acceptance-criteria alignment, and important maintainability risks.',
        '',
        '## Work Item',
        `- ID: ${item.id}`,
        ...(item.workItemNumber != null ? [`- Number: ${item.workItemNumber}`] : []),
        `- Type: ${effectiveType}`,
        `- Status: ${item.status}`,
        ...(item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version ? [`- Content version: v${item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version}`] : []),
        '',
    ];

    if (item.description?.trim()) {
        lines.push('## Description', item.description.trim(), '');
    }
    if (item.plan?.content?.trim()) {
        lines.push('## Current Version Content', item.plan.content.trim(), '');
    }
    if (execution) {
        lines.push(
            '## Execution Under Review',
            `- Task: ${execution.taskId}`,
            ...(execution.processId ? [`- Process: ${execution.processId}`] : []),
            ...(execution.planVersion !== undefined ? [`- Version executed: v${execution.planVersion}`] : []),
            ...(execution.executionMode ? [`- Execution mode: ${execution.executionMode}`] : []),
            ...(execution.ralphSessionId ? [`- Ralph session: ${execution.ralphSessionId}`] : []),
            '',
        );
    }
    if (change) {
        lines.push('## Commits To Review');
        if (change.commits.length > 0) {
            for (const commit of change.commits) {
                lines.push(`- ${commit.sha} ${commit.message}`);
            }
        } else {
            lines.push('- No commits were recorded for this execution.');
        }
        lines.push('');
    }
    lines.push(
        '## Output Format',
        'Return Markdown with:',
        '- `## Review Summary`',
        '- `## Findings` with only actionable issues; include severity, file path, and line when possible',
        '- `## Verdict` as either `Approve` or `Request changes`',
    );
    return lines.join('\n');
}

export async function startWorkItemAiReviewCommand(
    ctx: WorkItemExecutionCommandContext,
    input: StartWorkItemAiReviewCommandInput,
): Promise<StartWorkItemAiReviewCommandResult> {
    const enqueue = requireEnqueue(ctx);
    const item = await requireWorkItem(ctx, input);

    if (!isLocalOnlyWorkflowLeaf(item)) {
        throw badRequest('AI review is only available for local-only Work Items and Goals');
    }
    if (item.status !== 'aiDone') {
        throw badRequest(`Cannot start AI review in status '${item.status}'. Work item must be in Review.`);
    }
    const runningReview = item.executionHistory?.find(execution =>
        execution.sessionCategory === 'work-item-ai-review' && execution.status === 'running');
    if (runningReview) {
        throw badRequest('An AI review is already running for this work item');
    }

    const { settings } = input;
    const latestImplementation = findLatestImplementationExecution(item);
    const change = latestImplementation
        ? item.changes?.find(candidate => candidate.taskId === latestImplementation.execution.taskId)
        : undefined;
    const prompt = buildWorkItemReviewPrompt(item, change, latestImplementation?.execution);
    const runNumber = (item.executionHistory?.length ?? 0) + 1;
    const selectedVersion = item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version;
    const aiSettings = aiSettingsExecutionMetadata(settings);

    const taskId = await enqueue({
        type: 'run-workflow',
        repoId: input.commandRepoId,
        priority: item.priority ?? 'normal',
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt,
            workspaceId: input.commandRepoId,
            workItemStorageRepoId: input.storageRepoId,
            workItemId: item.id,
            sessionCategory: 'work-item-ai-review',
            ...(selectedVersion ? { planVersion: selectedVersion } : {}),
            ...(settings.provider ? { provider: settings.provider } : {}),
            ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
            context: {
                skills: ['code-review'],
                workItemReview: {
                    workspaceId: input.commandRepoId,
                    originId: input.storageRepoId,
                    workItemId: item.id,
                    ...(latestImplementation ? { executionTaskId: latestImplementation.execution.taskId, executionRunIndex: latestImplementation.index + 1 } : {}),
                    ...(change ? { changeId: change.id, commits: change.commits.map(commit => commit.sha) } : {}),
                },
                ...(settings.autoProviderRouting ? { autoProviderRouting: { requested: true } } : {}),
            },
        },
        config: aiSettingsTaskConfig(settings),
        displayName: `Run #${runNumber}: AI Review`,
    });

    const startedAt = new Date().toISOString();
    await ctx.workItemStore.addExecution(input.workItemId, {
        taskId,
        startedAt,
        status: 'running',
        sessionCategory: 'work-item-ai-review',
        title: 'AI Review',
        kind: 'ai-review',
        ...(selectedVersion ? { planVersion: selectedVersion } : {}),
        ...(aiSettings ? { aiSettings } : {}),
        skillNames: ['code-review'],
        ...(change ? { reviewedChangeId: change.id } : {}),
        ...(latestImplementation ? { reviewedTaskId: latestImplementation.execution.taskId } : {}),
    }, input.storageRepoId);

    const workItem = await settleWorkItemUpdate(ctx, input);
    return { taskId, workItem };
}
