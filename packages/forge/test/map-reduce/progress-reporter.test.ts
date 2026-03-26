import { describe, it, expect, vi } from 'vitest';
import { ProgressReporter } from '../../src/map-reduce/progress-reporter';
import type { JobProgress } from '../../src/map-reduce/types';

describe('ProgressReporter', () => {
    it('calls the callback with the progress object', () => {
        const cb = vi.fn();
        const reporter = new ProgressReporter(cb);
        const progress: JobProgress = {
            phase: 'mapping', totalItems: 10, completedItems: 3,
            failedItems: 0, percentage: 30, message: 'Processing...'
        };
        reporter.report(progress);
        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith(progress);
    });

    it('does nothing when no callback is provided', () => {
        const reporter = new ProgressReporter();
        // Should not throw
        reporter.report({
            phase: 'complete', totalItems: 1, completedItems: 1,
            failedItems: 0, percentage: 100, message: 'Done'
        });
    });

    it('does nothing when callback is undefined', () => {
        const reporter = new ProgressReporter(undefined);
        reporter.report({
            phase: 'splitting', totalItems: 0, completedItems: 0,
            failedItems: 0, percentage: 0, message: 'Splitting...'
        });
    });
});
