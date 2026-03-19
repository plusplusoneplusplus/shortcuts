import { describe, it, expect } from 'vitest';
import { buildMetadataProcess } from '../../../../src/server/spa/client/react/utils/chatUtils';

describe('buildMetadataProcess', () => {
    it('returns null when task is null', () => {
        expect(buildMetadataProcess(null, null, null)).toBeNull();
    });

    it('returns null when task is undefined', () => {
        expect(buildMetadataProcess(undefined, null, null)).toBeNull();
    });

    it('uses processId over task.id when processId is provided', () => {
        const task = { id: 'task-1', config: { model: 'gpt-4' } };
        const result = buildMetadataProcess(task, null, 'proc-99');
        expect(result.id).toBe('proc-99');
    });

    it('falls back to task.id when processId is null', () => {
        const task = { id: 'task-1' };
        const result = buildMetadataProcess(task, null, null);
        expect(result.id).toBe('task-1');
    });

    it('merges processDetails fields onto the task', () => {
        const task = { id: 't1', status: 'pending' };
        const details = { status: 'running', extra: 'yes' };
        const result = buildMetadataProcess(task, details, null);
        expect(result.status).toBe('running');
        expect(result.extra).toBe('yes');
    });

    it('builds metadata with queueTaskId from task.id', () => {
        const task = { id: 'task-abc', config: { model: 'gpt-4' }, metadata: { custom: 'val' } };
        const result = buildMetadataProcess(task, null, 'proc-1');
        expect(result.metadata.queueTaskId).toBe('task-abc');
        expect(result.metadata.model).toBe('gpt-4');
        expect(result.metadata.custom).toBe('val');
    });

    it('merges processDetails.metadata over task.metadata', () => {
        const task = { id: 't1', metadata: { shared: 'from-task', fromTask: true } };
        const details = { metadata: { shared: 'from-details', fromDetails: true } };
        const result = buildMetadataProcess(task, details, null);
        expect(result.metadata.shared).toBe('from-details');
        expect(result.metadata.fromTask).toBe(true);
        expect(result.metadata.fromDetails).toBe(true);
    });

    it('handles missing task.config gracefully', () => {
        const task = { id: 't1' };
        const result = buildMetadataProcess(task, null, null);
        expect(result.metadata.model).toBeUndefined();
    });

    it('handles processDetails being null', () => {
        const task = { id: 't1', config: { model: 'm1' } };
        const result = buildMetadataProcess(task, null, null);
        expect(result).toBeDefined();
        expect(result.id).toBe('t1');
    });
});
