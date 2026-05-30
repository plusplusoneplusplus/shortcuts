/**
 * Filesystem REST API Routes
 *
 * Directory browsing and trusted-path blob reading for the dashboard UI.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { getDefaultWslDistro, getWslExecutablePath, isWithinDirectory } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound } from '../errors';
import { isWithinTrustedReadOnlyDir } from '../tasks/tasks-handler-utils';

export interface BrowseRoot {
    label: string;
    path: string;
}

/** Enumerate available Windows drive roots (e.g., C:\, D:\). */
function listWindowsDrives(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }
    const drives: string[] = [];
    for (let code = 65; code <= 90; code++) {
        const drive = `${String.fromCharCode(code)}:\\`;
        if (fs.existsSync(drive)) {
            drives.push(drive);
        }
    }
    return drives;
}

function linuxPathToWslUnc(distro: string, linuxPath: string): string {
    const base = `${path.win32.sep}${path.win32.sep}wsl$${path.win32.sep}${distro}`;
    const segments = linuxPath.split('/').filter(Boolean);
    return segments.length > 0 ? path.win32.join(base, ...segments) : base;
}

function getDefaultWslRoots(): BrowseRoot[] {
    if (process.platform !== 'win32') {
        return [];
    }

    const distro = getDefaultWslDistro();
    if (!distro) {
        return [];
    }

    const fallbackRoot: BrowseRoot = {
        label: `WSL (${distro})`,
        path: linuxPathToWslUnc(distro, '/'),
    };

    try {
        const home = execFileSync(
            getWslExecutablePath(),
            ['-d', distro, '--', 'sh', '-c', 'printf %s "$HOME"'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        if (!home.startsWith('/')) {
            return [fallbackRoot];
        }
        return [{
            label: `WSL Home (${distro})`,
            path: linuxPathToWslUnc(distro, home),
        }];
    } catch {
        return [fallbackRoot];
    }
}

export function listBrowseRoots(): BrowseRoot[] {
    if (process.platform !== 'win32') {
        return [];
    }

    const roots: BrowseRoot[] = [];
    const seen = new Set<string>();

    const pushRoot = (root: BrowseRoot | null) => {
        if (!root) {
            return;
        }
        const key = root.path.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        roots.push(root);
    };

    for (const root of getDefaultWslRoots()) {
        pushRoot(root);
    }
    for (const drive of listWindowsDrives()) {
        pushRoot({ label: drive, path: drive });
    }

    return roots;
}

/** Browse a directory and return its entries (directories only) for repo path selection. */
export function browseDirectory(dirPath: string, showHidden = false): {
    path: string;
    parent: string | null;
    entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }>;
} | null {
    try {
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return null;
        }

        const parentDir = path.dirname(dirPath);
        const parent = parentDir !== dirPath ? parentDir : null;

        const rawEntries = fs.readdirSync(dirPath, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }> = [];

        for (const entry of rawEntries) {
            let isDir = entry.isDirectory();

            // Symlinks report isDirectory()=false; resolve the target to check.
            if (!isDir && entry.isSymbolicLink()) {
                try {
                    const realStat = fs.statSync(path.join(dirPath, entry.name));
                    isDir = realStat.isDirectory();
                } catch {
                    // Broken symlink — skip gracefully
                    continue;
                }
            }

            if (!isDir) continue;
            if (!showHidden && entry.name.startsWith('.')) continue;

            const fullPath = path.join(dirPath, entry.name);
            const isGitRepo = fs.existsSync(path.join(fullPath, '.git'));

            entries.push({ name: entry.name, type: 'directory', isGitRepo });
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));

        return { path: dirPath, parent, entries };
    } catch {
        return null;
    }
}

/** Extension → MIME type map for common file types (subset used by blob endpoint). */
const MIME_MAP: Record<string, string> = {
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.cjs': 'application/javascript',
    '.ts': 'application/typescript', '.tsx': 'application/typescript', '.jsx': 'application/javascript',
    '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
    '.xml': 'application/xml', '.yaml': 'application/x-yaml', '.yml': 'application/x-yaml',
    '.toml': 'application/toml', '.sh': 'application/x-sh', '.bash': 'application/x-sh',
    '.py': 'text/x-python', '.rb': 'text/x-ruby', '.go': 'text/x-go', '.rs': 'text/x-rust',
    '.java': 'text/x-java', '.c': 'text/x-c', '.cpp': 'text/x-c++', '.h': 'text/x-c',
    '.hpp': 'text/x-c++', '.cs': 'text/x-csharp', '.swift': 'text/x-swift',
    '.kt': 'text/x-kotlin', '.scala': 'text/x-scala', '.php': 'text/x-php',
    '.sql': 'application/sql', '.graphql': 'application/graphql',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
    '.env': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv', '.lock': 'text/plain',
};

const FS_BLOB_MAX_SIZE = 1 * 1024 * 1024; // 1 MB
const BINARY_PROBE_SIZE = 8192;

function fsBlobGetMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] ?? 'application/octet-stream';
}

function fsBlobIsBinary(buffer: Buffer): boolean {
    const limit = Math.min(buffer.length, BINARY_PROBE_SIZE);
    for (let i = 0; i < limit; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

export interface RegisterApiFsRoutesOptions {
    dataDir?: string;
    workspaceProvider?: {
        getWorkspaces(): Promise<Array<{ rootPath: string }>>;
    };
}

async function readRegisteredWorkspaceRoots(options?: RegisterApiFsRoutesOptions): Promise<string[]> {
    if (options?.workspaceProvider) {
        const workspaces = await options.workspaceProvider.getWorkspaces();
        return workspaces.map(workspace => workspace.rootPath).filter(Boolean);
    }

    if (!options?.dataDir) {
        return [];
    }

    const workspacesPath = path.join(options.dataDir, 'workspaces.json');
    try {
        const raw = await fs.promises.readFile(workspacesPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map(workspace => {
                if (workspace && typeof workspace === 'object' && typeof (workspace as { rootPath?: unknown }).rootPath === 'string') {
                    return (workspace as { rootPath: string }).rootPath;
                }
                return '';
            })
            .filter(Boolean);
    } catch (err) {
        if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

async function isWithinRegisteredWorkspace(target: string, options?: RegisterApiFsRoutesOptions): Promise<boolean> {
    const roots = await readRegisteredWorkspaceRoots(options);
    return roots.some(root => isWithinDirectory(target, root));
}

export function registerApiFsRoutes(routes: Route[], options?: RegisterApiFsRoutesOptions): void {
    // GET /api/fs/browse — Browse directories for repo path selection
    routes.push({
        method: 'GET',
        pattern: '/api/fs/browse',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const rawPath = typeof parsed.query.path === 'string' && parsed.query.path
                ? parsed.query.path
                : os.homedir();
            const showHidden = parsed.query.showHidden === 'true';

            const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));

            const result = browseDirectory(resolved, showHidden);
            if (!result) {
                return handleAPIError(res, notFound('Directory'));
            }

            const payload: {
                path: string;
                parent: string | null;
                entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }>;
                drives?: string[];
                browseRoots?: BrowseRoot[];
            } = { ...result };

            if (process.platform === 'win32') {
                payload.drives = listWindowsDrives();
                payload.browseRoots = listBrowseRoots();
            }

            sendJSON(res, 200, payload);
        },
    });

    // GET /api/fs/browse-helper — HTML page that browses same-origin and posts results via postMessage.
    // Used by container-mode SPA on localhost to browse devtunnel agents without cross-origin cookie issues.
    routes.push({
        method: 'GET',
        pattern: '/api/fs/browse-helper',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const browsePath = typeof parsed.query.path === 'string' ? parsed.query.path : '~';
            const showHidden = parsed.query.showHidden === 'true';
            const html = `<!DOCTYPE html><html><head><title>Browsing...</title></head><body>
<p>Loading directory listing...</p>
<script>
(async () => {
  try {
    const p = ${JSON.stringify(browsePath)};
    const sh = ${JSON.stringify(showHidden)};
    const resp = await fetch('/api/fs/browse?path=' + encodeURIComponent(p) + '&showHidden=' + sh);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (window.opener) {
      window.opener.postMessage({ type: 'browse-result', data: data }, '*');
      document.body.innerHTML = '<p>Done — this tab will close.</p>';
      setTimeout(() => window.close(), 500);
    } else {
      document.body.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
    }
  } catch (e) {
    if (window.opener) {
      window.opener.postMessage({ type: 'browse-error', error: e.message }, '*');
    }
    document.body.innerHTML = '<p style="color:red">Error: ' + e.message + '</p>';
  }
})();
</script></body></html>`;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        },
    });

    // GET /api/fs/blob — Read file content from trusted directories (read-only)
    routes.push({
        method: 'GET',
        pattern: '/api/fs/blob',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const rawPath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!rawPath) {
                return handleAPIError(res, notFound('File'));
            }

            const resolved = path.resolve(rawPath.replace(/^~(\/|\\|$)/, os.homedir() + path.sep));

            if (
                !isWithinTrustedReadOnlyDir(resolved, options?.dataDir) &&
                !(await isWithinRegisteredWorkspace(resolved, options))
            ) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Path is outside trusted directories' }));
                return;
            }

            let stat: fs.Stats;
            try {
                stat = await fs.promises.stat(resolved);
            } catch {
                return handleAPIError(res, notFound('File'));
            }

            if (!stat.isFile()) {
                return handleAPIError(res, notFound('File'));
            }

            if (stat.size > FS_BLOB_MAX_SIZE) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `File exceeds maximum size of ${FS_BLOB_MAX_SIZE} bytes` }));
                return;
            }

            const buffer = await fs.promises.readFile(resolved);
            const mimeType = fsBlobGetMime(resolved);

            if (fsBlobIsBinary(buffer)) {
                sendJSON(res, 200, { content: buffer.toString('base64'), encoding: 'base64', mimeType });
            } else {
                sendJSON(res, 200, { content: buffer.toString('utf-8'), encoding: 'utf-8', mimeType });
            }
        },
    });
}
