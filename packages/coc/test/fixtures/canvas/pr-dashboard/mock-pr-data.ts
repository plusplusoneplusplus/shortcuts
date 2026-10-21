/**
 * Mock `query_pull_request` fixtures for the PR dashboard canvas tests. Shapes
 * follow the real tool's JSON (`query` / `get` / failure); no provider is called.
 */

import { defineTool, type Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';

const CI_STATES = ['passing', 'failing', 'pending', 'none'] as const;

function summary(id: number) {
    return {
        id,
        title: `PR ${id}`,
        url: `https://github.com/octo/demo/pull/${id}`,
        author: { login: `dev${id}` },
        lifecycle: 'open',
        isDraft: id % 2 === 0,
        sourceBranch: `feature/${id}`,
        targetBranch: 'main',
        ci: { state: CI_STATES[id % CI_STATES.length] },
    };
}

/** `mode: 'query'` with 7 open PRs, ids 101–107. */
export function listResult(repository = 'octo/demo') {
    return {
        success: true,
        mode: 'query',
        provider: 'github',
        repository,
        filters: { status: 'open' },
        items: [101, 102, 103, 104, 105, 106, 107].map(summary),
        scan: { complete: true },
        ciUnavailableExcluded: 0,
    };
}

/** `mode: 'get'`: every id resolves except 104, which is not found. */
export function getResult(ids: number[], repository = 'octo/demo') {
    return {
        success: true,
        mode: 'get',
        provider: 'github',
        repository,
        results: ids.map(id => id === 104
            ? { id, ok: false, error: { code: 'not-found', message: `PR ${id} not found` } }
            : { id, ok: true, pullRequest: { ...summary(id), description: `Body of ${id}` } }),
    };
}

export const failureResult = { success: false, code: 'auth-required', error: 'Sign in to GitHub first' };

export const emptyListResult = { ...listResult(), items: [] };

export interface MockPrTool {
    tool: Tool<any>;
    calls: Array<Record<string, unknown>>;
}

/**
 * A recording `query_pull_request` stub. `list` decides the query-mode answer;
 * get mode always answers with {@link getResult}.
 */
export function createMockPrTool(list: (args: Record<string, unknown>) => unknown = args => listResult(String(args.repository))): MockPrTool {
    const calls: Array<Record<string, unknown>> = [];
    const tool = defineTool<Record<string, unknown>>('query_pull_request', {
        description: 'mock query_pull_request',
        handler: async args => {
            calls.push(args);
            return JSON.stringify(Array.isArray(args.ids)
                ? getResult(args.ids as number[], String(args.repository))
                : list(args));
        },
    });
    return { tool, calls };
}

/** The fixture's extension documents, ready for `CanvasStore.saveExtension`. */
export function loadPrDashboardFixture() {
    const dir = __dirname;
    const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf-8');
    return {
        manifest: JSON.parse(read('manifest.json')),
        capabilitiesJs: read('capabilities.js'),
        uiHtml: read('ui.html'),
        state: JSON.parse(read('state.json')) as Record<string, unknown>,
    };
}
