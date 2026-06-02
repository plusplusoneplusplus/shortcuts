import { CocApiError, CocClient, CocNetworkError } from '@plusplusoneplusplus/coc-client';
import type { EnqueueTaskRequest, EnqueueTaskResponse, WorkspaceInfo, WorkspacesResponse } from '@plusplusoneplusplus/coc-client';
import * as path from 'path';
import { createInterface } from 'readline/promises';

const DEFAULT_SERVER_URL = 'http://localhost:4000';
const CHAT_MODES = ['ask', 'autopilot'] as const;
const CHAT_PROVIDERS = ['copilot', 'codex', 'claude'] as const;
const EFFORT_TIERS = ['low', 'medium', 'high'] as const;
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
const SUBMIT_OUTPUT_FORMATS = ['text', 'json'] as const;

type ChatMode = typeof CHAT_MODES[number];
type ChatProvider = typeof CHAT_PROVIDERS[number];
type EffortTier = typeof EFFORT_TIERS[number];
type ReasoningEffort = typeof REASONING_EFFORTS[number];
type QueuePriority = typeof PRIORITIES[number];
type QueueSubmitOutputFormat = typeof SUBMIT_OUTPUT_FORMATS[number];

type InputStream = NodeJS.ReadableStream & { isTTY?: boolean };
type OutputStream = NodeJS.WritableStream;

interface QueueApiClient {
    queue: {
        enqueue(request: EnqueueTaskRequest): Promise<EnqueueTaskResponse>;
    };
    workspaces: {
        list(): Promise<WorkspacesResponse>;
    };
}

export interface QueueSubmitOptions {
    mode?: string;
    provider?: string;
    effortTier?: string;
    model?: string;
    reasoningEffort?: string;
    workspaceId?: string;
    priority?: string;
    displayName?: string;
    serverUrl?: string;
    output?: string;
}

export interface QueueSubmitDependencies {
    client?: QueueApiClient;
    stdin?: InputStream;
    stdout?: OutputStream;
    stderr?: OutputStream;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}

export async function executeQueueSubmit(
    message: string | undefined,
    opts: QueueSubmitOptions,
    deps: QueueSubmitDependencies = {},
): Promise<number> {
    const stdout = deps.stdout ?? process.stdout;
    const stderr = deps.stderr ?? process.stderr;

    try {
        const serverUrl = resolveServerUrl(opts, deps.env ?? process.env);
        const client = deps.client ?? new CocClient({ baseUrl: serverUrl });
        const prompt = await resolvePrompt(message, deps.stdin ?? process.stdin, stderr);
        const request = await buildQueueSubmitRequest(prompt, opts, client, deps.cwd ?? process.cwd());
        const response = await client.queue.enqueue(request);
        const taskId = response.task.id;
        const status = typeof response.task.status === 'string' ? response.task.status : 'queued';

        if (resolveOutputFormat(opts.output) === 'json') {
            writeLine(stdout, JSON.stringify({ taskId, status }));
        } else {
            writeLine(stdout, `Task queued: ${taskId}`);
        }
        return 0;
    } catch (error) {
        writeLine(stderr, formatQueueCliError(error));
        return 1;
    }
}

export async function buildQueueSubmitRequest(
    prompt: string,
    opts: QueueSubmitOptions,
    client: Pick<QueueApiClient, 'workspaces'>,
    cwd: string,
): Promise<EnqueueTaskRequest> {
    if (!prompt.trim()) {
        throw new Error('Prompt is required. Pass a message argument or provide stdin input.');
    }

    const mode = resolveEnum(opts.mode, CHAT_MODES, 'mode') ?? 'autopilot';
    const provider = resolveEnum(opts.provider, CHAT_PROVIDERS, 'provider');
    const priority = resolveEnum(opts.priority, PRIORITIES, 'priority') ?? 'normal';
    const effortTier = resolveEnum(opts.effortTier, EFFORT_TIERS, 'effort-tier');
    const reasoningEffort = resolveEnum(opts.reasoningEffort, REASONING_EFFORTS, 'reasoning-effort');
    const workspaceId = trimOptional(opts.workspaceId) ?? await resolveWorkspaceIdFromCwd(client, cwd);

    const payload: Record<string, unknown> = {
        kind: 'chat',
        prompt,
        mode,
        workspaceId,
    };
    if (provider) {
        payload.provider = provider;
    }

    const config: EnqueueTaskRequest['config'] = {};
    assignOptional(config, 'effortTier', effortTier);
    assignOptional(config, 'model', trimOptional(opts.model));
    assignOptional(config, 'reasoningEffort', reasoningEffort);

    const request: EnqueueTaskRequest = {
        type: 'chat',
        priority,
        payload,
    };
    if (Object.keys(config).length > 0) {
        request.config = config;
    }
    assignOptional(request, 'displayName', trimOptional(opts.displayName));
    return request;
}

export function resolveWorkspaceIdFromWorkspaces(cwd: string, workspaces: WorkspaceInfo[]): string | undefined {
    const normalizedCwd = normalizeFilesystemPathForCompare(cwd);
    const candidates = workspaces
        .filter(workspace => typeof workspace.rootPath === 'string' && workspace.rootPath.trim().length > 0)
        .map(workspace => ({
            id: workspace.id,
            rootPath: normalizeFilesystemPathForCompare(workspace.rootPath),
        }))
        .sort((left, right) => right.rootPath.length - left.rootPath.length);

    return candidates.find(candidate => isSameOrChildPath(normalizedCwd, candidate.rootPath))?.id;
}

function resolveServerUrl(opts: QueueSubmitOptions, env: NodeJS.ProcessEnv): string {
    return trimOptional(opts.serverUrl) ?? trimOptional(env.COC_SERVER_URL) ?? DEFAULT_SERVER_URL;
}

function resolveOutputFormat(value: string | undefined): QueueSubmitOutputFormat {
    return resolveEnum(value, SUBMIT_OUTPUT_FORMATS, 'output') ?? 'text';
}

async function resolveWorkspaceIdFromCwd(client: Pick<QueueApiClient, 'workspaces'>, cwd: string): Promise<string> {
    const { workspaces } = await client.workspaces.list();
    const workspaceId = resolveWorkspaceIdFromWorkspaces(cwd, workspaces);
    if (!workspaceId) {
        throw new Error('No registered CoC workspace matches the current directory. Pass --workspace-id to choose one explicitly.');
    }
    return workspaceId;
}

async function resolvePrompt(message: string | undefined, stdin: InputStream, promptOutput: OutputStream): Promise<string> {
    if (typeof message === 'string' && message.trim().length > 0) {
        return message;
    }
    if (stdin.isTTY) {
        const rl = createInterface({ input: stdin, output: promptOutput });
        try {
            return await rl.question('Prompt: ');
        } finally {
            rl.close();
        }
    }

    const chunks: string[] = [];
    for await (const chunk of stdin as AsyncIterable<Buffer | string>) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    }
    return chunks.join('').trimEnd();
}

function resolveEnum<T extends string>(
    value: string | undefined,
    allowedValues: readonly T[],
    optionName: string,
): T | undefined {
    const trimmed = trimOptional(value);
    if (!trimmed) {
        return undefined;
    }
    if ((allowedValues as readonly string[]).includes(trimmed)) {
        return trimmed as T;
    }
    throw new Error(`Invalid ${optionName}: '${trimmed}'. Valid values: ${allowedValues.join(', ')}`);
}

function trimOptional(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function assignOptional<T extends object, K extends string, V>(
    target: T,
    key: K,
    value: V | undefined,
): asserts target is T & Record<K, V> {
    if (value !== undefined) {
        Object.assign(target, { [key]: value });
    }
}

function normalizeFilesystemPathForCompare(value: string): string {
    const resolved = path.resolve(value);
    const withoutTrailingSeparator = stripTrailingPathSeparators(resolved);
    return process.platform === 'win32' ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
}

function stripTrailingPathSeparators(value: string): string {
    const root = path.parse(value).root;
    let end = value.length;
    while (end > root.length && (value[end - 1] === '/' || value[end - 1] === '\\')) {
        end -= 1;
    }
    return value.slice(0, end);
}

function isSameOrChildPath(child: string, parent: string): boolean {
    return child === parent || child.startsWith(parent + path.sep);
}

function writeLine(stream: OutputStream, line: string): void {
    stream.write(`${line}\n`);
}

function formatQueueCliError(error: unknown): string {
    if (error instanceof CocApiError) {
        return error.message;
    }
    if (error instanceof CocNetworkError) {
        return `${error.message}. Is the CoC server running at ${error.url || DEFAULT_SERVER_URL}?`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
