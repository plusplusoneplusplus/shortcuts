/**
 * WorkflowDetailView clone routing.
 *
 * A workflow started on a remote clone is enqueued on THAT server, so its
 * processId only exists there. Both the REST fetch and the SSE stream must
 * follow the clone; a local (unregistered) workspace keeps hitting the origin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WorkflowDetailView } from '../../../../src/server/spa/client/react/processes/dag/WorkflowDetailView';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-remote';
const REMOTE_URL = 'http://127.0.0.1:4000';

const eventSourceUrls: string[] = [];

class StubEventSource {
    onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
    constructor(public url: string) {
        eventSourceUrls.push(url);
    }
    addEventListener(): void { /* no-op */ }
    removeEventListener(): void { /* no-op */ }
    close(): void { /* no-op */ }
}

function runningProcessResponse() {
    return {
        process: {
            id: 'proc-1',
            status: 'running',
            metadata: { pipelineName: 'wf-1', pipelineConfig: { map: { concurrency: 1 } } },
        },
        children: [],
    };
}

describe('WorkflowDetailView clone routing', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetSpaCocClientForTests();
        resetCloneRegistryForTests();
        eventSourceUrls.length = 0;
        fetchMock = vi.fn(async () => new Response(JSON.stringify(runningProcessResponse()), {
            headers: { 'content-type': 'application/json' },
        }));
        global.fetch = fetchMock as unknown as typeof fetch;
        (globalThis as any).EventSource = StubEventSource;
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        delete (globalThis as any).EventSource;
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('fetches the process and opens the SSE stream on the remote server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);

        render(<WorkflowDetailView processId="proc-1" workspaceId={REMOTE_WS} />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url.startsWith(`${REMOTE_URL}/api/processes/proc-1`)).toBe(true);

        await waitFor(() => expect(eventSourceUrls.length).toBeGreaterThan(0));
        expect(eventSourceUrls[0]).toBe(`${REMOTE_URL}/api/processes/proc-1/stream`);
    });

    it('stays on the page origin for a local workspace', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);

        render(<WorkflowDetailView processId="proc-1" workspaceId="ws-local" />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(fetchMock.mock.calls[0][0] as string).toContain('/api/processes/proc-1');
        expect(fetchMock.mock.calls[0][0] as string).not.toContain(REMOTE_URL);

        await waitFor(() => expect(eventSourceUrls.length).toBeGreaterThan(0));
        expect(eventSourceUrls[0]).toBe('/api/processes/proc-1/stream');
    });

    it('stays on the page origin when no workspaceId is supplied', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => expect(eventSourceUrls.length).toBeGreaterThan(0));
        expect(eventSourceUrls[0]).toBe('/api/processes/proc-1/stream');
    });
});
