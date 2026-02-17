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

// ---------------------------------------------------------------------------
// Queue Task Helpers
// ---------------------------------------------------------------------------

export interface QueueTaskOverrides {
    type?: string;
    priority?: string;
    status?: string;
    displayName?: string;
    payload?: Record<string, unknown>;
    config?: {
        model?: string;
        timeoutMs?: number;
        retryOnFailure?: boolean;
        retryAttempts?: number;
    };
    repoId?: string;
    [key: string]: unknown;
}

/** Seed a single queue task via POST /api/queue.  Returns the created task. */
export async function seedQueueTask(
    baseURL: string,
    overrides: QueueTaskOverrides = {},
): Promise<Record<string, unknown>> {
    const taskSpec = {
        type: overrides.type ?? 'ai-clarification',
        priority: overrides.priority ?? 'normal',
        displayName: overrides.displayName,
        payload: overrides.payload ?? { prompt: 'Test task prompt' },
        config: overrides.config,
        repoId: overrides.repoId,
        ...overrides,
    };

    const body = JSON.stringify(taskSpec);
    const res = await request(`${baseURL}/api/queue`, { method: 'POST', body });

    if (res.status !== 201) {
        throw new Error(`Failed to seed queue task: ${res.status} ${res.body}`);
    }

    const json = JSON.parse(res.body);
    return json.task ?? json;
}

/** Seed multiple queue tasks via POST /api/queue/bulk.  Returns created tasks. */
export async function seedQueueTasks(
    baseURL: string,
    tasks: QueueTaskOverrides[],
): Promise<Record<string, unknown>[]> {
    const taskSpecs = tasks.map((t) => ({
        type: t.type ?? 'ai-clarification',
        priority: t.priority ?? 'normal',
        displayName: t.displayName,
        payload: t.payload ?? { prompt: 'Bulk task prompt' },
        config: t.config,
        repoId: t.repoId,
        ...t,
    }));

    const body = JSON.stringify({ tasks: taskSpecs });
    const res = await request(`${baseURL}/api/queue/bulk`, { method: 'POST', body });

    if (res.status !== 201 && res.status !== 207) {
        throw new Error(`Failed to seed bulk queue tasks: ${res.status} ${res.body}`);
    }

    const json = JSON.parse(res.body);
    return (json.success ?? json.tasks ?? []).map((s: Record<string, unknown>) => s.task ?? s);
}

/** Seed conversation turns for an existing process via PATCH /api/processes/:id. */
export async function seedConversationTurns(
    baseURL: string,
    processId: string,
    turns: Array<{
        type: 'user' | 'assistant' | 'tool';
        content: string;
        timestamp?: string;
        tool?: string;
        toolInput?: string;
        toolOutput?: string;
    }>,
): Promise<void> {
    const getRes = await request(`${baseURL}/api/processes/${processId}`);
    if (getRes.status !== 200) {
        throw new Error(`Process ${processId} not found: ${getRes.status}`);
    }

    const process = JSON.parse(getRes.body);
    const updatedConversation = [
        ...(process.conversation ?? []),
        ...turns.map((turn) => ({
            ...turn,
            timestamp: turn.timestamp ?? new Date().toISOString(),
        })),
    ];

    const updateRes = await request(`${baseURL}/api/processes/${processId}`, {
        method: 'PATCH',
        body: JSON.stringify({ conversation: updatedConversation }),
    });

    if (updateRes.status !== 200) {
        throw new Error(`Failed to update conversation: ${updateRes.status} ${updateRes.body}`);
    }
}

// ---------------------------------------------------------------------------
// Workspace Helpers
// ---------------------------------------------------------------------------

/** Seed a workspace via POST /api/workspaces. */
export async function seedWorkspace(
    baseURL: string,
    id: string,
    name: string,
    rootPath?: string,
    color?: string,
): Promise<Record<string, unknown>> {
    const payload: Record<string, string> = {
        id,
        name,
        rootPath: rootPath ?? `/ws/${name}`,
    };
    if (color) payload.color = color;
    const body = JSON.stringify(payload);
    const res = await request(`${baseURL}/api/workspaces`, { method: 'POST', body });
    return JSON.parse(res.body);
}
