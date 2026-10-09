import type { DelegatedJob } from '../delegation/delegated-job-store';
import type { DelegatedReviewTodo } from '../delegation/delegated-job-reviews';
import type { SentinelTodoService } from './sentinel-todo-service';

/**
 * Flag-gated bridges from delegation receipts to the to-do ledger. Both are
 * bookkeeping only: a failure is logged and never blocks result delivery,
 * retries, or reviews, and neither ever launches or cancels a job.
 */
export function createSentinelTodoDelegationHooks(
    service: Pick<SentinelTodoService, 'recordJobResult' | 'findLinkedItem'>,
    isEnabled: () => boolean,
) {
    return {
        /** Record a terminal result on its linked item before the review is admitted. */
        recordResult(job: DelegatedJob): void {
            if (!isEnabled()) return;
            try { service.recordJobResult(job); }
            catch (error) { console.error('[sentinel-todos] Could not record a job outcome:', error); }
        },
        /** The linked item quoted in the parent review prompt. */
        findTodo(job: DelegatedJob): DelegatedReviewTodo | undefined {
            const item = isEnabled() ? service.findLinkedItem(job) : undefined;
            return item && {
                id: item.id, revision: item.revision, title: item.title,
                completionCondition: item.completionCondition, status: item.status,
            };
        },
    };
}
