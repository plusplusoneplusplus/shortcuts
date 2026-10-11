import { describe, expect, it } from 'vitest';
import { queueJobHash } from '../../../src/server/spa/client/react/queue/queueJobRoute';
import { parseActivityDeepLink, parseWorkflowDeepLink } from '../../../src/server/spa/client/react/layout/dashboardRoutes';

describe('queueJobHash', () => {
    it.each(['chat', 'run-script', 'dream-run', 'pr-classification', 'unknown'])('opens %s on the existing conversation route with the owning clone', type => {
        const route = 'remote:server-a:ws-alpha';
        const hash = queueJobHash(route, { id: 'job/one', type });
        expect(hash).toBe('#repos/remote%3Aserver-a%3Aws-alpha/chats/queue_job%2Fone');
        expect(parseActivityDeepLink(hash)).toBe('queue_job/one');
    });
    it('preserves a supplied process id and avoids double queue prefixes', () => {
        expect(queueJobHash('group-alpha', { id: 'queue_job' })).toBe('#repos/group-alpha/chats/queue_job');
        expect(queueJobHash('ws-alpha', { id: 'job', processId: 'actual-process' })).toBe('#repos/ws-alpha/chats/actual-process');
    });
    it('matches workflow selection and the work-item workflow exception', () => {
        const hash = queueJobHash('ws-alpha', { id: 'workflow-job', type: 'run-workflow' });
        expect(hash).toBe('#repos/ws-alpha/workflow/workflow-job');
        expect(parseWorkflowDeepLink(hash)).toMatchObject({ processId: 'workflow-job' });
        expect(queueJobHash('ws-alpha', { id: 'job', type: 'run-workflow', processId: 'run' })).toBe('#repos/ws-alpha/workflow/run');
        expect(queueJobHash('ws-alpha', { id: 'job', type: 'run-workflow', payload: { workItemId: 'item' } })).toBe('#repos/ws-alpha/chats/queue_job');
        expect(queueJobHash('ws-alpha', { id: 'job', type: 'run-workflow', workItemId: 'item' })).toBe('#repos/ws-alpha/chats/queue_job');
    });
});
