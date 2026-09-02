/**
 * Endpoint for cloning arbitrary git URLs into a user-selected parent folder.
 */

import * as path from 'path';
import { execGitAsync } from '@plusplusoneplusplus/forge';
import { handleAPIError, missingFields } from '../errors';
import { parseBodyOrReject } from '../shared/handler-utils';
import { sendJSON } from '../core/api-handler';
import type { ApiRouteContext } from './api-shared';
import { GIT_MAX_BUFFER } from './api-shared';
import { createRoute } from './route-utils';

export function deriveDefaultCloneDirectoryName(gitUrl: string): string {
    const trimmed = gitUrl.trim().replace(/[?#].*$/, '').replace(/[\/\\]+$/, '');
    const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'), trimmed.lastIndexOf(':'));
    const lastPart = trimmed.slice(lastSeparator + 1);
    return lastPart.endsWith('.git') ? lastPart.slice(0, -4) : lastPart;
}

/**
 * Run `git clone` with `parentDir` as the working directory.
 *
 * A clone is a network operation, so it keeps shelling out to the git CLI —
 * that is what lets credential helpers, SSH agents and 2FA behave exactly as
 * they do when a human runs git. The child is started from Rust rather than
 * from Node now, which is the whole of the change: `execGitAsync` runs
 * `git -C <parentDir> clone …`, and `-C` places git in the parent directory
 * the same way the old `cwd` did.
 *
 * `timeout: 0` is deliberate and preserves today's behaviour: every other git
 * call in the server is capped, but a clone is bounded by how big the
 * repository is and how fast the network is, and no wall-clock number is right
 * for both a 2 MB repo and a 2 GB one.
 *
 * Rejects with `git clone <url> failed: <stderr>`, which the caller shows to
 * the user verbatim.
 */
export async function cloneRepository(gitArgs: string[], parentDir: string): Promise<void> {
    await execGitAsync(gitArgs, parentDir, { maxBuffer: GIT_MAX_BUFFER, timeout: 0 });
}

export function registerGitCloneRoutes(ctx: ApiRouteContext): void {
    const { routes } = ctx;

    // POST /api/git/clone — Clone an arbitrary git URL into a parent directory.
    // Optional `dirName` overrides the target folder name (defaults to the name
    // git derives from the URL). When provided, git receives an extra positional
    // argument: `git clone <url> <dirName>`.
    routes.push(createRoute({
        method: 'POST',
        pattern: '/api/git/clone',
        handler: async ({ req, res }) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) {
                return;
            }

            const missing: string[] = [];
            if (typeof body.url !== 'string' || body.url.trim() === '') {
                missing.push('url');
            }
            if (typeof body.parentDir !== 'string' || body.parentDir.trim() === '') {
                missing.push('parentDir');
            }
            if (missing.length > 0) {
                return void handleAPIError(res, missingFields(missing));
            }

            const gitUrl = body.url.trim();
            const parentDir = path.resolve(body.parentDir);
            const customDirName =
                typeof body.dirName === 'string' && body.dirName.trim()
                    ? body.dirName.trim()
                    : null;
            const cloneDirName = customDirName ?? deriveDefaultCloneDirectoryName(gitUrl);
            const gitArgs = customDirName
                ? ['clone', gitUrl, customDirName]
                : ['clone', gitUrl];

            try {
                await cloneRepository(gitArgs, parentDir);
            } catch (error) {
                // The message already reads `git clone <url> failed: <stderr>`,
                // and a broken addon says so by name — both are what the clone
                // dialog puts in front of the user.
                sendJSON(res, 500, {
                    error: error instanceof Error ? error.message : String(error),
                });
                return;
            }

            return { clonedPath: path.join(parentDir, cloneDirName) };
        },
    }));
}
