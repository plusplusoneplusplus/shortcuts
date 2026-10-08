import * as childProcess from 'child_process';
import * as path from 'path';
import { execGitAsync, parseFullDiffAsync, ProviderType } from '@plusplusoneplusplus/forge';
import type { ProviderPullRequest } from '@plusplusoneplusplus/forge';
import { badRequest, notFound } from '../errors';
import { ProviderFactory } from '../providers/provider-factory';
import { loadRefFileContent, parseRefFileChanges } from './ref-file-content';
import {
    isBinaryBuffer,
    MAX_WORKING_TREE_CONTENT_BYTES,
    resolveWorkingTreePath,
    toRepoRelative,
} from './working-tree-file-content';
import type { WorkingTreeFileContent, WorkingTreeFileSide } from './working-tree-file-content';

const CLI_MAX_BUFFER = MAX_WORKING_TREE_CONTENT_BYTES * 2 + 2 * 1024 * 1024;

export interface PullRequestFileCliResult {
    stdout: Buffer | string;
    stderr: Buffer | string;
}

export type PullRequestFileCliRunner = (
    command: string,
    args: string[],
    options: { cwd: string },
) => Promise<PullRequestFileCliResult>;

export interface PullRequestFileContentRequest {
    repoRoot: string;
    remoteUrl: string;
    originId: string;
    prId: string;
    filePath: string;
    pullRequest: ProviderPullRequest;
    getProviderDiff: () => Promise<string>;
    runCommand?: PullRequestFileCliRunner;
}

export type PullRequestFileContentFailureCode =
    | 'missing-pr-shas'
    | 'provider-not-supported'
    | 'content-unavailable';

export class PullRequestFileContentError extends Error {
    constructor(
        readonly code: PullRequestFileContentFailureCode,
        message: string,
    ) {
        super(message);
        this.name = 'PullRequestFileContentError';
    }
}

interface ProviderFileContent {
    bytes: Buffer;
    binary: boolean;
}

const contentCache = new Map<string, WorkingTreeFileContent>();

export function clearPullRequestFileContentCache(): void {
    contentCache.clear();
}

function isMissingObjectError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('bad object')
        || message.includes('unknown revision')
        || message.includes('invalid object')
        || message.includes('not a valid object name')
        || message.includes('needed a single revision');
}

function resolveFilePath(repoRoot: string, requestPath: string): string {
    const absolutePath = resolveWorkingTreePath(repoRoot, requestPath);
    if (!absolutePath || requestPath.includes('\0')) {
        throw badRequest('Path is outside the workspace or invalid');
    }
    return toRepoRelative(repoRoot, absolutePath);
}

async function loadFromLocalObjects(
    repoRoot: string,
    requestPath: string,
    filePath: string,
    baseSha: string,
    headSha: string,
): Promise<WorkingTreeFileContent | null> {
    try {
        const output = await execGitAsync(
            ['diff', '--name-status', '-z', '-M', '-C', baseSha, headSha, '--'],
            repoRoot,
        );
        const change = parseRefFileChanges(output).find(item => item.path === filePath);
        if (!change) throw notFound('Changed pull-request file');
        return await loadRefFileContent(repoRoot, requestPath, baseSha, headSha, change);
    } catch (error) {
        if (isMissingObjectError(error)) return null;
        throw error;
    }
}

function bufferOf(value: Buffer | string): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

export function defaultPullRequestFileCliRunner(
    command: string,
    args: string[],
    options: { cwd: string },
): Promise<PullRequestFileCliResult> {
    const [file, fileArgs] = command === 'az' && process.platform === 'win32'
        ? [process.env.ComSpec?.trim() || 'cmd.exe', ['/d', '/s', '/c', 'az', ...args]]
        : [command, args];
    return new Promise((resolve, reject) => {
        childProcess.execFile(file, fileArgs, {
            cwd: options.cwd,
            encoding: 'buffer',
            maxBuffer: CLI_MAX_BUFFER,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout: stdout ?? Buffer.alloc(0), stderr: stderr ?? Buffer.alloc(0) });
        });
    });
}

async function fetchGitHubFile(
    remoteUrl: string,
    repoRoot: string,
    ref: string,
    filePath: string,
    run: PullRequestFileCliRunner,
): Promise<ProviderFileContent> {
    const repo = ProviderFactory.parseGitHubRemote(remoteUrl);
    if (!repo) throw new PullRequestFileContentError('provider-not-supported', 'Cannot parse GitHub repository remote');
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const endpoint = `repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${encodedPath}`;
    const result = await run('gh', [
        'api', endpoint,
        '--method', 'GET',
        '--raw-field', `ref=${ref}`,
        '--header', 'Accept: application/vnd.github.raw+json',
    ], { cwd: repoRoot });
    const bytes = bufferOf(result.stdout);
    return { bytes, binary: isBinaryBuffer(bytes) };
}

interface AdoGitItemResponse {
    content?: unknown;
    isSymLink?: unknown;
    contentMetadata?: { isBinary?: unknown };
}

async function fetchAdoFile(
    remoteUrl: string,
    repoRoot: string,
    ref: string,
    filePath: string,
    run: PullRequestFileCliRunner,
): Promise<ProviderFileContent> {
    const repo = ProviderFactory.parseAdoRemote(remoteUrl);
    if (!repo) throw new PullRequestFileContentError('provider-not-supported', 'Cannot parse Azure DevOps repository remote');
    const result = await run('az', [
        'devops', 'invoke',
        '--organization', repo.orgUrl,
        '--area', 'git',
        '--resource', 'items',
        '--route-parameters', `project=${repo.project}`, `repositoryId=${repo.repo}`,
        '--query-parameters', `path=/${filePath}`, 'includeContent=true', 'includeContentMetadata=true',
        `versionDescriptor.version=${ref}`, 'versionDescriptor.versionType=commit',
        '--api-version', '7.1',
        '--output', 'json',
    ], { cwd: repoRoot });
    let parsed: AdoGitItemResponse;
    try {
        parsed = JSON.parse(bufferOf(result.stdout).toString('utf8')) as AdoGitItemResponse;
    } catch {
        throw new PullRequestFileContentError('content-unavailable', 'Azure DevOps returned an invalid file-content response');
    }
    if (typeof parsed.content !== 'string') {
        throw new PullRequestFileContentError('content-unavailable', 'Azure DevOps did not return file content');
    }
    const bytes = Buffer.from(parsed.content, 'utf8');
    return {
        bytes,
        binary: parsed.isSymLink === true || parsed.contentMetadata?.isBinary === true || isBinaryBuffer(bytes),
    };
}

function fetchProviderFile(
    provider: ProviderType,
    remoteUrl: string,
    repoRoot: string,
    ref: string,
    filePath: string,
    run: PullRequestFileCliRunner,
): Promise<ProviderFileContent> {
    if (provider === ProviderType.GitHub) {
        return fetchGitHubFile(remoteUrl, repoRoot, ref, filePath, run);
    }
    if (provider === ProviderType.ADO) {
        return fetchAdoFile(remoteUrl, repoRoot, ref, filePath, run);
    }
    throw new PullRequestFileContentError('provider-not-supported', 'Pull request file content is not supported for this remote');
}

function buildProviderResult(
    requestPath: string,
    baseSha: string,
    headSha: string,
    base: ProviderFileContent | null,
    head: ProviderFileContent | null,
): WorkingTreeFileContent {
    const side = (ref: string, value: ProviderFileContent | null): WorkingTreeFileSide => ({
        content: value?.bytes.toString('utf8') ?? '',
        ref,
        exists: value !== null,
    });
    const tooLarge = (base?.bytes.length ?? 0) > MAX_WORKING_TREE_CONTENT_BYTES
        || (head?.bytes.length ?? 0) > MAX_WORKING_TREE_CONTENT_BYTES;
    const binary = !tooLarge && (base?.binary === true || head?.binary === true);
    const result: WorkingTreeFileContent = {
        path: requestPath,
        fileName: path.basename(requestPath),
        language: path.extname(requestPath).replace(/^\./, '').toLowerCase(),
        base: side(baseSha, base),
        head: side(headSha, head),
        binary,
        tooLarge,
    };
    if (binary || tooLarge) {
        result.base.content = '';
        result.head.content = '';
    }
    return result;
}

async function loadFromProvider(
    request: PullRequestFileContentRequest,
    filePath: string,
    baseSha: string,
    headSha: string,
): Promise<WorkingTreeFileContent> {
    let diff: string;
    try {
        diff = await request.getProviderDiff();
    } catch (error) {
        throw new PullRequestFileContentError(
            'content-unavailable',
            `Pull request file metadata is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const file = (await parseFullDiffAsync(diff)).files.find(item => item.path === filePath);
    if (!file) throw notFound('Changed pull-request file');
    const provider = ProviderFactory.detectProviderType(request.remoteUrl);
    if (!provider) {
        throw new PullRequestFileContentError('provider-not-supported', 'Pull request file content is not supported for this remote');
    }
    const run = request.runCommand ?? defaultPullRequestFileCliRunner;
    try {
        const [base, head] = await Promise.all([
            file.status === 'added'
                ? Promise.resolve(null)
                : fetchProviderFile(provider, request.remoteUrl, request.repoRoot, baseSha, file.originalPath ?? filePath, run),
            file.status === 'deleted'
                ? Promise.resolve(null)
                : fetchProviderFile(provider, request.remoteUrl, request.repoRoot, headSha, filePath, run),
        ]);
        return buildProviderResult(request.filePath, baseSha, headSha, base, head);
    } catch (error) {
        if (error instanceof PullRequestFileContentError) throw error;
        throw new PullRequestFileContentError(
            'content-unavailable',
            `Pull request file content is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function loadPullRequestFileContent(
    request: PullRequestFileContentRequest,
): Promise<WorkingTreeFileContent> {
    const baseSha = request.pullRequest.baseSha?.trim();
    const headSha = request.pullRequest.headSha?.trim();
    if (!baseSha || !headSha) {
        throw new PullRequestFileContentError('missing-pr-shas', 'Pull request base and head SHAs are required');
    }
    const filePath = resolveFilePath(request.repoRoot, request.filePath);
    const cacheKey = `${request.originId}|${request.prId}|${headSha}|${filePath}`;
    const cached = contentCache.get(cacheKey);
    if (cached) return { ...cached, path: request.filePath };

    const local = await loadFromLocalObjects(
        request.repoRoot,
        request.filePath,
        filePath,
        baseSha,
        headSha,
    );
    const result = local ?? await loadFromProvider(request, filePath, baseSha, headSha);
    contentCache.set(cacheKey, result);
    return result;
}
