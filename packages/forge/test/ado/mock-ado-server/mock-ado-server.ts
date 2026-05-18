import http from 'node:http';
import { Buffer } from 'node:buffer';
import type {
    GitPullRequest,
    GitPullRequestChange,
    GitPullRequestCommentThread,
    GitPullRequestIteration,
} from 'azure-devops-node-api/interfaces/GitInterfaces';

const LOCATION_RESOURCE_AREAS_ID = 'e81700f7-3be2-46de-8624-2eb35882fcaa';
const GIT_RESOURCE_AREA_ID = '4e080c62-fa21-4fbc-8fef-2a10a2b38049';
const GIT_ITEMS_ID = 'fb93c0db-47ed-4a31-8c20-47552878fb44';
const GIT_ITERATION_CHANGES_ID = '4216bdcf-b6b1-4d59-8b82-c34cc183fc8b';
const GIT_ITERATIONS_ID = 'd43911ee-6958-46b0-a42b-8445b8a0d004';
const GIT_PULL_REQUEST_BY_ID_ID = '01a46dea-7d46-4d40-bc84-319e7c260d99';
const GIT_THREADS_ID = 'ab6e2e5d-a0b7-4153-b64a-a4efe0d49449';

export interface MockAdoRequest {
    method: string;
    path: string;
    query: URLSearchParams;
}

export interface MockAdoScenario {
    prs?: Map<number, GitPullRequest>;
    threads?: Map<number, GitPullRequestCommentThread[]>;
    iterations?: Map<number, GitPullRequestIteration[]>;
    changes?: Map<string, GitPullRequestChange[]>;
    files?: Map<string, string | Buffer | { status: number; body?: string | Buffer } | { reset: true }>;
    expectedRepositoryId?: string;
}

interface ParsedAdoPath {
    project: string;
    repositoryId?: string;
    pullRequestId?: number;
    iterationId?: number;
    resource?: 'iterations' | 'changes' | 'items' | 'pullRequestById' | 'threads';
}

export class MockAdoServer {
    private server?: http.Server;
    private scenario: Required<MockAdoScenario> = makeEmptyScenario();
    readonly requests: MockAdoRequest[] = [];

    get url(): string {
        const address = this.server?.address();
        if (!address || typeof address === 'string') {
            throw new Error('Mock ADO server has not been started');
        }
        return `http://127.0.0.1:${address.port}`;
    }

    setScenario(scenario: MockAdoScenario): void {
        this.scenario = {
            prs: scenario.prs ?? new Map(),
            threads: scenario.threads ?? new Map(),
            iterations: scenario.iterations ?? new Map(),
            changes: scenario.changes ?? new Map(),
            files: scenario.files ?? new Map(),
            expectedRepositoryId: scenario.expectedRepositoryId ?? '',
        };
        this.requests.length = 0;
    }

    async start(): Promise<void> {
        if (this.server) return;
        this.server = http.createServer((req, res) => this.handle(req, res));
        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(0, '127.0.0.1', () => {
                this.server!.off('error', reject);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        if (!server) return;
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url ?? '/', this.url);
        this.requests.push({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams });

        if (req.method === 'OPTIONS') {
            if (equalsIgnoreCase(url.pathname, '/_apis/location')) {
                sendJson(res, locationAreaLocations());
                return;
            }
            if (equalsIgnoreCase(url.pathname, '/_apis/git')) {
                sendJson(res, gitAreaLocations());
                return;
            }
        }

        if (req.method !== 'GET') {
            sendText(res, 405, 'method not allowed');
            return;
        }

        if (url.pathname.toLowerCase().endsWith('/_apis/location/resourceareas')) {
            sendJson(res, { count: 0, value: [] });
            return;
        }

        const parsed = parseAdoPath(url.pathname);
        if (!parsed) {
            sendText(res, 404, 'not found');
            return;
        }

        if (parsed.repositoryId && this.scenario.expectedRepositoryId && parsed.repositoryId !== this.scenario.expectedRepositoryId) {
            sendText(res, 404, `unexpected repository ${parsed.repositoryId}`);
            return;
        }

        switch (parsed.resource) {
            case 'pullRequestById': {
                const pr = this.scenario.prs.get(parsed.pullRequestId ?? 0);
                pr ? sendJson(res, pr) : sendText(res, 404, 'pull request not found');
                return;
            }
            case 'threads': {
                const threads = this.scenario.threads.get(parsed.pullRequestId ?? 0) ?? [];
                sendJson(res, threads);
                return;
            }
            case 'iterations': {
                const iterations = this.scenario.iterations.get(parsed.pullRequestId ?? 0) ?? [];
                sendJson(res, iterations);
                return;
            }
            case 'changes': {
                const key = changesKey(parsed.pullRequestId ?? 0, parsed.iterationId ?? 0);
                const entries = this.scenario.changes.get(key) ?? [];
                sendJson(res, { changeEntries: entries });
                return;
            }
            case 'items': {
                const path = url.searchParams.get('path') ?? '';
                const sha = url.searchParams.get('versionDescriptor.version') ?? '';
                const file = this.scenario.files.get(fileKey(sha, path));
                if (!file) {
                    sendText(res, 404, 'file not found');
                    return;
                }
                if (typeof file === 'object' && !Buffer.isBuffer(file) && 'status' in file) {
                    sendText(res, file.status, file.body ?? '');
                    return;
                }
                if (typeof file === 'object' && !Buffer.isBuffer(file) && 'reset' in file) {
                    req.socket.destroy();
                    return;
                }
                sendBody(res, 200, file, 'text/plain; charset=utf-8');
                return;
            }
            default:
                sendText(res, 404, 'not found');
        }
    }
}

export function changesKey(pullRequestId: number, iterationId: number): string {
    return `${pullRequestId}:${iterationId}`;
}

export function fileKey(commitId: string, path: string): string {
    return `${commitId}:${path}`;
}

function makeEmptyScenario(): Required<MockAdoScenario> {
    return {
        prs: new Map(),
        threads: new Map(),
        iterations: new Map(),
        changes: new Map(),
        files: new Map(),
        expectedRepositoryId: '',
    };
}

function parseAdoPath(pathname: string): ParsedAdoPath | undefined {
    const parts = pathname.split('/').filter(Boolean);
    const apisIndex = parts.findIndex(p => p.toLowerCase() === '_apis');
    if (apisIndex < 0 || parts[apisIndex + 1]?.toLowerCase() !== 'git') {
        return undefined;
    }

    const project = parts.slice(0, apisIndex).join('/');
    const gitParts = parts.slice(apisIndex + 2);

    if (gitParts[0]?.toLowerCase() === 'pullrequests') {
        return {
            project,
            pullRequestId: Number(gitParts[1]),
            resource: 'pullRequestById',
        };
    }

    if (gitParts[0]?.toLowerCase() !== 'repositories') {
        return undefined;
    }

    const repositoryId = decodeURIComponent(gitParts[1] ?? '');
    const resourceName = gitParts[2]?.toLowerCase();
    if (resourceName === 'items') {
        return { project, repositoryId, resource: 'items' };
    }

    if (resourceName !== 'pullrequests') {
        return undefined;
    }

    const pullRequestId = Number(gitParts[3]);
    const child = gitParts[4]?.toLowerCase();
    if (child === 'threads') {
        return { project, repositoryId, pullRequestId, resource: 'threads' };
    }
    if (child === 'iterations') {
        const iterationId = gitParts[5] ? Number(gitParts[5]) : undefined;
        if (gitParts[6]?.toLowerCase() === 'changes') {
            return { project, repositoryId, pullRequestId, iterationId, resource: 'changes' };
        }
        return { project, repositoryId, pullRequestId, iterationId, resource: 'iterations' };
    }
    return undefined;
}

function locationAreaLocations() {
    return {
        count: 1,
        value: [
            location(LOCATION_RESOURCE_AREAS_ID, 'Location', 'ResourceAreas', '_apis/{area}/{resource}/{areaId}', '7.2', 1),
        ],
    };
}

function gitAreaLocations() {
    return {
        count: 5,
        value: [
            location(GIT_ITEMS_ID, 'git', 'items', '{project}/_apis/{area}/repositories/{repositoryId}/items', '7.2', 1),
            location(GIT_ITERATION_CHANGES_ID, 'git', 'changes', '{project}/_apis/{area}/repositories/{repositoryId}/pullRequests/{pullRequestId}/iterations/{iterationId}/changes', '7.2', 1),
            location(GIT_ITERATIONS_ID, 'git', 'iterations', '{project}/_apis/{area}/repositories/{repositoryId}/pullRequests/{pullRequestId}/iterations/{iterationId}', '7.2', 2),
            location(GIT_PULL_REQUEST_BY_ID_ID, 'git', 'pullRequests', '{project}/_apis/{area}/pullRequests/{pullRequestId}', '7.2', 2),
            location(GIT_THREADS_ID, 'git', 'threads', '{project}/_apis/{area}/repositories/{repositoryId}/pullRequests/{pullRequestId}/threads/{threadId}', '7.2', 1),
        ],
    };
}

function location(id: string, area: string, resourceName: string, routeTemplate: string, version: string, resourceVersion: number) {
    return {
        id,
        area,
        resourceName,
        routeTemplate,
        maxVersion: version,
        releasedVersion: version,
        resourceVersion,
    };
}

function equalsIgnoreCase(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

function sendJson(res: http.ServerResponse, value: unknown): void {
    sendBody(res, 200, JSON.stringify(value), 'application/json; charset=utf-8');
}

function sendText(res: http.ServerResponse, status: number, value: string | Buffer): void {
    sendBody(res, status, value, 'text/plain; charset=utf-8');
}

function sendBody(res: http.ServerResponse, status: number, value: string | Buffer, contentType: string): void {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
    res.writeHead(status, {
        'content-type': contentType,
        'content-length': String(body.byteLength),
    });
    res.end(body);
}
