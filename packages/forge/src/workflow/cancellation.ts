import { CancellationError as RuntimeCancellationError, isCancellationError } from '../runtime/cancellation';

export class WorkflowCancellationError extends RuntimeCancellationError {
    constructor() {
        super('Workflow execution was cancelled');
    }
}

export function isWorkflowCancelled(signal?: AbortSignal): boolean {
    return signal?.aborted ?? false;
}

export function throwIfWorkflowCancelled(signal?: AbortSignal): void {
    if (isWorkflowCancelled(signal)) {
        throw new WorkflowCancellationError();
    }
}

export function isWorkflowCancellationError(error: unknown): boolean {
    return isCancellationError(error);
}
