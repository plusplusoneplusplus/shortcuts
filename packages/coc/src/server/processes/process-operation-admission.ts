/**
 * Serializes state-changing operations for one process while allowing unrelated
 * processes to proceed independently.
 */
export class ProcessOperationAdmission {
    private readonly tails = new Map<string, Promise<void>>();

    async runExclusive<T>(processId: string, operation: () => Promise<T>): Promise<T> {
        const prior = this.tails.get(processId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        const tail = prior.then(() => current, () => current);
        this.tails.set(processId, tail);

        await prior.catch(() => {});
        try {
            return await operation();
        } finally {
            release();
            if (this.tails.get(processId) === tail) {
                this.tails.delete(processId);
            }
        }
    }
}

export const processOperationAdmission = new ProcessOperationAdmission();
