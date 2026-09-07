/**
 * "Approve for this session" memory for the dangerous-command guard.
 *
 * Scope is the chat process, not the turn and not the executor. A chat's first
 * turn runs in `ChatExecutor` and its follow-ups in `FollowUpExecutor`, each
 * with its own `ProcessSessionRegistry` — and that registry is torn down at the
 * end of every turn anyway. A session approval has to outlive both, so it lives
 * in one module-level store keyed by process id.
 *
 * The store holds rule ids only: approving `pipe-to-shell` once for the session
 * approves that *rule*, not a command string, which is what AC-05 asks for.
 */

/** How many processes to remember before evicting the oldest. */
const MAX_TRACKED_PROCESSES = 200;

export class DangerousCommandSessionApprovals {
    /** Insertion-ordered, which is what makes the eviction below oldest-first. */
    private readonly byProcess = new Map<string, Set<string>>();

    /** Whether this process already approved `ruleId` for the session. */
    has(processId: string, ruleId: string): boolean {
        return this.byProcess.get(processId)?.has(ruleId) === true;
    }

    /** Remember a session approval. Later matches of `ruleId` skip the prompt. */
    add(processId: string, ruleId: string): void {
        let approved = this.byProcess.get(processId);
        if (!approved) {
            approved = new Set<string>();
            this.byProcess.set(processId, approved);
            this.evictOldest();
        }
        approved.add(ruleId);
    }

    /** Drop a process's approvals. Called when its chat is deleted. */
    clear(processId: string): void {
        this.byProcess.delete(processId);
    }

    /** Rule ids approved for the session, for the audit trail and tests. */
    list(processId: string): string[] {
        return [...(this.byProcess.get(processId) ?? [])];
    }

    private evictOldest(): void {
        while (this.byProcess.size > MAX_TRACKED_PROCESSES) {
            const oldest = this.byProcess.keys().next();
            if (oldest.done) return;
            this.byProcess.delete(oldest.value);
        }
    }
}

/**
 * The process-wide store. A singleton because the two executors that run a
 * chat's turns are separate instances and must agree on what the user already
 * approved.
 */
export const dangerousCommandSessionApprovals = new DangerousCommandSessionApprovals();
