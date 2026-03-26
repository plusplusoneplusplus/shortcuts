/**
 * Progress Reporter for Map-Reduce Execution
 *
 * Thin wrapper around an optional progress callback.
 * Extracted from MapReduceExecutor to separate concerns.
 */

import type { JobProgress, ProgressCallback } from './types';

export class ProgressReporter {
    constructor(private callback?: ProgressCallback) {}

    report(progress: JobProgress): void {
        this.callback?.(progress);
    }
}
