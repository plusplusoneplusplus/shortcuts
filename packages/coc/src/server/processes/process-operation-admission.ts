/**
 * Serializes state-changing operations for one process while allowing unrelated
 * processes to proceed independently.
 */
export class ProcessOperationAdmission {
    private readonly tails = new Map<string, Promise<void>>();

    async runExclusive<T>(
        processId: string,
        operation: (contended: boolean) => Promise<T>,
    ): Promise<T> {
        const contended = this.tails.has(processId);
        const prior = this.tails.get(processId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        const tail = prior.then(() => current, () => current);
        this.tails.set(processId, tail);

        await prior.catch(() => {});
        try {
            return await operation(contended);
        } finally {
            release();
            if (this.tails.get(processId) === tail) {
                this.tails.delete(processId);
            }
        }
    }
}

export const processOperationAdmission = new ProcessOperationAdmission();

// Provider execution has a longer lifetime than mutation admission. Keeping the
// gates separate lets messages and cancellation be admitted during compaction.
const executionAdmissions = new WeakMap<object, ProcessOperationAdmission>();

export function conversationExecutionAdmission(owner: object): ProcessOperationAdmission {
    let admission = executionAdmissions.get(owner);
    if (!admission) {
        admission = new ProcessOperationAdmission();
        executionAdmissions.set(owner, admission);
    }
    return admission;
}
