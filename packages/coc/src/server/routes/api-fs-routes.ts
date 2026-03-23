/**
 * Filesystem Browse REST API Route
 *
 * Directory browsing endpoint for repo path selection in the dashboard UI.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { Route } from '../types';
import { sendJSON } from '../api-handler';
import { handleAPIError, notFound } from '../errors';

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
            if (!entry.isDirectory()) continue;
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

export function registerApiFsRoutes(routes: Route[]): void {
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
            } = { ...result };

            if (process.platform === 'win32') {
                payload.drives = listWindowsDrives();
            }

            sendJSON(res, 200, payload);
        },
    });
}
