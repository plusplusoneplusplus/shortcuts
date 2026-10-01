import { execGitAsync } from '@plusplusoneplusplus/forge';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { badRequest, notFound } from '../errors';
import type { GitCacheService } from './git-cache';
import {
    createWorkingTreeContentIO,
    loadGitBlobFileContent,
    resolveWorkingTreePath,
    toRepoRelative,
    MAX_WORKING_TREE_CONTENT_BYTES,
} from './working-tree-file-content';
import type { GitBlobEntry, WorkingTreeFileContent, WorkingTreeContentIO } from './working-tree-file-content';

export interface RefFileChange {
    path: string;
    oldPath?: string;
}

function resolveContentPath(repoRoot: string, requestPath: string): string {
    const absPath = resolveWorkingTreePath(repoRoot, requestPath);
    if (!absPath || requestPath.includes('\0')) throw badRequest('Path is outside the workspace or invalid');
    return toRepoRelative(repoRoot, absPath);
}

/** NUL-delimited git output keeps spaces, tabs, newlines, and quoted filenames literal. */
export function parseRefFileChanges(output: string): RefFileChange[] {
    const fields = output.split('\0');
    const files: RefFileChange[] = [];
    for (let i = 0; i < fields.length && fields[i];) {
        const status = fields[i++];
        const firstPath = fields[i++];
        if (status.startsWith('R') || status.startsWith('C')) {
            files.push({ oldPath: firstPath, path: fields[i++] });
        } else {
            files.push({ path: firstPath });
        }
    }
    return files;
}

async function readTreeEntry(repoRoot: string, ref: string, filePath: string): Promise<GitBlobEntry | null> {
    if (!ref) return null;
    const output = await execGitAsync(
        ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', ref, '--', filePath],
        repoRoot,
    );
    for (const record of output.split('\0')) {
        const match = /^(\d{6}) \w+ ([0-9a-f]{40,64})\t([\s\S]*)$/.exec(record);
        if (match?.[3] === filePath) return { mode: match[1], sha: match[2] };
    }
    return null;
}

export async function loadRefFileContent(
    repoRoot: string,
    filePath: string,
    baseRef: string,
    headRef: string,
    change: RefFileChange,
): Promise<WorkingTreeFileContent> {
    const [baseEntry, headEntry] = await Promise.all([
        readTreeEntry(repoRoot, baseRef, change.oldPath ?? change.path),
        readTreeEntry(repoRoot, headRef, change.path),
    ]);
    return loadGitBlobFileContent(createWorkingTreeContentIO(repoRoot), filePath,
        { ref: baseRef, entry: baseEntry }, { ref: headRef, entry: headEntry });
}

export async function loadCommitFileDiffContent(
    repoRoot: string,
    workspaceId: string,
    hash: string,
    requestPath: string,
    cache: GitCacheService,
): Promise<WorkingTreeFileContent> {
    if (!/^[a-f0-9]{4,64}$/i.test(hash)) throw badRequest('Invalid commit hash');
    const filePath = resolveContentPath(repoRoot, requestPath);
    let ancestry: string;
    try {
        ancestry = await execGitAsync(['rev-list', '--parents', '-n', '1', hash, '--'], repoRoot);
    } catch (error) {
        if (error instanceof NativeAddonLoadError) throw error;
        throw badRequest('Failed to resolve commit hash');
    }
    const [headRef, baseRef = ''] = ancestry.trim().split(/\s+/);
    if (!headRef) throw notFound('Commit');
    const cacheKey = `${workspaceId}:commit-file-diff-content:${headRef}:${filePath}`;
    const cached = cache.get<WorkingTreeFileContent>(cacheKey);
    if (cached) return { ...cached, path: requestPath };

    const args = baseRef
        ? ['diff', '--name-status', '-z', '-M', '-C', baseRef, headRef, '--']
        : ['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '-M', '-C', headRef, '--'];
    const changes = parseRefFileChanges(await execGitAsync(args, repoRoot));
    const change = changes.find(file => file.path === filePath);
    if (!change) throw notFound('Changed commit file');
    const result = await loadRefFileContent(repoRoot, requestPath, baseRef, headRef, change);
    cache.set(cacheKey, result);
    return result;
}

export async function loadBranchRangeFileDiffContent(
    repoRoot: string,
    workspaceId: string,
    baseMode: 'default-branch' | 'upstream',
    baseRef: string,
    requestPath: string,
    cache: GitCacheService,
): Promise<WorkingTreeFileContent> {
    const filePath = resolveContentPath(repoRoot, requestPath);
    const headRef = (await execGitAsync(['rev-parse', '--verify', 'HEAD^{commit}'], repoRoot)).trim();
    const mergeBase = (await execGitAsync(['merge-base', baseRef, headRef], repoRoot)).trim();
    const prefix = `${workspaceId}:branch-range-file-diff-content:${baseMode}:${filePath}:`;
    const cacheKey = `${prefix}${mergeBase}:${headRef}`;
    const cached = cache.get<WorkingTreeFileContent>(cacheKey);
    if (cached) return {
        ...cached, path: requestPath,
        modifiedMatchesWorkingCopy: await branchRangeMatchesWorkingCopy(repoRoot, filePath, cached),
    };

    const changes = parseRefFileChanges(await execGitAsync(
        ['diff', '--name-status', '-z', '-M', '-C', mergeBase, headRef, '--'], repoRoot,
    ));
    const change = changes.find(file => file.path === filePath);
    if (!change) throw notFound('Changed branch-range file');
    const result = await loadRefFileContent(repoRoot, requestPath, mergeBase, headRef, change);
    cache.deletePrefix(prefix);
    cache.set(cacheKey, result);
    return { ...result, modifiedMatchesWorkingCopy: await branchRangeMatchesWorkingCopy(repoRoot, filePath, result) };
}

/** Eligibility is live workspace state, not part of the immutable snapshot cache. */
export async function branchRangeMatchesWorkingCopy(
    repoRoot: string,
    filePath: string,
    content: WorkingTreeFileContent,
    io: WorkingTreeContentIO = createWorkingTreeContentIO(repoRoot),
): Promise<boolean> {
    if (content.binary || content.tooLarge || !content.head.exists) return false;
    if (await io.resolveHead() !== content.head.ref) return false;
    const absPath = resolveWorkingTreePath(repoRoot, filePath);
    if (!absPath) throw badRequest('Path is outside the workspace or invalid');
    const disk = await io.statDisk(absPath);
    if (!disk?.isFile || disk.size > MAX_WORKING_TREE_CONTENT_BYTES) return false;
    const bytes = await io.readDisk(absPath);
    if (!bytes.equals(Buffer.from(content.head.content, 'utf8'))) return false;
    const changes = await execGitAsync([
        '--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=no', '--', filePath,
    ], repoRoot);
    return changes.length === 0 && await io.resolveHead() === content.head.ref;
}
