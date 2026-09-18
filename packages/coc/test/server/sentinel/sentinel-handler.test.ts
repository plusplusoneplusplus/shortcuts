import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../../../src/server/types';
import { registerSentinelRoutes } from '../../../src/server/sentinel/sentinel-handler';

function createResponse() {
    const response = {
        statusCode: 200,
        body: undefined as unknown,
        setHeader: vi.fn(),
        writeHead(statusCode: number) {
            response.statusCode = statusCode;
        },
        end(data?: string) {
            response.body = data ? JSON.parse(data) : undefined;
        },
    };
    return response;
}

async function dispatch(routes: Route[], workspaceId: string) {
    const requestPath = `/api/workspaces/${workspaceId}/sentinel/check-now`;
    const route = routes.find(candidate =>
        candidate.method === 'POST' && candidate.pattern.test(requestPath),
    );
    if (!route) throw new Error(`No route matched ${requestPath}`);
    const response = createResponse();
    await route.handler({} as never, response as never, requestPath.match(route.pattern));
    return response;
}

describe('Sentinel routes', () => {
    it('starts an immediate workspace scan', async () => {
        const routes: Route[] = [];
        const checkNow = vi.fn(async () => ({
            status: 'triggered' as const,
            processId: 'queue_sentinel',
            cronId: 'cron_sentinel',
        }));
        registerSentinelRoutes(routes, { checkNow });

        const response = await dispatch(routes, 'workspace%20a');

        expect(checkNow).toHaveBeenCalledWith('workspace a');
        expect(response.statusCode).toBe(202);
        expect(response.body).toEqual({
            status: 'triggered',
            processId: 'queue_sentinel',
            cronId: 'cron_sentinel',
        });
    });

    it.each([
        ['not-found', 404],
        ['not-ready', 409],
        ['busy', 409],
    ] as const)('maps %s to %i', async (status, expectedStatus) => {
        const routes: Route[] = [];
        registerSentinelRoutes(routes, {
            checkNow: vi.fn(async () => status === 'not-found'
                ? { status }
                : { status, processId: 'queue_sentinel' }),
        });

        const response = await dispatch(routes, 'workspace-a');

        expect(response.statusCode).toBe(expectedStatus);
    });
});
