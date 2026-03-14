import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import type { WorkspaceInfo } from '@plusplusoneplusplus/pipeline-core';
import type { RepoInfo, TreeEntry, TreeListResult } from './types';

export interface RepoTreeServiceOptions {
    /**
     * Maximum entries returned per directory listing.
     * Listings exceeding this are truncated and `truncated: true` is set.
     * Default: 5000.
     */
    maxEntries?: number;
}

/** Extension → MIME type map for common file types. */
const MIME_MAP: Record<string, string> = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.cjs': 'application/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.jsx': 'application/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.toml': 'application/toml',
    '.sh': 'application/x-sh',
    '.bash': 'application/x-sh',
    '.py': 'text/x-python',
    '.rb': 'text/x-ruby',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.java': 'text/x-java',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.h': 'text/x-c',
    '.hpp': 'text/x-c++',
    '.cs': 'text/x-csharp',
    '.swift': 'text/x-swift',
    '.kt': 'text/x-kotlin',
    '.scala': 'text/x-scala',
    '.php': 'text/x-php',
    '.sql': 'application/sql',
    '.graphql': 'application/graphql',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.env': 'text/plain',
    '.log': 'text/plain',
    '.csv': 'text/csv',
    '.lock': 'text/plain',
};

/** Maximum file size for readBlob (1 MB). */
const MAX_BLOB_SIZE = 1 * 1024 * 1024;

/** Number of bytes to scan for binary detection. */
const BINARY_PROBE_SIZE = 8192;

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Returns true if the buffer likely represents binary content
 * (contains null bytes in the first 8 KB).
 */
function isBinary(buffer: Buffer): boolean {
    const limit = Math.min(buffer.length, BINARY_PROBE_SIZE);
    for (let i = 0; i < limit; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

/**
 * Strips leading path separators so that absolute-looking relative paths
 * (e.g. "/" or "/src") are treated as repo-relative instead of filesystem root.
 */
function stripLeadingSeparators(p: string): string {
    return p.replace(/^[/\\]+/, '') || '.';
}

/**
 * Validates that resolvedPath is inside repoRoot (path traversal guard).
 * Throws if the path escapes the repo root.
 */
function assertInsideRepo(repoRoot: string, resolvedPath: string): void {
    const normalizedRoot = path.resolve(repoRoot);
    const normalizedTarget = path.resolve(resolvedPath);
    if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
        throw new Error(`Path traversal detected: path escapes repo root`);
    }
}

/**
 * Runs `git check-ignore --stdin` to determine which entries are gitignored.
 * Accepts entries as { name, isDir } pairs relative to `dirPath`.
 * Returns a Set of entry names that are ignored.
 * Falls back to an empty set if git is unavailable or the directory is not a git repo.
 */
function getGitIgnoredNames(
    repoRoot: string,
    dirPath: string,
    entries: Array<{ name: string; isDir: boolean }>,
): Set<string> {
    if (entries.length === 0) return new Set();
    try {
        // Build relative paths from repoRoot, using forward slashes.
        // Directories get a trailing '/' so that gitignore patterns like "dist/" match.
        const relDir = path.relative(repoRoot, dirPath).split(path.sep).join('/');
        const lines: string[] = [];
        const nameByLine: string[] = [];
        for (const entry of entries) {
            const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
            lines.push(entry.isDir ? `${rel}/` : rel);
            nameByLine.push(entry.name);
        }
        const input = lines.join('\n') + '\n';
        const stdout = childProcess.execSync('git check-ignore --stdin', {
            input,
            cwd: repoRoot,
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Parse output — each ignored line corresponds to the input path.
        // git outputs the matched paths (with possible trailing '/').
        const ignoredPaths = new Set<string>();
        for (const line of stdout.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) ignoredPaths.add(trimmed.replace(/\/$/, ''));
        }
        // Map back to entry names
        const ignoredNames = new Set<string>();
        for (let i = 0; i < lines.length; i++) {
            const cleanLine = lines[i].replace(/\/$/, '');
            if (ignoredPaths.has(cleanLine)) {
                ignoredNames.add(nameByLine[i]);
            }
        }
        return ignoredNames;
    } catch {
        // git not available, not a git repo, or empty input — treat nothing as ignored
        return new Set();
    }
}

export class RepoTreeService {
    private readonly maxEntries: number;
    private readonly dataDir: string;

    constructor(dataDir: string, options?: RepoTreeServiceOptions) {
        this.dataDir = dataDir;
        this.maxEntries = options?.maxEntries ?? 5000;
    }

    /**
     * List all registered repos from workspaces.json.
     * @returns Array of RepoInfo with headSha resolved from git.
     */
    async listRepos(): Promise<RepoInfo[]> {
        const workspaces = await this.readWorkspaces();
        return workspaces.map(ws => RepoTreeService.toRepoInfo(ws));
    }

    /**
     * Resolve a repo by ID. Returns undefined if not found.
     */
    async resolveRepo(repoId: string): Promise<RepoInfo | undefined> {
        const workspaces = await this.readWorkspaces();
        const ws = workspaces.find(w => w.id === repoId);
        return ws ? RepoTreeService.toRepoInfo(ws) : undefined;
    }

    /**
     * List the contents of `relativePath` inside the repo identified by `repoId`.
     *
     * @param repoId       Stable workspace ID.
     * @param relativePath Path relative to repo root ('.' or '' = root).
     * @param options      Optional listing options.
     * @returns TreeListResult with entries (dirs-first, alpha-sorted), or throws if
     *          path is outside repo root (traversal guard) or does not exist.
     */
    async listDirectory(
        repoId: string,
        relativePath: string,
        options?: { showIgnored?: boolean },
    ): Promise<TreeListResult> {
        const repo = await this.resolveRepo(repoId);
        if (!repo) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const repoRoot = repo.localPath;
        const normalizedRel = stripLeadingSeparators(relativePath === '' || relativePath === '.' ? '.' : relativePath);
        const absPath = path.resolve(repoRoot, normalizedRel);
        assertInsideRepo(repoRoot, absPath);

        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(absPath);
        } catch {
            throw new Error(`Path does not exist: ${relativePath}`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`Not a directory: ${relativePath}`);
        }

        const dirents = await fs.promises.readdir(absPath, { withFileTypes: true });

        // Resolve symlinks and filter out broken ones
        const resolvedEntries: { dirent: fs.Dirent; isDir: boolean }[] = [];
        for (const dirent of dirents) {
            const fullPath = path.join(absPath, dirent.name);
            if (dirent.isSymbolicLink()) {
                try {
                    const targetStat = await fs.promises.stat(fullPath);
                    resolvedEntries.push({ dirent, isDir: targetStat.isDirectory() });
                } catch {
                    // Broken symlink — skip
                    continue;
                }
            } else {
                resolvedEntries.push({ dirent, isDir: dirent.isDirectory() });
            }
        }

        // Gitignore filtering
        const showIgnored = options?.showIgnored ?? false;
        let filteredEntries = resolvedEntries;
        if (!showIgnored) {
            const entryInfos = resolvedEntries.map(e => ({ name: e.dirent.name, isDir: e.isDir }));
            const ignoredNames = getGitIgnoredNames(repoRoot, absPath, entryInfos);
            if (ignoredNames.size > 0) {
                filteredEntries = resolvedEntries.filter(e => !ignoredNames.has(e.dirent.name));
            }
        }

        // Sort: dirs first, then alphabetical
        filteredEntries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.dirent.name.localeCompare(b.dirent.name);
        });

        // Size guard
        const truncated = filteredEntries.length > this.maxEntries;
        const sliced = truncated ? filteredEntries.slice(0, this.maxEntries) : filteredEntries;

        // Build TreeEntry[]
        const entries: TreeEntry[] = [];
        for (const { dirent, isDir } of sliced) {
            const fullPath = path.join(absPath, dirent.name);
            const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
            let size: number | undefined;
            if (!isDir) {
                try {
                    const fileStat = await fs.promises.stat(fullPath);
                    size = fileStat.size;
                } catch {
                    // Broken symlink or permission error — size stays undefined
                }
            }
            entries.push({
                name: dirent.name,
                type: isDir ? 'dir' : 'file',
                size,
                path: relPath,
            });
        }

        return { entries, truncated };
    }

    /**
     * List the contents of `relativePath` to the given depth.
     * depth=1 returns the same flat TreeListResult as listDirectory().
     * depth>1 populates `children` on directory entries recursively.
     * Truncated directories are not recursed into.
     */
    async listDirectoryDeep(
        repoId: string,
        relativePath: string,
        depth: number,
        options?: { showIgnored?: boolean },
    ): Promise<TreeListResult> {
        const result = await this.listDirectory(repoId, relativePath, options);
        if (depth <= 1) {
            return result;
        }
        for (const entry of result.entries) {
            if (entry.type === 'dir' && !result.truncated) {
                const child = await this.listDirectoryDeep(repoId, entry.path, depth - 1, options);
                entry.children = child.entries;
            }
        }
        return result;
    }

    /**
     * Recursively list all files under `relativePath` inside the repo.
     * Returns a flat array of relative paths (files only, no directories).
     * Respects gitignore unless `showIgnored` is set. Capped by `maxEntries`.
     */
    async listFilesRecursive(
        repoId: string,
        relativePath: string,
        options?: { showIgnored?: boolean },
    ): Promise<{ files: string[]; truncated: boolean }> {
        const repo = await this.resolveRepo(repoId);
        if (!repo) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const repoRoot = repo.localPath;
        const normalizedRel = stripLeadingSeparators(relativePath === '' || relativePath === '.' ? '.' : relativePath);
        const absRoot = path.resolve(repoRoot, normalizedRel);
        assertInsideRepo(repoRoot, absRoot);

        const files: string[] = [];
        const showIgnored = options?.showIgnored ?? false;

        const walk = async (dir: string): Promise<void> => {
            if (files.length >= this.maxEntries) return;

            let dirents: fs.Dirent[];
            try {
                dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }

            // Resolve symlinks and filter broken ones
            const resolved: { name: string; isDir: boolean }[] = [];
            for (const dirent of dirents) {
                const fullPath = path.join(dir, dirent.name);
                if (dirent.isSymbolicLink()) {
                    try {
                        const targetStat = await fs.promises.stat(fullPath);
                        resolved.push({ name: dirent.name, isDir: targetStat.isDirectory() });
                    } catch {
                        continue;
                    }
                } else {
                    resolved.push({ name: dirent.name, isDir: dirent.isDirectory() });
                }
            }

            // Gitignore filtering
            let filtered = resolved;
            if (!showIgnored) {
                const entryInfos = resolved.map(e => ({ name: e.name, isDir: e.isDir }));
                const ignoredNames = getGitIgnoredNames(repoRoot, dir, entryInfos);
                if (ignoredNames.size > 0) {
                    filtered = resolved.filter(e => !ignoredNames.has(e.name));
                }
            }

            // Sort alphabetically for deterministic output
            filtered.sort((a, b) => a.name.localeCompare(b.name));

            for (const entry of filtered) {
                if (files.length >= this.maxEntries) return;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDir) {
                    await walk(fullPath);
                } else {
                    const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
                    files.push(relPath);
                }
            }
        };

        await walk(absRoot);
        const truncated = files.length >= this.maxEntries;
        return { files: truncated ? files.slice(0, this.maxEntries) : files, truncated };
    }

    /**
     * Read file content.
     * @returns content (text or base64), encoding, and mimeType.
     * @throws if file not found, path traversal detected, or file exceeds 1 MB.
     */
    async readBlob(
        repoId: string,
        relativePath: string,
    ): Promise<{ content: string; encoding: 'utf-8' | 'base64'; mimeType: string }> {
        const repo = await this.resolveRepo(repoId);
        if (!repo) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const repoRoot = repo.localPath;
        const absPath = path.resolve(repoRoot, stripLeadingSeparators(relativePath));
        assertInsideRepo(repoRoot, absPath);

        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(absPath);
        } catch {
            throw new Error(`File not found: ${relativePath}`);
        }

        if (!stat.isFile()) {
            throw new Error(`Not a file: ${relativePath}`);
        }

        if (stat.size > MAX_BLOB_SIZE) {
            throw new Error(`File exceeds maximum size of ${MAX_BLOB_SIZE} bytes: ${relativePath}`);
        }

        const buffer = await fs.promises.readFile(absPath);
        const mimeType = getMimeType(absPath);

        if (isBinary(buffer)) {
            return {
                content: buffer.toString('base64'),
                encoding: 'base64',
                mimeType,
            };
        }

        return {
            content: buffer.toString('utf-8'),
            encoding: 'utf-8',
            mimeType,
        };
    }

    /**
     * Write text content to a file inside a repo.
     * @throws if repo not found, path traversal detected, or path is a directory.
     */
    async writeBlob(repoId: string, relativePath: string, content: string): Promise<void> {
        const repo = await this.resolveRepo(repoId);
        if (!repo) {
            throw new Error(`Repo not found: ${repoId}`);
        }

        const repoRoot = repo.localPath;
        const absPath = path.resolve(repoRoot, stripLeadingSeparators(relativePath));
        assertInsideRepo(repoRoot, absPath);

        // Ensure parent directory exists
        const parentDir = path.dirname(absPath);
        await fs.promises.mkdir(parentDir, { recursive: true });

        await fs.promises.writeFile(absPath, content, 'utf-8');
    }

    /**
     * Build a RepoInfo from a WorkspaceInfo.
     * Pure mapping + git HEAD resolution.
     */
    static toRepoInfo(workspace: WorkspaceInfo): RepoInfo {
        let headSha = '';
        try {
            headSha = childProcess
                .execSync('git rev-parse --short HEAD', {
                    cwd: workspace.rootPath,
                    encoding: 'utf-8',
                    timeout: 5000,
                    stdio: ['pipe', 'pipe', 'pipe'],
                })
                .trim();
        } catch {
            // Not a git repo or git not available
        }

        let remoteUrl: string | undefined;
        try {
            const url = childProcess
                .execSync('git remote get-url origin', {
                    cwd: workspace.rootPath,
                    encoding: 'utf-8',
                    timeout: 5000,
                    stdio: ['pipe', 'pipe', 'pipe'],
                })
                .trim();
            if (url) remoteUrl = url;
        } catch {
            // No origin remote or not a git repo
        }

        return {
            id: workspace.id,
            name: workspace.name,
            localPath: workspace.rootPath,
            headSha,
            clonedAt: new Date().toISOString(),
            ...(remoteUrl ? { remoteUrl } : {}),
            ...(workspace.remoteUrl ? { remoteUrl: workspace.remoteUrl } : {}),
        };
    }

    private async readWorkspaces(): Promise<WorkspaceInfo[]> {
        const workspacesPath = path.join(this.dataDir, 'workspaces.json');
        try {
            const data = await fs.promises.readFile(workspacesPath, 'utf-8');
            return JSON.parse(data) as WorkspaceInfo[];
        } catch {
            return [];
        }
    }
}
