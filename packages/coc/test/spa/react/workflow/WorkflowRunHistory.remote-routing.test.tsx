/**
 * WorkflowRunHistory clone routing.
 *
 * `/queue/history` answers 200 with an EMPTY list for an unknown repoId, so an
 * unrouted read against a remote clone silently renders "no runs" instead of
 * failing. These assert the REST read lands on the owning clone's server, and
 * that a local (unregistered) workspace still hits the page origin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// The active-task list comes from the local queue WebSocket; stub the context so
// the component can render standalone.
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { repoQueueMap: {} } }),
}));

import { WorkflowRunHistory } from '../../../../src/server/spa/client/react/features/workflow/WorkflowRunHistory';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-remote';
const REMOTE_URL = 'http://127.0.0.1:4000';

describe('WorkflowRunHistory clone routing', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetSpaCocClientForTests();
        resetCloneRegistryForTests();
        fetchMock = vi.fn(async () => new Response(JSON.stringify({ history: [] }), {
            headers: { 'content-type': 'application/json' },
        }));
        global.fetch = fetchMock as unknown as typeof fetch;
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('reads run history from the remote server for a registered clone', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);

        render(<WorkflowRunHistory workspaceId={REMOTE_WS} pipelineName="wf-1" />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url.startsWith(`${REMOTE_URL}/api/queue/history`)).toBe(true);
        expect(url).toContain('repoId=ws-remote');
        expect(url).toContain('pipelineName=wf-1');
    });

    it('reads run history from the page origin for a local workspace', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);

        render(<WorkflowRunHistory workspaceId="ws-local" pipelineName="wf-1" />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url.startsWith('/api/queue/history')).toBe(true);
        expect(url).toContain('repoId=ws-local');
    });
});
