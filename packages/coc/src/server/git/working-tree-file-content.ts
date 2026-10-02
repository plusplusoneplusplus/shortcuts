/**
 * Both full-text sides of one working-tree file, for the Monaco diff viewer.
 *
 * - `unstaged`  → base = `HEAD:<path>`, head = the file on disk
 * - `staged`    → base = `HEAD:<path>`, head = the index (`:<path>`)
 * - `untracked` → base = nothing,       head = the file on disk
 *
 * Content is returned exactly as stored: no line-ending normalization and no
 * trailing-newline trimming on either side, so the two sides can never
 * disagree about the last line because of how they were read.
 *
 * Every git and filesystem read goes through {@link WorkingTreeContentIO} so
 * the resolution rules are testable without a repository.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildWslCommandArgs,
    execGitAsync,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
} from '@plusplusoneplusplus/forge';
import type { GitCacheService } from './git-cache';

export type WorkingTreeContentStage = 'staged' | 'unstaged' | 'untracked';

export const WORKING_TREE_CONTENT_STAGES: readonly WorkingTreeContentStage[] = ['staged', 'unstaged', 'untracked'];

/** Same guard as the commit file-content route. */
export const MAX_WORKING_TREE_CONTENT_BYTES = 10 * 1024 * 1024;

/** Git's own binary heuristic looks for a NUL in the first 8000 bytes. */
const BINARY_SNIFF_BYTES = 8000;

/** Literal `ref` for a side read from the index. */
export const INDEX_REF = 'INDEX';
/** Literal `ref` for a side read from disk. */
export const WORKTREE_REF = 'WORKTREE';

const GIT_MODE_SYMLINK = '120000';
const GIT_MODE_SUBMODULE = '160000';

export interface WorkingTreeFileSide {
    content: string;
    /** Resolved HEAD hash, `INDEX`, `WORKTREE`, or `''` when there is no ref at all. */
    ref: string;
    exists: boolean;
}

export interface WorkingTreeFileContent {
    path: string;
    fileName: string;
    language: string;
    base: WorkingTreeFileSide;
    head: WorkingTreeFileSide;
    binary: boolean;
    tooLarge: boolean;
    /** Branch-range head equals HEAD, the index, and the exact bytes on disk. */
    modifiedMatchesWorkingCopy?: boolean;
}

/** One entry from `git ls-tree` / `git ls-files -s`. */
export interface GitBlobEntry {
    mode: string;
    sha: string;
}

export interface DiskEntry {
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    isFile: boolean;
}

export interface WorkingTreeContentIO {
    /** HEAD's commit hash, or `null` in a repository with no commits. */
    resolveHead(): Promise<string | null>;
    /** The blob HEAD records for `relPath`, or `null`. */
    headEntry(relPath: string): Promise<GitBlobEntry | null>;
    /** The stage-0 index entry for `relPath`, or `null`. */
    indexEntry(relPath: string): Promise<GitBlobEntry | null>;
    blobSize(sha: string): Promise<number>;
    readBlob(sha: string): Promise<Buffer>;
    /** `lstat` of the file; `null` when it does not exist. Symlinks are not followed. */
    statDisk(absPath: string): Promise<DiskEntry | null>;
    readDisk(absPath: string): Promise<Buffer>;
}

export interface WorkingTreeContentRequest {
    /** Path as the caller spelled it; echoed back in the response. */
    requestPath: string;
    /** Absolute path of the file (the change list's `filePath`). */
    absPath: string;
    /** Absolute path the base side is read from — differs from `absPath` for a staged rename. */
    baseAbsPath: string;
    repoRoot: string;
    stage: WorkingTreeContentStage;
}

/** Repository-relative, forward-slash path — the spelling git's pathspecs and tree lookups take. */
export function toRepoRelative(repoRoot: string, absPath: string): string {
    return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

/**
 * Resolve a caller-supplied path against the workspace root.
 * Returns `null` for a path that escapes the root or names the root itself.
 */
export function resolveWorkingTreePath(repoRoot: string, filePath: string): string | null {
    const absPath = path.isAbsolute(filePath) ? path.normalize(filePath) : path.join(repoRoot, filePath);
    const rel = path.relative(repoRoot, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return absPath;
}

export function languageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ext.startsWith('.') ? ext.slice(1) : ext;
}

export function isBinaryBuffer(buf: Buffer): boolean {
    const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < end; i++) {
        if (buf[i] === 0) return true;
    }
    return false;
}

const MISSING_SIDE = (ref: string): WorkingTreeFileSide => ({ content: '', ref, exists: false });

type SideSource =
    | { kind: 'missing'; ref: string }
    | { kind: 'blob'; ref: string; entry: GitBlobEntry }
    | { kind: 'disk'; absPath: string; disk: DiskEntry };

interface ResolvedSources {
    base: SideSource;
    head: SideSource;
    /** Identifies the exact bytes both sides resolve to; changes whenever either side does. */
    fingerprint: string;
}

async function resolveSources(io: WorkingTreeContentIO, req: WorkingTreeContentRequest): Promise<ResolvedSources> {
    let base: SideSource;
    if (req.stage === 'untracked') {
        base = { kind: 'missing', ref: '' };
    } else {
        const headSha = await io.resolveHead();
        const entry = headSha ? await io.headEntry(toRepoRelative(req.repoRoot, req.baseAbsPath)) : null;
        base = entry ? { kind: 'blob', ref: headSha!, entry } : { kind: 'missing', ref: headSha ?? '' };
    }

    let head: SideSource;
    if (req.stage === 'staged') {
        const entry = await io.indexEntry(toRepoRelative(req.repoRoot, req.absPath));
        head = entry ? { kind: 'blob', ref: INDEX_REF, entry } : { kind: 'missing', ref: INDEX_REF };
    } else {
        const disk = await io.statDisk(req.absPath);
        head = disk ? { kind: 'disk', absPath: req.absPath, disk } : { kind: 'missing', ref: WORKTREE_REF };
    }

    const part = (s: SideSource): string => {
        switch (s.kind) {
            case 'missing': return `none@${s.ref}`;
            case 'blob': return `${s.entry.mode}:${s.entry.sha}@${s.ref}`;
            case 'disk': return `disk:${s.disk.size}:${s.disk.mtimeMs}:${s.disk.ctimeMs}:${s.disk.isFile ? 'f' : 'x'}`;
        }
    };
    return { base, head, fingerprint: `${part(base)}|${part(head)}` };
}

/** A side git or the filesystem cannot hand over as text: symlinks, submodules, directories. */
function isUnrenderable(s: SideSource): boolean {
    if (s.kind === 'blob') return s.entry.mode === GIT_MODE_SYMLINK || s.entry.mode === GIT_MODE_SUBMODULE;
    if (s.kind === 'disk') return !s.disk.isFile;
    return false;
}

async function sizeOf(io: WorkingTreeContentIO, s: SideSource): Promise<number> {
    if (s.kind === 'blob') return io.blobSize(s.entry.sha);
    if (s.kind === 'disk') return s.disk.size;
    return 0;
}

async function bytesOf(io: WorkingTreeContentIO, s: SideSource): Promise<Buffer> {
    if (s.kind === 'blob') return io.readBlob(s.entry.sha);
    if (s.kind === 'disk') return io.readDisk(s.absPath);
    return Buffer.alloc(0);
}

function sideRef(s: SideSource): string {
    return s.kind === 'disk' ? WORKTREE_REF : s.ref;
}

async function buildContent(
    io: WorkingTreeContentIO,
    req: Pick<WorkingTreeContentRequest, 'requestPath' | 'absPath'>,
    sources: Pick<ResolvedSources, 'base' | 'head'>,
): Promise<WorkingTreeFileContent> {
    const { base, head } = sources;
    const shell = {
        path: req.requestPath,
        fileName: path.basename(req.absPath),
        language: languageFromPath(req.absPath),
    };
    const withoutContent = (flags: { binary: boolean; tooLarge: boolean }): WorkingTreeFileContent => ({
        ...shell,
        base: { content: '', ref: sideRef(base), exists: base.kind !== 'missing' },
        head: { content: '', ref: sideRef(head), exists: head.kind !== 'missing' },
        ...flags,
    });

    if (isUnrenderable(base) || isUnrenderable(head)) {
        return withoutContent({ binary: true, tooLarge: false });
    }

    // Sizes first, so an oversized side is never read into memory.
    const [baseSize, headSize] = await Promise.all([sizeOf(io, base), sizeOf(io, head)]);
    if (baseSize > MAX_WORKING_TREE_CONTENT_BYTES || headSize > MAX_WORKING_TREE_CONTENT_BYTES) {
        return withoutContent({ binary: false, tooLarge: true });
    }

    const [baseBytes, headBytes] = await Promise.all([bytesOf(io, base), bytesOf(io, head)]);
    if (isBinaryBuffer(baseBytes) || isBinaryBuffer(headBytes)) {
        return withoutContent({ binary: true, tooLarge: false });
    }

    return {
        ...shell,
        base: base.kind === 'missing' ? MISSING_SIDE(base.ref) : { content: baseBytes.toString('utf-8'), ref: sideRef(base), exists: true },
        head: head.kind === 'missing' ? MISSING_SIDE(head.ref) : { content: headBytes.toString('utf-8'), ref: sideRef(head), exists: true },
        binary: false,
        tooLarge: false,
    };
}

/** Full-text git snapshots use the same byte, size, and unsupported-mode rules as working-tree files. */
export function loadGitBlobFileContent(
    io: WorkingTreeContentIO,
    filePath: string,
    base: { ref: string; entry: GitBlobEntry | null },
    head: { ref: string; entry: GitBlobEntry | null },
): Promise<WorkingTreeFileContent> {
    const source = (side: typeof base): SideSource => side.entry
        ? { kind: 'blob', ref: side.ref, entry: side.entry }
        : { kind: 'missing', ref: side.ref };
    return buildContent(io, { requestPath: filePath, absPath: filePath }, {
        base: source(base),
        head: source(head),
    });
}

/**
 * Read both sides of a working-tree file.
 *
 * With a cache, entries are keyed on a fingerprint of the blob ids and disk
 * `lstat` the sides resolve to, so a disk edit, a re-stage, or a new HEAD
 * misses. At most one entry per (workspace, stage, file) is kept: a new
 * fingerprint evicts the stale one rather than accumulating content.
 */
export async function loadWorkingTreeFileContent(
    io: WorkingTreeContentIO,
    req: WorkingTreeContentRequest,
    cache?: { service: GitCacheService; workspaceId: string },
): Promise<WorkingTreeFileContent> {
    const sources = await resolveSources(io, req);
    if (!cache) return buildContent(io, req, sources);

    const prefix = `${cache.workspaceId}:wt-file-content:${req.stage}:${req.absPath}:`;
    const key = `${prefix}${sources.fingerprint}`;
    const cached = cache.service.get<WorkingTreeFileContent>(key);
    if (cached) return { ...cached, path: req.requestPath };

    const result = await buildContent(io, req, sources);
    cache.service.deletePrefix(prefix);
    cache.service.set(key, result);
    return result;
}

// ============================================================================
// Default IO — real git and filesystem
// ============================================================================

const GIT_TIMEOUT_MS = 10_000;

function parseLsTreeLine(line: string): GitBlobEntry | null {
    // `<mode> <type> <sha>\t<path>`
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t/.exec(line);
    return m ? { mode: m[1], sha: m[3] } : null;
}

function parseLsFilesStageLine(line: string): GitBlobEntry | null {
    // `<mode> <sha> <stage>\t<path>` — only stage 0 is the index proper; 1–3 are conflict stages.
    const m = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t/.exec(line);
    return m && m[3] === '0' ? { mode: m[1], sha: m[2] } : null;
}

/**
 * `git cat-file blob <sha>` with stdout kept as bytes.
 *
 * `execGitAsync` trims its output and the native addon can only read blobs
 * reachable from a commit, so an index blob with meaningful leading or
 * trailing whitespace needs its own untrimmed runner. WSL repositories run
 * the same command through `wsl.exe`.
 */
function execFileBytes(file: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile(
            file,
            args,
            { encoding: 'buffer', maxBuffer: MAX_WORKING_TREE_CONTENT_BYTES + 1024, timeout: GIT_TIMEOUT_MS, windowsHide: true },
            (error, stdout, stderr) => {
                if (error) {
                    const detail = stderr?.toString().trim();
                    reject(new Error(`git cat-file failed${detail ? `: ${detail}` : ''}`));
                } else {
                    resolve(stdout);
                }
            },
        );
    });
}

async function readBlobBytes(repoRoot: string, sha: string): Promise<Buffer> {
    const ctx = resolveWorkspaceExecutionContext(repoRoot);
    if (ctx.kind === 'wsl') {
        const execRoot = translatePathForExecution(repoRoot, ctx);
        return execFileBytes(getWslExecutablePath(), buildWslCommandArgs(ctx, ['git', '-C', execRoot, 'cat-file', 'blob', sha]));
    }
    return execFileBytes('git', ['-C', repoRoot, 'cat-file', 'blob', sha]);
}

export function createWorkingTreeContentIO(repoRoot: string): WorkingTreeContentIO {
    const git = (args: string[]) => execGitAsync(args, repoRoot, { timeout: GIT_TIMEOUT_MS });
    return {
        async resolveHead() {
            try {
                const sha = (await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).trim();
                return sha || null;
            } catch {
                return null;
            }
        },
        async headEntry(relPath) {
            const out = await git(['ls-tree', '--full-tree', 'HEAD', '--', relPath]);
            return out ? parseLsTreeLine(out.split('\n')[0]) : null;
        },
        async indexEntry(relPath) {
            const out = await git(['--literal-pathspecs', 'ls-files', '-s', '--', relPath]);
            for (const line of out.split('\n')) {
                const entry = parseLsFilesStageLine(line);
                if (entry) return entry;
            }
            return null;
        },
        async blobSize(sha) {
            return parseInt((await git(['cat-file', '-s', sha])).trim(), 10);
        },
        readBlob(sha) {
            return readBlobBytes(repoRoot, sha);
        },
        async statDisk(absPath) {
            try {
                const st = await fs.promises.lstat(absPath);
                return { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, isFile: st.isFile() };
            } catch {
                return null;
            }
        },
        readDisk(absPath) {
            return fs.promises.readFile(absPath);
        },
    };
}

export const __test__ = { parseLsTreeLine, parseLsFilesStageLine };
