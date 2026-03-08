/**
 * Unit tests for the AI Processes view badge and description computation.
 *
 * The badge is shown on the activity-bar icon even when the sidebar is
 * collapsed, providing a near real-time count of active (running + queued)
 * AI processes.
 */

import * as assert from 'assert';
import { computeProcessViewStatus } from '../../shortcuts/ai-service';

suite('AI Process View Badge Tests', () => {

    suite('computeProcessViewStatus', () => {

        test('should return no description and no badge when all counts are zero', () => {
            const status = computeProcessViewStatus({ running: 0, queued: 0, completed: 0, failed: 0 });
            assert.strictEqual(status.description, undefined);
            assert.strictEqual(status.badge, undefined);
        });

        test('should show running count in description and badge', () => {
            const status = computeProcessViewStatus({ running: 3, queued: 0, completed: 0, failed: 0 });
            assert.strictEqual(status.description, '3 running');
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 3);
            assert.ok(status.badge.tooltip.includes('3'));
        });

        test('should show queued count in badge but not in description', () => {
            const status = computeProcessViewStatus({ running: 0, queued: 2, completed: 0, failed: 0 });
            assert.strictEqual(status.description, undefined);
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 2);
            assert.ok(status.badge.tooltip.includes('2'));
        });

        test('should sum running and queued in badge', () => {
            const status = computeProcessViewStatus({ running: 2, queued: 3, completed: 0, failed: 0 });
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 5);
            assert.ok(status.badge.tooltip.includes('5'));
        });

        test('should show completed count in description', () => {
            const status = computeProcessViewStatus({ running: 0, queued: 0, completed: 5, failed: 0 });
            assert.strictEqual(status.description, '5 done');
            assert.strictEqual(status.badge, undefined);
        });

        test('should show failed count in description', () => {
            const status = computeProcessViewStatus({ running: 0, queued: 0, completed: 0, failed: 2 });
            assert.strictEqual(status.description, '2 failed');
            assert.strictEqual(status.badge, undefined);
        });

        test('should combine running, done, and failed in description', () => {
            const status = computeProcessViewStatus({ running: 1, queued: 0, completed: 3, failed: 2 });
            assert.strictEqual(status.description, '1 running, 3 done, 2 failed');
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 1);
        });

        test('should use singular tooltip for exactly 1 active process', () => {
            const status = computeProcessViewStatus({ running: 1, queued: 0, completed: 0, failed: 0 });
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 1);
            assert.strictEqual(status.badge.tooltip, '1 active AI process');
        });

        test('should use plural tooltip for multiple active processes', () => {
            const status = computeProcessViewStatus({ running: 2, queued: 1, completed: 0, failed: 0 });
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 3);
            assert.strictEqual(status.badge.tooltip, '3 active AI processes');
        });

        test('should clear badge when all active processes finish', () => {
            // Simulates the transition: processes were running, now all completed
            const status = computeProcessViewStatus({ running: 0, queued: 0, completed: 4, failed: 1 });
            assert.strictEqual(status.badge, undefined);
            assert.strictEqual(status.description, '4 done, 1 failed');
        });

        test('should handle mixed counts correctly', () => {
            const status = computeProcessViewStatus({ running: 2, queued: 1, completed: 10, failed: 3 });
            assert.strictEqual(status.description, '2 running, 10 done, 3 failed');
            assert.ok(status.badge);
            assert.strictEqual(status.badge.value, 3);
            assert.strictEqual(status.badge.tooltip, '3 active AI processes');
        });
    });
});
