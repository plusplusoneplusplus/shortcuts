/**
 * Seed Utilities for E2E Tests
 *
 * Helpers to populate processes and workspaces via the REST API.
 */

import * as http from 'http';

/** Make an HTTP request and return { status, body }. */
export function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

export interface ProcessOverrides {
    status?: string;
    type?: string;
    workspaceId?: string;
    promptPreview?: string;
    parentProcessId?: string;
    [key: string]: unknown;
}

/** Seed a single process via POST /api/processes. Returns the created process. */
export async function seedProcess(
    baseURL: string,
    id: string,
    overrides: ProcessOverrides = {},
): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
        id,
        promptPreview: overrides.promptPreview ?? `Process ${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: overrides.status ?? 'running',
        startTime: new Date().toISOString(),
        type: overrides.type ?? 'clarification',
        ...overrides,
    });
    const res = await request(`${baseURL}/api/processes`, { method: 'POST', body });
    return JSON.parse(res.body);
}

/** Seed multiple processes. Returns array of created processes. */
export async function seedProcesses(
    baseURL: string,
    count: number,
    overrides: ProcessOverrides = {},
): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (let i = 1; i <= count; i++) {
        const result = await seedProcess(baseURL, `proc-${i}`, {
            promptPreview: `Test Process ${i}`,
            ...overrides,
        });
        results.push(result);
    }
    return results;
}

/** Seed a workspace via POST /api/workspaces. */
export async function seedWorkspace(
    baseURL: string,
    id: string,
    name: string,
    rootPath?: string,
): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
        id,
        name,
        rootPath: rootPath ?? `/ws/${name}`,
    });
    const res = await request(`${baseURL}/api/workspaces`, { method: 'POST', body });
    return JSON.parse(res.body);
}
