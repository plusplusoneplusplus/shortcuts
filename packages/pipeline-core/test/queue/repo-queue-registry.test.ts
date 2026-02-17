/**
 * RepoQueueRegistry Tests
 *
 * Comprehensive tests for per-repository queue management.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { RepoQueueRegistry } from '../../src/queue/repo-queue-registry';
import { TaskQueueManager } from '../../src/queue/task-queue-manager';

describe('RepoQueueRegistry', () => {
    let registry: RepoQueueRegistry;

    beforeEach(() => {
        registry = new RepoQueueRegistry();
    });

    // ====================================================================
    // Constructor
    // ====================================================================

    describe('constructor', () => {
        it('should create an empty registry', () => {
            expect(registry.getAllRepos()).toHaveLength(0);
        });

        it('should accept default queue options', () => {
            const reg = new RepoQueueRegistry({ maxQueueSize: 5 });
            const queue = reg.getQueueForRepo('/tmp/repo');
            // Enqueue up to limit
            for (let i = 0; i < 5; i++) {
                queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            }
            // 6th should throw because maxQueueSize=5
            expect(() =>
                queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' })
            ).toThrow('Queue is full');
        });
    });

    // ====================================================================
    // getQueueForRepo
    // ====================================================================

    describe('getQueueForRepo', () => {
        it('should create a new queue for a new repository', () => {
            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            expect(queue).toBeInstanceOf(TaskQueueManager);
            expect(registry.hasRepo('/Users/dev/repo1')).toBe(true);
        });

        it('should return the same queue for the same repository', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo1');
            expect(queue1).toBe(queue2);
        });

        it('should return different queues for different repositories', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo2');
            expect(queue1).not.toBe(queue2);
        });

        it('should normalize repository paths (trailing slash)', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo1/');
            expect(queue1).toBe(queue2);
        });

        it('should normalize repository paths (relative)', () => {
            const cwd = process.cwd();
            const queue1 = registry.getQueueForRepo(path.join(cwd, 'repo1'));
            const queue2 = registry.getQueueForRepo('./repo1');
            expect(queue1).toBe(queue2);
        });

        it('should emit repoAdded event for new repository', () => {
            const listener = vi.fn();
            registry.on('repoAdded', listener);

            registry.getQueueForRepo('/Users/dev/repo1');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(path.resolve('/Users/dev/repo1'));
        });

        it('should not emit repoAdded for existing repository', () => {
            registry.getQueueForRepo('/Users/dev/repo1');

            const listener = vi.fn();
            registry.on('repoAdded', listener);

            registry.getQueueForRepo('/Users/dev/repo1');
            expect(listener).not.toHaveBeenCalled();
        });
    });

    // ====================================================================
    // hasRepo
    // ====================================================================

    describe('hasRepo', () => {
        it('should return true for existing repository', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            expect(registry.hasRepo('/Users/dev/repo1')).toBe(true);
        });

        it('should return false for non-existent repository', () => {
            expect(registry.hasRepo('/Users/dev/nonexistent')).toBe(false);
        });

        it('should normalize path before checking', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            expect(registry.hasRepo('/Users/dev/repo1/')).toBe(true);
        });
    });

    // ====================================================================
    // removeRepo
    // ====================================================================

    describe('removeRepo', () => {
        it('should remove an existing repository', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            const removed = registry.removeRepo('/Users/dev/repo1');
            expect(removed).toBe(true);
            expect(registry.hasRepo('/Users/dev/repo1')).toBe(false);
        });

        it('should return false for non-existent repository', () => {
            const removed = registry.removeRepo('/Users/dev/nonexistent');
            expect(removed).toBe(false);
        });

        it('should emit repoRemoved event', () => {
            const listener = vi.fn();
            registry.on('repoRemoved', listener);

            registry.getQueueForRepo('/Users/dev/repo1');
            registry.removeRepo('/Users/dev/repo1');

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(path.resolve('/Users/dev/repo1'));
        });

        it('should stop forwarding events after removal', () => {
            const listener = vi.fn();
            registry.on('taskAdded', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            registry.removeRepo('/Users/dev/repo1');

            // Enqueue after removal — registry should NOT receive the event
            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            expect(listener).not.toHaveBeenCalled();
        });

        it('should normalize path before removing', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            const removed = registry.removeRepo('/Users/dev/repo1/');
            expect(removed).toBe(true);
            expect(registry.hasRepo('/Users/dev/repo1')).toBe(false);
        });

        it('should allow re-adding a previously removed repo', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            registry.removeRepo('/Users/dev/repo1');

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            expect(queue).toBeInstanceOf(TaskQueueManager);
            expect(registry.hasRepo('/Users/dev/repo1')).toBe(true);
        });
    });

    // ====================================================================
    // getAllRepos
    // ====================================================================

    describe('getAllRepos', () => {
        it('should return empty array for empty registry', () => {
            expect(registry.getAllRepos()).toEqual([]);
        });

        it('should return all registered repository paths', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            registry.getQueueForRepo('/Users/dev/repo2');

            const repos = registry.getAllRepos();
            expect(repos).toHaveLength(2);
            expect(repos).toContain(path.resolve('/Users/dev/repo1'));
            expect(repos).toContain(path.resolve('/Users/dev/repo2'));
        });
    });

    // ====================================================================
    // getAllQueues
    // ====================================================================

    describe('getAllQueues', () => {
        it('should return empty map for empty registry', () => {
            const queues = registry.getAllQueues();
            expect(queues.size).toBe(0);
        });

        it('should return a shallow copy', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            const queues = registry.getAllQueues();

            // Modifying the copy should not affect the registry
            queues.delete(path.resolve('/Users/dev/repo1'));
            expect(registry.hasRepo('/Users/dev/repo1')).toBe(true);
        });

        it('should contain same queue instances', () => {
            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const queues = registry.getAllQueues();
            expect(queues.get(path.resolve('/Users/dev/repo1'))).toBe(queue);
        });
    });

    // ====================================================================
    // getStats
    // ====================================================================

    describe('getStats', () => {
        it('should return empty stats for empty registry', () => {
            const stats = registry.getStats();
            expect(stats.repoCount).toBe(0);
            expect(stats.totals.queued).toBe(0);
            expect(stats.totals.running).toBe(0);
            expect(stats.totals.completed).toBe(0);
            expect(stats.totals.failed).toBe(0);
            expect(stats.totals.cancelled).toBe(0);
            expect(stats.totals.total).toBe(0);
            expect(Object.keys(stats.byRepo)).toHaveLength(0);
        });

        it('should aggregate stats across multiple repositories', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo2');

            queue1.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue1.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue2.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            const stats = registry.getStats();
            expect(stats.repoCount).toBe(2);
            expect(stats.totals.queued).toBe(3);
            expect(stats.totals.total).toBe(3);
        });

        it('should include per-repo breakdown', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo2');

            queue1.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue2.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue2.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            const stats = registry.getStats();
            const repo1Key = path.resolve('/Users/dev/repo1');
            const repo2Key = path.resolve('/Users/dev/repo2');
            expect(stats.byRepo[repo1Key].queued).toBe(1);
            expect(stats.byRepo[repo2Key].queued).toBe(2);
        });

        it('should include completed/failed stats from history', () => {
            const queue = registry.getQueueForRepo('/Users/dev/repo1');

            const id1 = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            const id2 = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            // Simulate: dequeue → start → complete/fail
            queue.markStarted(id1);
            queue.markCompleted(id1, 'done');
            queue.markStarted(id2);
            queue.markFailed(id2, new Error('oops'));

            const stats = registry.getStats();
            expect(stats.totals.completed).toBe(1);
            expect(stats.totals.failed).toBe(1);
            expect(stats.totals.total).toBe(2);
        });
    });

    // ====================================================================
    // getRepoStats
    // ====================================================================

    describe('getRepoStats', () => {
        it('should return stats for an existing repository', () => {
            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            const stats = registry.getRepoStats('/Users/dev/repo1');
            expect(stats).toBeDefined();
            expect(stats!.queued).toBe(1);
        });

        it('should return undefined for non-existent repository', () => {
            const stats = registry.getRepoStats('/Users/dev/nonexistent');
            expect(stats).toBeUndefined();
        });

        it('should normalize path', () => {
            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            const stats = registry.getRepoStats('/Users/dev/repo1/');
            expect(stats).toBeDefined();
            expect(stats!.queued).toBe(1);
        });
    });

    // ====================================================================
    // Event Forwarding
    // ====================================================================

    describe('event forwarding', () => {
        it('should forward taskAdded events with repo context', () => {
            const listener = vi.fn();
            registry.on('taskAdded', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.type).toBe('custom');
        });

        it('should forward queueChange events with repo context', () => {
            const listener = vi.fn();
            registry.on('queueChange', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            expect(listener).toHaveBeenCalled();
            const [repoPath, event] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(event.type).toBe('added');
        });

        it('should forward taskStarted events', () => {
            const listener = vi.fn();
            registry.on('taskStarted', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const id = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue.markStarted(id);

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.id).toBe(id);
        });

        it('should forward taskCompleted events', () => {
            const listener = vi.fn();
            registry.on('taskCompleted', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const id = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue.markStarted(id);
            queue.markCompleted(id, 'result');

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task, result] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.id).toBe(id);
            expect(result).toBe('result');
        });

        it('should forward taskFailed events', () => {
            const listener = vi.fn();
            registry.on('taskFailed', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const id = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue.markStarted(id);
            queue.markFailed(id, new Error('oops'));

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task, error] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.id).toBe(id);
            expect(error).toBeInstanceOf(Error);
        });

        it('should forward taskCancelled events', () => {
            const listener = vi.fn();
            registry.on('taskCancelled', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const id = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue.cancelTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.id).toBe(id);
        });

        it('should forward taskRemoved events', () => {
            const listener = vi.fn();
            registry.on('taskRemoved', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const id = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue.removeTask(id);

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.id).toBe(id);
        });

        it('should forward taskUpdated events', () => {
            const listener = vi.fn();
            registry.on('taskUpdated', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            const id = queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue.updateTask(id, { displayName: 'Updated' });

            expect(listener).toHaveBeenCalledTimes(1);
            const [repoPath, task, updates] = listener.mock.calls[0];
            expect(repoPath).toBe(path.resolve('/Users/dev/repo1'));
            expect(task.id).toBe(id);
            expect(updates).toEqual({ displayName: 'Updated' });
        });

        it('should forward paused events', () => {
            const listener = vi.fn();
            registry.on('paused', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.pause();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe(path.resolve('/Users/dev/repo1'));
        });

        it('should forward resumed events', () => {
            const listener = vi.fn();
            registry.on('resumed', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.pause();
            queue.resume();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe(path.resolve('/Users/dev/repo1'));
        });

        it('should forward drain-started events', () => {
            const listener = vi.fn();
            registry.on('drain-started', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.enterDrainMode();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe(path.resolve('/Users/dev/repo1'));
        });

        it('should forward drain-cancelled events', () => {
            const listener = vi.fn();
            registry.on('drain-cancelled', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            queue.enterDrainMode();
            queue.exitDrainMode();

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0]).toBe(path.resolve('/Users/dev/repo1'));
        });

        it('should forward events from multiple repos independently', () => {
            const listener = vi.fn();
            registry.on('taskAdded', listener);

            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo2');

            queue1.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue2.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            expect(listener).toHaveBeenCalledTimes(2);
            expect(listener.mock.calls[0][0]).toBe(path.resolve('/Users/dev/repo1'));
            expect(listener.mock.calls[1][0]).toBe(path.resolve('/Users/dev/repo2'));
        });
    });

    // ====================================================================
    // clear
    // ====================================================================

    describe('clear', () => {
        it('should remove all repositories', () => {
            registry.getQueueForRepo('/Users/dev/repo1');
            registry.getQueueForRepo('/Users/dev/repo2');

            registry.clear();

            expect(registry.getAllRepos()).toHaveLength(0);
            expect(registry.getStats().repoCount).toBe(0);
        });

        it('should emit cleared event', () => {
            const listener = vi.fn();
            registry.on('cleared', listener);

            registry.getQueueForRepo('/Users/dev/repo1');
            registry.clear();

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should stop forwarding events after clear', () => {
            const listener = vi.fn();
            registry.on('taskAdded', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            registry.clear();

            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            expect(listener).not.toHaveBeenCalled();
        });

        it('should work on empty registry', () => {
            const listener = vi.fn();
            registry.on('cleared', listener);
            registry.clear();
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });

    // ====================================================================
    // dispose
    // ====================================================================

    describe('dispose', () => {
        it('should clear all queues and remove listeners', () => {
            const listener = vi.fn();
            registry.on('repoAdded', listener);

            registry.getQueueForRepo('/Users/dev/repo1');
            expect(listener).toHaveBeenCalledTimes(1);

            registry.dispose();

            expect(registry.getAllRepos()).toHaveLength(0);
            // After dispose, registry-level listeners are removed
            registry.getQueueForRepo('/Users/dev/repo2');
            expect(listener).toHaveBeenCalledTimes(1); // Still only 1
        });

        it('should stop forwarding events from old queues', () => {
            const listener = vi.fn();
            registry.on('taskAdded', listener);

            const queue = registry.getQueueForRepo('/Users/dev/repo1');
            registry.dispose();

            // Re-add listener after dispose
            const listener2 = vi.fn();
            registry.on('taskAdded', listener2);

            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            expect(listener).not.toHaveBeenCalled();
            expect(listener2).not.toHaveBeenCalled();
        });
    });

    // ====================================================================
    // Path normalization
    // ====================================================================

    describe('path normalization', () => {
        it('should handle relative paths', () => {
            const queue1 = registry.getQueueForRepo('./repo1');
            const queue2 = registry.getQueueForRepo('./repo1');
            expect(queue1).toBe(queue2);
        });

        it('should handle trailing slashes', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo1/');
            expect(queue1).toBe(queue2);
        });

        it('should handle double separators', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev//repo1');
            expect(queue1).toBe(queue2);
        });

        it('should handle dot segments', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/./repo1');
            expect(queue1).toBe(queue2);
        });

        it('should handle parent segments', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo2/../repo1');
            expect(queue1).toBe(queue2);
        });
    });

    // ====================================================================
    // Integration scenarios
    // ====================================================================

    describe('integration', () => {
        it('should support full lifecycle: add → use → remove', () => {
            const addedListener = vi.fn();
            const removedListener = vi.fn();
            registry.on('repoAdded', addedListener);
            registry.on('repoRemoved', removedListener);

            // Add repo and enqueue work
            const queue = registry.getQueueForRepo('/Users/dev/project');
            queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            expect(addedListener).toHaveBeenCalledTimes(1);
            expect(registry.getStats().totals.queued).toBe(1);

            // Remove repo
            registry.removeRepo('/Users/dev/project');
            expect(removedListener).toHaveBeenCalledTimes(1);
            expect(registry.getAllRepos()).toHaveLength(0);
        });

        it('should handle many repos', () => {
            for (let i = 0; i < 50; i++) {
                const queue = registry.getQueueForRepo(`/Users/dev/repo${i}`);
                queue.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            }

            const stats = registry.getStats();
            expect(stats.repoCount).toBe(50);
            expect(stats.totals.queued).toBe(50);
        });

        it('should isolate queues between repos', () => {
            const queue1 = registry.getQueueForRepo('/Users/dev/repo1');
            const queue2 = registry.getQueueForRepo('/Users/dev/repo2');

            queue1.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue1.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });
            queue2.enqueue({ type: 'custom', payload: { data: {} }, config: {}, priority: 'normal' });

            expect(queue1.size()).toBe(2);
            expect(queue2.size()).toBe(1);

            // Clearing one queue doesn't affect the other
            queue1.clear();
            expect(queue1.size()).toBe(0);
            expect(queue2.size()).toBe(1);
        });
    });
});
