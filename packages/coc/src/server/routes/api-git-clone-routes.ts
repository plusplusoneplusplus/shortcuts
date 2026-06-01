/**
 * Git Clone REST API Routes
 *
 * Endpoint for cloning arbitrary git URLs into a user-selected parent folder.
 */

import * as path from 'path';
import { execFile } from 'child_process';
import { handleAPIError, missingFields } from '../errors';
import { parseBodyOrReject } from '../shared/handler-utils';
import { sendJSON } from '../core/api-handler';
import type { ApiRouteContext } from './api-shared';
import { GIT_MAX_BUFFER } from './api-shared';
import { createRoute } from './route-utils';

interface ExecFileError extends Error {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
}

function outputToString(output: string | Buffer | undefined): string {
    if (Buffer.isBuffer(output)) {
        return output.toString('utf8');
    }
    return output ?? '';
}

function buildCloneErrorMessage(error: ExecFileError, stdout: string | Buffer, stderr: string | Buffer): string {
    const output = [outputToString(stderr), outputToString(stdout)]
        .map(part => part.trim())
        .filter(Boolean)
        .join('\n');
    return output || error.message;
}

export function deriveDefaultCloneDirectoryName(gitUrl: string): string {
    const trimmed = gitUrl.trim().replace(/[?#].*$/, '').replace(/[\/\\]+$/, '');
    const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'), trimmed.lastIndexOf(':'));
    const lastPart = trimmed.slice(lastSeparator + 1);
    return lastPart.endsWith('.git') ? lastPart.slice(0, -4) : lastPart;
}

function cloneRepository(gitArgs: string[], parentDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(
            'git',
            gitArgs,
            { cwd: parentDir, maxBuffer: GIT_MAX_BUFFER },
            (error, stdout, stderr) => {
                if (error) {
                    const execError = error as ExecFileError;
                    execError.stdout = execError.stdout ?? stdout;
                    execError.stderr = execError.stderr ?? stderr;
                    reject(execError);
                    return;
                }
                resolve();
            },
        );
    });
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
                const execError = error as ExecFileError;
                sendJSON(res, 500, {
                    error: buildCloneErrorMessage(execError, execError.stdout ?? '', execError.stderr ?? ''),
                });
                return;
            }

            return { clonedPath: path.join(parentDir, cloneDirName) };
        },
    }));
}
