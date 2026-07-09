import { CocApiError, CocClient } from '@plusplusoneplusplus/coc-client';
import type {
    CherryPickTransferResponse,
    GitOpServerMetadata,
    GitPatchApplyRequest,
    GitPatchApplyResponse,
    GitPatchExportResponse,
} from '@plusplusoneplusplus/coc-client';
import type { RemoteServerRuntimeService } from './remote-server-runtime-service';

const LOCAL_SERVER_METADATA: GitOpServerMetadata = { id: 'local', label: 'Current CoC' };

interface ParsedTransferEndpoint {
    serverId?: string;
    workspaceId: string;
}

interface ParsedTransferRequest {
    source: ParsedTransferEndpoint & { hashes: string[] };
    target: ParsedTransferEndpoint & { stashAndContinue: boolean };
}

interface GitPatchClient {
    git: {
        exportCommitPatches(workspaceId: string, hashes: string[]): Promise<GitPatchExportResponse>;
        applyCommitPatch(workspaceId: string, request: GitPatchApplyRequest): Promise<GitPatchApplyResponse>;
    };
}

interface ResolvedTransferEndpoint {
    client: GitPatchClient;
    server: GitOpServerMetadata;
}

export interface CherryPickTransferServiceOptions {
    runtime: RemoteServerRuntimeService;
    getLocalBaseUrl?: () => string | undefined;
    requestTimeoutMs?: number;
    clientFactory?: (baseUrl: string, timeoutMs: number) => GitPatchClient;
}

export class TransferHttpError extends Error {
    constructor(
        readonly statusCode: number,
        readonly body: Record<string, unknown>,
    ) {
        super(String(body.error ?? 'Cherry-pick transfer failed'));
    }
}

function transferError(statusCode: number, body: Record<string, unknown>): never {
    throw new TransferHttpError(statusCode, body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}

function parseTransferEndpoint(value: unknown, label: 'source' | 'target'): ParsedTransferEndpoint {
    if (!isRecord(value)) {
        transferError(400, { error: `${label} must be an object` });
    }
    const workspaceId = nonEmptyString(value.workspaceId);
    if (!workspaceId) {
        transferError(400, { error: `${label}.workspaceId is required` });
    }
    const rawServerId = nonEmptyString(value.serverId);
    const serverId = rawServerId && rawServerId !== LOCAL_SERVER_METADATA.id ? rawServerId : undefined;
    return { serverId, workspaceId };
}

const TRANSFER_HASH_PATTERN = /^[a-fA-F0-9]{4,40}$/;

function parseSourceHashes(source: Record<string, unknown>): string[] {
    if (Array.isArray(source.commitHashes)) {
        const hashes = source.commitHashes
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(value => value.length > 0);
        if (hashes.length === 0) {
            transferError(400, { error: 'source.commitHashes must contain at least one git commit hash' });
        }
        if (!hashes.every(value => TRANSFER_HASH_PATTERN.test(value))) {
            transferError(400, { error: 'source.commitHashes must all be git commit hashes' });
        }
        return hashes;
    }
    const commitHash = nonEmptyString(source.commitHash);
    if (!commitHash || !TRANSFER_HASH_PATTERN.test(commitHash)) {
        transferError(400, { error: 'source.commitHash is required and must be a git commit hash' });
    }
    return [commitHash];
}

function parseTransferRequest(value: unknown): ParsedTransferRequest {
    if (!isRecord(value)) {
        transferError(400, { error: 'Request body must be a JSON object' });
    }
    const source = parseTransferEndpoint(value.source, 'source');
    const target = parseTransferEndpoint(value.target, 'target');
    if (!isRecord(value.source)) {
        transferError(400, { error: 'source must be an object' });
    }
    const hashes = parseSourceHashes(value.source);
    const stashAndContinue = isRecord(value.target) && value.target.stashAndContinue === true;
    return {
        source: { ...source, hashes },
        target: { ...target, stashAndContinue },
    };
}

function endpointLabel(endpoint: ResolvedTransferEndpoint): string {
    return endpoint.server.label ? `${endpoint.server.label} (${endpoint.server.id})` : endpoint.server.id;
}

function remoteErrorBody(error: CocApiError, phase: 'export' | 'apply', endpoint: ResolvedTransferEndpoint): Record<string, unknown> {
    const body: Record<string, unknown> = isRecord(error.body) ? { ...error.body } : { error: error.message };
    if (typeof body.error !== 'string' || !body.error) {
        body.error = error.message;
    }
    body.phase = phase;
    body.server = endpoint.server;
    return body;
}

async function callEndpoint<T>(
    endpoint: ResolvedTransferEndpoint,
    phase: 'export' | 'apply',
    action: () => Promise<T>,
): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof CocApiError) {
            transferError(error.status || 502, remoteErrorBody(error, phase, endpoint));
        }
        const message = error instanceof Error ? error.message : String(error);
        transferError(502, {
            error: `Failed to ${phase} commit patch via ${endpointLabel(endpoint)}: ${message}`,
            phase,
            server: endpoint.server,
        });
    }
}

export class CherryPickTransferService {
    constructor(private readonly options: CherryPickTransferServiceOptions) {}

    async run(value: unknown): Promise<CherryPickTransferResponse> {
        const request = parseTransferRequest(value);
        const sourceEndpoint = await this.resolveEndpoint(request.source);
        const targetEndpoint = await this.resolveEndpoint(request.target);

        const exported = await callEndpoint<GitPatchExportResponse>(
            sourceEndpoint,
            'export',
            () => sourceEndpoint.client.git.exportCommitPatches(request.source.workspaceId, request.source.hashes),
        );
        const sourceCommits = exported.sourceCommits ?? [exported.sourceCommit];
        const applyRequest: GitPatchApplyRequest = {
            patch: exported.patch,
            stashAndContinue: request.target.stashAndContinue,
            sourceServer: sourceEndpoint.server,
            sourceWorkspace: exported.sourceWorkspace,
            sourceCommit: exported.sourceCommit,
            sourceCommits,
            normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl,
        };
        const applied = await callEndpoint<GitPatchApplyResponse>(
            targetEndpoint,
            'apply',
            () => targetEndpoint.client.git.applyCommitPatch(request.target.workspaceId, applyRequest),
        );

        return {
            success: true,
            source: {
                server: sourceEndpoint.server,
                workspace: exported.sourceWorkspace,
                commit: exported.sourceCommit,
                commits: sourceCommits,
                normalizedRemoteUrl: exported.normalizedSourceRemoteUrl,
            },
            target: {
                server: targetEndpoint.server,
                workspace: applied.targetWorkspace,
                branch: applied.targetBranch,
                head: applied.targetHead ?? applied.newCommitHash,
            },
            result: applied,
        };
    }

    private async resolveEndpoint(ref: ParsedTransferEndpoint): Promise<ResolvedTransferEndpoint> {
        const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
        if (!ref.serverId) {
            const localBaseUrl = this.options.getLocalBaseUrl?.();
            if (!localBaseUrl) {
                transferError(503, {
                    error: 'Current CoC server is not available for local cherry-pick transfer',
                    server: LOCAL_SERVER_METADATA,
                    status: 'offline',
                });
            }
            return {
                client: this.createClient(localBaseUrl, timeoutMs),
                server: LOCAL_SERVER_METADATA,
            };
        }

        const server = this.options.runtime.getServer(ref.serverId);
        if (!server) {
            transferError(404, { error: `Remote server not found: ${ref.serverId}` });
        }
        const health = await this.options.runtime.healthForServer(server);
        const metadata: GitOpServerMetadata = { id: server.id, label: server.label };
        if (health.status !== 'online' || !health.effectiveUrl) {
            transferError(503, {
                error: `Remote server "${server.label}" is not online${health.error ? `: ${health.error}` : ''}`,
                server: metadata,
                status: health.status,
                lastError: health.error,
            });
        }
        return {
            client: this.createClient(health.effectiveUrl, timeoutMs),
            server: metadata,
        };
    }

    private createClient(baseUrl: string, timeoutMs: number): GitPatchClient {
        return this.options.clientFactory?.(baseUrl, timeoutMs) ?? new CocClient({ baseUrl, timeoutMs });
    }
}
